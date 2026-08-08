import { describe, expect, it, vi } from 'vitest'
import { runReActLoop } from '@perocore/backend/services/agent/reactLoop'
import type { ChatDelta } from '@perocore/backend/services/llm/types'
import type { ModelConfig } from '@perocore/backend/services/llm/llmService'

const modelConfig: ModelConfig = {
  provider: 'openai',
  modelId: 'test-model',
  apiKey: 'test-key',
}

async function* streamFrom(chunks: ChatDelta[]) {
  for (const chunk of chunks) {
    yield chunk
  }
}

async function collectLoop(params: Parameters<typeof runReActLoop>[0]) {
  const generator = runReActLoop(params)
  const yields = []
  let next = await generator.next()
  while (!next.done) {
    yields.push(next.value)
    next = await generator.next()
  }
  return { yields, result: next.value }
}

describe('runReActLoop', () => {
  it('应当流式输出文本并过滤 Thinking 内容', async () => {
    const llmService = {
      chatStream: vi
        .fn()
        .mockReturnValue(
          streamFrom([
            { choices: [{ delta: { content: '你好' }, finishReason: null }] },
            { choices: [{ delta: { content: '【Thinking: 隐藏】世界' }, finishReason: null }] },
          ]),
        ),
    }

    const { yields, result } = await collectLoop({
      llmService: llmService as never,
      modelConfig,
      messages: [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: '打招呼' },
      ],
      tools: undefined,
      toolExecutor: undefined,
      source: 'desktop',
    })

    expect(yields).toEqual([
      { event: 'status', data: { state: 'thinking', message: '正在思考...', turn: 1 } },
      '你好',
      '世界',
    ])
    // 返回值已改为对象结构 { toolCalls, messages, rawText }，无工具调用时 toolCalls 为空数组
    expect(result.toolCalls).toEqual([])
  })

  it('应当执行流式工具调用并把工具结果追加到上下文', async () => {
    const llmService = {
      chatStream: vi
        .fn()
        .mockReturnValueOnce(
          streamFrom([
            { choices: [{ delta: { content: '需要查找' }, finishReason: null }] },
            {
              choices: [
                {
                  delta: {
                    toolCalls: [
                      {
                        index: 0,
                        id: 'call-1',
                        type: 'function',
                        function: { name: 'lookup', arguments: '{"q"' },
                      },
                    ],
                  },
                  finishReason: null,
                },
              ],
            },
            {
              choices: [
                {
                  delta: { toolCalls: [{ index: 0, function: { arguments: ':"猫"}' } }] },
                  finishReason: null,
                },
              ],
            },
          ]),
        )
        .mockReturnValueOnce(
          streamFrom([{ choices: [{ delta: { content: '完成' }, finishReason: null }] }]),
        ),
    }
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({
        output: '工具结果',
        durationMs: 12,
        isError: false,
        shouldTerminate: false,
      }),
    }
    const messages = [{ role: 'user' as const, content: '查资料' }]

    const { yields, result } = await collectLoop({
      llmService: llmService as never,
      modelConfig,
      messages,
      tools: [{ name: 'lookup', description: '查询', parameters: { type: 'object' } }],
      toolExecutor,
      source: 'desktop',
      config: { maxTurns: 2 },
    })

    // 第七阶段修复（批次 B1）：execute 第 4 个参数现在是 toolRuntimeContext（含 agentId/sessionId）
    // 测试未传 agentId/threadContext，故 agentId 为 undefined，sessionId 默认 'default'
    expect(toolExecutor.execute).toHaveBeenCalledWith(
      'lookup',
      { q: '猫' },
      'desktop',
      expect.objectContaining({ sessionId: 'default' }),
    )
    expect(yields).toEqual([
      { event: 'status', data: { state: 'thinking', message: '正在思考...', turn: 1 } },
      '需要查找',
      { event: 'tool_call', data: { name: 'lookup', args: { q: '猫' } } },
      { event: 'status', data: { state: 'calling', message: '正在调用工具: lookup', turn: 1 } },
      {
        event: 'tool_result',
        data: { name: 'lookup', result: '工具结果', isError: false, durationMs: 12 },
      },
      { event: 'status', data: { state: 'thinking', message: '正在思考...', turn: 2 } },
      '完成',
    ])
    expect(messages).toEqual([
      { role: 'user', content: '查资料' },
      {
        role: 'assistant',
        content: '需要查找',
        // assistant 消息现在携带 toolCalls 数组（id/type/function 结构）
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"q":"猫"}' },
          },
        ],
      },
      // 工具消息字段从 tool_call_id 改为 toolCallId
      { role: 'tool', content: '工具结果', toolCallId: 'call-1' },
    ])
    // 返回值已改为对象结构，工具调用列表在 result.toolCalls 字段
    expect(result.toolCalls).toEqual([
      { name: 'lookup', args: { q: '猫' }, result: '工具结果', durationMs: 12 },
    ])
  })

  it('应当在首轮无有效内容时提示配置问题', async () => {
    const llmService = {
      chatStream: vi
        .fn()
        .mockReturnValue(streamFrom([{ choices: [{ delta: {}, finishReason: null }] }])),
    }

    const { yields } = await collectLoop({
      llmService: llmService as never,
      modelConfig,
      messages: [],
      tools: undefined,
      toolExecutor: undefined,
      source: 'desktop',
    })

    expect(yields).toEqual([
      { event: 'status', data: { state: 'thinking', message: '正在思考...', turn: 1 } },
      '⚠️ AI 没有返回有效内容。请检查网络连接或 API Key 配置。',
    ])
  })

  it('应当在取消时跳出循环或跳过工具执行', async () => {
    const llmService = {
      chatStream: vi.fn().mockReturnValue(
        streamFrom([
          {
            choices: [
              {
                delta: {
                  toolCalls: [
                    {
                      index: 0,
                      id: 'call-1',
                      type: 'function',
                      function: { name: 'lookup', arguments: '{}' },
                    },
                  ],
                },
                finishReason: null,
              },
            ],
          },
        ]),
      ),
    }
    const toolExecutor = { execute: vi.fn() }
    const cancelChecker = {
      isCancelled: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
    }

    const { result } = await collectLoop({
      llmService: llmService as never,
      modelConfig,
      messages: [{ role: 'user', content: '查找' }],
      tools: [{ name: 'lookup', description: '查询', parameters: {} }],
      toolExecutor,
      source: 'desktop',
      sessionId: 'session-1',
      cancelChecker,
    })

    expect(toolExecutor.execute).not.toHaveBeenCalled()
    // 返回值已改为对象结构，取消时尚未执行工具，toolCalls 为空数组
    expect(result.toolCalls).toEqual([])
  })

  it('应当在连续工具错误达到阈值后禁用后续工具', async () => {
    const llmService = {
      chatStream: vi
        .fn()
        .mockReturnValueOnce(
          streamFrom([
            {
              choices: [
                {
                  delta: {
                    toolCalls: [
                      {
                        index: 0,
                        id: 'call-1',
                        type: 'function',
                        // 第七阶段 #8: 参数解析失败时，错误会作为 tool_result 反馈给 LLM，
                        // 而非以空参数调用工具。这里用一个工具执行报错的场景验证熔断。
                        function: { name: 'broken', arguments: '{}' },
                      },
                    ],
                  },
                  finishReason: null,
                },
              ],
            },
          ]),
        )
        .mockReturnValueOnce(
          streamFrom([{ choices: [{ delta: { content: '后续' }, finishReason: null }] }]),
        ),
    }
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({
        output: '失败',
        durationMs: 5,
        isError: true,
        shouldTerminate: false,
      }),
    }
    const messages = [{ role: 'user' as const, content: '执行' }]

    const { result } = await collectLoop({
      llmService: llmService as never,
      modelConfig,
      messages,
      tools: [{ name: 'broken', description: '坏工具', parameters: {} }],
      toolExecutor,
      source: 'desktop',
      config: { maxTurns: 2, errorThreshold: 1 },
    })

    // AIOS: execute 现在接收第 4 个参数 threadContext（测试未传，故为 undefined）
    expect(toolExecutor.execute).toHaveBeenCalledWith(
      'broken',
      {},
      'desktop',
      expect.objectContaining({ sessionId: 'default' }),
    )
    expect(llmService.chatStream).toHaveBeenLastCalledWith(modelConfig, expect.any(Array), {
      tools: undefined,
    })
    expect(messages[messages.length - 1]).toMatchObject({ role: 'system' })
    expect(result.toolCalls).toEqual([{ name: 'broken', args: {}, result: '失败', durationMs: 5 }])
  })

  // 第七阶段 #8: 参数解析失败时，错误作为 tool_result 反馈给 LLM 而非吞掉
  it('应当在工具参数 JSON 解析失败时把错误反馈给 LLM 而不调用工具', async () => {
    const llmService = {
      chatStream: vi
        .fn()
        .mockReturnValueOnce(
          streamFrom([
            {
              choices: [
                {
                  delta: {
                    toolCalls: [
                      {
                        index: 0,
                        id: 'call-1',
                        type: 'function',
                        // 故意传入非法 JSON 触发参数解析失败
                        function: { name: 'lookup', arguments: '不是合法JSON' },
                      },
                    ],
                  },
                  finishReason: null,
                },
              ],
            },
          ]),
        )
        // 第二轮：LLM 收到错误反馈后修正参数并正常调用
        .mockReturnValueOnce(
          streamFrom([
            {
              choices: [
                {
                  delta: {
                    toolCalls: [
                      {
                        index: 0,
                        id: 'call-2',
                        type: 'function',
                        function: { name: 'lookup', arguments: '{"q":"修正后的查询"}' },
                      },
                    ],
                  },
                  finishReason: null,
                },
              ],
            },
          ]),
        )
        // 第三轮：工具成功后 LLM 返回最终文本
        .mockReturnValueOnce(
          streamFrom([{ choices: [{ delta: { content: '已修复并完成' }, finishReason: null }] }]),
        ),
    }
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({
        output: '查询结果',
        durationMs: 8,
        isError: false,
        shouldTerminate: false,
      }),
    }
    const messages = [{ role: 'user' as const, content: '查资料' }]

    const { yields, result } = await collectLoop({
      llmService: llmService as never,
      modelConfig,
      messages,
      tools: [{ name: 'lookup', description: '查询', parameters: {} }],
      toolExecutor,
      source: 'desktop',
      config: { maxTurns: 3, errorThreshold: 3 },
    })

    // 关键断言1: 第一轮工具调用因参数解析失败被跳过，execute 不应被调用
    // 只有第二轮（修正后）的工具调用会执行
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
    expect(toolExecutor.execute).toHaveBeenCalledWith(
      'lookup',
      { q: '修正后的查询' },
      'desktop',
      expect.objectContaining({ sessionId: 'default' }),
    )

    // 关键断言2: 第一轮产出的 tool_result 是错误消息（包含解析失败原因）
    const toolResultEvents = yields.filter(
      (y) => typeof y === 'object' && y !== null && (y as { event?: string }).event === 'tool_result',
    )
    expect(toolResultEvents).toHaveLength(2)
    const firstResult = toolResultEvents[0] as {
      event: string
      data: { name: string; result: string; isError: boolean; durationMs: number }
    }
    expect(firstResult.data.name).toBe('lookup')
    expect(firstResult.data.isError).toBe(true)
    expect(firstResult.data.durationMs).toBe(0)
    expect(firstResult.data.result).toContain('参数解析失败')
    expect(firstResult.data.result).toContain('不是合法JSON')
    expect(firstResult.data.result).toContain('请检查参数是否为合法 JSON 格式后重试')

    // 关键断言3: 错误 tool_result 被追加到 messages，LLM 能在下一轮感知到
    const toolMessages = messages.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(2)
    expect(toolMessages[0]?.content).toContain('参数解析失败')
    expect(toolMessages[0]?.toolCallId).toBe('call-1')

    // 关键断言4: 最终工具调用记录包含两条（第一条是解析失败，第二条是成功执行）
    expect(result.toolCalls).toEqual([
      {
        name: 'lookup',
        args: {},
        result: expect.stringContaining('参数解析失败'),
        durationMs: 0,
      },
      {
        name: 'lookup',
        args: { q: '修正后的查询' },
        result: '查询结果',
        durationMs: 8,
      },
    ])
  })

  it('应当在工具要求终止时结束循环', async () => {
    const llmService = {
      chatStream: vi.fn().mockReturnValue(
        streamFrom([
          {
            choices: [
              {
                delta: {
                  toolCalls: [
                    {
                      index: 0,
                      id: 'call-1',
                      type: 'function',
                      function: { name: 'finish_task', arguments: '{"summary":"完成"}' },
                    },
                  ],
                },
                finishReason: null,
              },
            ],
          },
        ]),
      ),
    }
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({
        output: '完成',
        durationMs: 1,
        isError: false,
        shouldTerminate: true,
      }),
    }

    const { result } = await collectLoop({
      llmService: llmService as never,
      modelConfig,
      messages: [{ role: 'user', content: '完成任务' }],
      tools: [{ name: 'finish_task', description: '结束', parameters: {} }],
      toolExecutor,
      source: 'desktop',
      config: { maxTurns: 5 },
    })

    expect(llmService.chatStream).toHaveBeenCalledTimes(1)
    expect(result.toolCalls).toEqual([
      { name: 'finish_task', args: { summary: '完成' }, result: '完成', durationMs: 1 },
    ])
  })
})
