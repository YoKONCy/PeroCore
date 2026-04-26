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
    expect(result).toEqual([])
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

    expect(toolExecutor.execute).toHaveBeenCalledWith('lookup', { q: '猫' }, 'desktop')
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
      { role: 'assistant', content: '需要查找' },
      { role: 'tool', content: '工具结果', tool_call_id: 'call-1' },
    ])
    expect(result).toEqual([
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
    expect(result).toEqual([])
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
                        function: { name: 'broken', arguments: '不是JSON' },
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

    expect(toolExecutor.execute).toHaveBeenCalledWith('broken', {}, 'desktop')
    expect(llmService.chatStream).toHaveBeenLastCalledWith(modelConfig, expect.any(Array), {
      tools: undefined,
    })
    expect(messages[messages.length - 1]).toMatchObject({ role: 'system' })
    expect(result).toEqual([{ name: 'broken', args: {}, result: '失败', durationMs: 5 }])
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
    expect(result).toEqual([
      { name: 'finish_task', args: { summary: '完成' }, result: '完成', durationMs: 1 },
    ])
  })
})
