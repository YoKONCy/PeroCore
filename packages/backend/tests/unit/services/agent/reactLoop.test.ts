import { describe, expect, it, vi } from 'vitest'
import { runReActLoop, toolResultForPersistence } from '@infos/backend/services/agent/reactLoop'
import type { ChatDelta } from '@infos/backend/services/llm/types'
import type { ModelConfig } from '@infos/backend/services/llm/llmService'

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
    if (next.value.event === 'narration_delta') yields.push(next.value.data.delta)
    else if (next.value.event !== 'narration_start' && next.value.event !== 'narration_end')
      yields.push(next.value)
    next = await generator.next()
  }
  return { yields, result: next.value }
}

describe('runReActLoop', () => {
  it('应将Provider原生思考作为独立Timeline回传并与正文区分', async () => {
    const { yields, result } = await collectLoop({
      llmService: {
        chatStream: vi
          .fn()
          .mockReturnValue(
            streamFrom([
              { choices: [{ delta: { reasoningContent: '原生分析' } }] },
              { choices: [{ delta: { content: '<think>文本思考</think>最终答案' } }] },
            ]),
          ),
      } as never,
      modelConfig: { ...modelConfig, returnNativeReasoning: true },
      messages: [{ role: 'user', content: '分析' }],
      tools: undefined,
      toolExecutor: undefined,
      source: 'desktop',
    })

    expect(yields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'native_reasoning_start' }),
        expect.objectContaining({
          event: 'native_reasoning_delta',
          data: expect.objectContaining({ delta: '原生分析' }),
        }),
        expect.objectContaining({ event: 'native_reasoning_end' }),
        expect.objectContaining({ event: 'thinking_start' }),
        expect.objectContaining({
          event: 'thinking_delta',
          data: expect.objectContaining({ delta: '文本思考' }),
        }),
        expect.objectContaining({ event: 'thinking_end' }),
        '最终答案',
      ]),
    )
    expect(result.contentBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'thinking', content: '文本思考' }),
        expect.objectContaining({ kind: 'native_reasoning', content: '原生分析', mode: 'stream' }),
        expect.objectContaining({ kind: 'narration', content: '最终答案' }),
      ]),
    )
  })

  it('同一轮出现多个think块时应分别流式发布碎碎念', async () => {
    const { yields, result } = await collectLoop({
      llmService: {
        chatStream: vi
          .fn()
          .mockReturnValue(
            streamFrom([
              { choices: [{ delta: { content: '<thi' } }] },
              { choices: [{ delta: { content: 'nk>第一段' } }] },
              { choices: [{ delta: { content: '碎碎念</think>正文' } }] },
              { choices: [{ delta: { content: '<think>第二段</think>结束' } }] },
            ]),
          ),
      } as never,
      modelConfig,
      messages: [{ role: 'user', content: '继续' }],
      tools: undefined,
      toolExecutor: undefined,
      source: 'desktop',
    })

    expect(
      yields.filter((item) => typeof item !== 'string' && item.event === 'thinking_start'),
    ).toHaveLength(2)
    expect(
      yields.filter((item) => typeof item !== 'string' && item.event === 'thinking_end'),
    ).toHaveLength(2)
    expect(yields).toEqual(expect.arrayContaining(['正文', '结束']))
    expect(result.contentBlocks.filter((block) => block.kind === 'thinking')).toEqual([
      expect.objectContaining({ content: '第一段碎碎念' }),
      expect.objectContaining({ content: '第二段' }),
    ])
  })

  it('应向Scheduler报告去重后的Token增量和工具I/O用量', async () => {
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
                      id: 'call-usage',
                      function: { name: 'lookup', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
            usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
          },
          {
            choices: [{ delta: {} }],
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          },
        ]),
      ),
    }
    const onUsage = vi.fn()
    const endIo = vi.fn()
    await collectLoop({
      llmService: llmService as never,
      modelConfig,
      messages: [{ role: 'user', content: '查找' }],
      tools: [{ name: 'lookup', description: '查询', parameters: {} }],
      toolExecutor: {
        execute: vi.fn().mockResolvedValue({
          output: '完成',
          durationMs: 1,
          isError: false,
          shouldTerminate: true,
        }),
      },
      source: 'desktop',
      config: { maxTurns: 1 },
      onUsage,
      beginIo: () => endIo,
    })

    expect(onUsage.mock.calls.map((call) => call[0])).toEqual([
      { llmCalls: 1 },
      { inputTokens: 10, outputTokens: 2 },
      { inputTokens: 0, outputTokens: 3 },
      { toolCalls: 1 },
    ])
    expect(endIo).toHaveBeenCalledOnce()
  })

  it('读取工具持久化时只保留审计摘要，不保存文件正文', () => {
    const plain = toolResultForPersistence(
      'read_file',
      { file_path: 'notes/private.md', max_length: 10000 },
      '这是只应存在于当前 ReAct 内存中的私密正文',
      false,
    )
    expect(plain).not.toContain('私密正文')
    expect(JSON.parse(plain)).toEqual({
      ephemeral: true,
      kind: 'file_read_audit',
      path: 'notes/private.md',
      maxLength: 10000,
      returnedCharacters: 24,
    })

    const ranged = toolResultForPersistence(
      'read_file_range',
      { path: 'src/a.ts', line_start: 3, line_end: 5 },
      JSON.stringify({
        content: 'const secret = 1',
        hash: 'abc',
        totalBytes: 99,
        totalLines: 10,
        lineStart: 3,
        lineEnd: 5,
        truncated: true,
      }),
      false,
    )
    expect(ranged).not.toContain('const secret')
    expect(JSON.parse(ranged)).toMatchObject({
      ephemeral: true,
      path: 'src/a.ts',
      hash: 'abc',
      totalLines: 10,
      lineStart: 3,
      lineEnd: 5,
      returnedCharacters: 16,
    })
  })

  it('非读取工具与错误结果保持原样，避免破坏工具审计', () => {
    expect(toolResultForPersistence('edit_file', { path: 'a.ts' }, '{"success":true}', false)).toBe(
      '{"success":true}',
    )
    expect(
      toolResultForPersistence('read_file', { file_path: 'missing' }, '文件不存在', true),
    ).toBe('文件不存在')
  })

  it('应当流式输出文本并过滤 Thinking 内容', async () => {
    const llmService = {
      chatStream: vi.fn().mockReturnValue(
        streamFrom([
          { choices: [{ delta: { content: '你好' }, finishReason: null }] },
          {
            choices: [{ delta: { content: '<think>隐藏思考</think>世界' }, finishReason: null }],
          },
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
      expect.objectContaining({ event: 'thinking_start' }),
      expect.objectContaining({
        event: 'thinking_delta',
        data: expect.objectContaining({ delta: '隐藏思考' }),
      }),
      expect.objectContaining({ event: 'thinking_end' }),
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
      tools: [
        { name: 'lookup', description: '查询', parameters: { type: 'object' } },
        { name: 'finish_task', description: '完成', parameters: { type: 'object' } },
      ],
      toolExecutor,
      source: 'desktop',
      config: { maxTurns: 2 },
    })

    // 第七阶段修复（批次 B1）：execute 第 4 个参数现在是 toolRuntimeContext（含 agentId/sessionId）
    // 测试未传 agentId/threadContext，故 agentId 为 undefined，sessionId 默认 'default'
    const observedTools = llmService.chatStream.mock.calls.map((call) =>
      (
        (call[2] as { tools?: Array<{ type: string; function: { name: string } }> })?.tools ?? []
      ).map((tool) => tool.function.name),
    )
    expect(observedTools[0]).not.toContain('finish_task')
    expect(observedTools[1]).toContain('finish_task')
    expect(toolExecutor.execute).toHaveBeenCalledWith(
      'lookup',
      { q: '猫' },
      'desktop',
      expect.objectContaining({ sessionId: 'default' }),
    )
    expect(yields).toEqual([
      { event: 'status', data: { state: 'thinking', message: '正在思考...', turn: 1 } },
      {
        event: 'tool_call_start',
        data: { draftId: 'tool-draft-1-0', turn: 1, index: 0 },
      },
      expect.objectContaining({ event: 'tool_call_delta' }),
      expect.objectContaining({ event: 'tool_call_delta' }),
      '需要查找',
      {
        event: 'tool_call_ready',
        data: {
          draftId: 'tool-draft-1-0',
          callId: 'call-1',
          turn: 1,
          name: 'lookup',
          args: { q: '猫' },
        },
      },
      { event: 'tool_call', data: { name: 'lookup', args: { q: '猫' }, callId: 'call-1' } },
      { event: 'status', data: { state: 'calling', message: '正在调用工具: lookup', turn: 1 } },
      {
        event: 'tool_result',
        data: {
          name: 'lookup',
          callId: 'call-1',
          result: '工具结果',
          isError: false,
          durationMs: 12,
        },
      },
      { event: 'status', data: { state: 'thinking', message: '正在思考...', turn: 2 } },
      '完成',
    ])
    expect(messages).toEqual([
      { role: 'user', content: '查资料' },
      {
        role: 'assistant',
        content: '需要查找',
        reasoningContent: '',
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
    expect(result.contentBlocks.map((block) => [block.kind, block.sequence])).toEqual([
      ['narration', 1],
      ['tool', 2],
      ['narration', 3],
    ])
    expect(result.contentBlocks).toMatchObject([
      { kind: 'narration', phase: 'progress', content: '需要查找' },
      { kind: 'tool', callId: 'call-1', name: 'lookup', result: '工具结果' },
      { kind: 'narration', phase: 'final', content: '完成' },
    ])
    // 返回值已改为对象结构，工具调用列表在 result.toolCalls 字段
    expect(result.toolCalls).toEqual([
      {
        name: 'lookup',
        args: { q: '猫' },
        result: '工具结果',
        durationMs: 12,
        isError: false,
        callId: 'call-1',
      },
    ])
  })

  it('按行读取后应让同轮ReAct后继轮次看到正文和实际行范围', async () => {
    const rangeResult = JSON.stringify({
      content: '第101行\n第102行',
      totalBytes: 1_000,
      totalLines: 500,
      hash: 'abc',
      truncated: true,
      lineStart: 101,
      lineEnd: 102,
    })
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
                        id: 'call-read-range',
                        type: 'function',
                        function: {
                          name: 'read_file_range',
                          arguments: '{"path":"src/a.ts","line_start":101,"line_end":102}',
                        },
                      },
                    ],
                  },
                  finishReason: 'tool_calls',
                },
              ],
            },
          ]),
        )
        .mockReturnValueOnce(
          streamFrom([{ choices: [{ delta: { content: '读取完成。' }, finishReason: null }] }]),
        ),
    }

    const { result } = await collectLoop({
      llmService: llmService as never,
      modelConfig,
      messages: [{ role: 'user', content: '读取文件' }],
      tools: [
        {
          name: 'read_file_range',
          description: '按行读取文件',
          parameters: { type: 'object' },
        },
      ],
      toolExecutor: {
        execute: vi.fn().mockResolvedValue({
          output: rangeResult,
          durationMs: 1,
          isError: false,
          shouldTerminate: false,
        }),
      },
      source: 'desktop',
      config: { maxTurns: 2 },
    })

    expect(llmService.chatStream).toHaveBeenNthCalledWith(
      2,
      modelConfig,
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          toolCallId: 'call-read-range',
          content: rangeResult,
        }),
      ]),
      expect.any(Object),
    )
    expect(result.toolCalls[0]?.result).not.toContain('第101行')
    expect(JSON.parse(result.toolCalls[0]?.result ?? '{}')).toMatchObject({
      lineStart: 101,
      lineEnd: 102,
      totalLines: 500,
    })
  })

  it('未启用原生思考时工具续轮也应显式回传空reasoning_content', async () => {
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
                        id: 'call-list',
                        type: 'function',
                        function: { name: 'list_directory', arguments: '{"path":"."}' },
                      },
                    ],
                  },
                  finishReason: 'tool_calls',
                },
              ],
            },
          ]),
        )
        .mockReturnValueOnce(
          streamFrom([{ choices: [{ delta: { content: '目录读取完成。' }, finishReason: null }] }]),
        ),
    }
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({
        output: '[]',
        durationMs: 1,
        isError: false,
        shouldTerminate: false,
      }),
    }

    await collectLoop({
      llmService: llmService as never,
      modelConfig: { ...modelConfig, returnNativeReasoning: false },
      messages: [{ role: 'user', content: '列出目录' }],
      tools: [{ name: 'list_directory', description: '列出目录', parameters: { type: 'object' } }],
      toolExecutor,
      source: 'desktop',
      config: { maxTurns: 2 },
    })

    expect(llmService.chatStream).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          reasoningContent: '',
          toolCalls: [expect.objectContaining({ id: 'call-list' })],
        }),
      ]),
      expect.any(Object),
    )
  })

  it('工具审批拒绝后应在下一轮原样回传思考内容', async () => {
    const llmService = {
      chatStream: vi
        .fn()
        .mockReturnValueOnce(
          streamFrom([
            {
              choices: [
                {
                  delta: { reasoningContent: '用户要求打开应用，我需要调用工具。' },
                  finishReason: null,
                },
              ],
            },
            {
              choices: [
                {
                  delta: {
                    toolCalls: [
                      {
                        index: 0,
                        id: 'call-open',
                        type: 'function',
                        function: { name: 'open_application', arguments: '{"name":"calc"}' },
                      },
                    ],
                  },
                  finishReason: 'tool_calls',
                },
              ],
            },
          ]),
        )
        .mockReturnValueOnce(
          streamFrom([
            { choices: [{ delta: { content: '已取消打开应用。' }, finishReason: null }] },
          ]),
        ),
    }
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({
        output: JSON.stringify({ code: 'APPROVAL_DENIED', message: '用户拒绝了本次工具调用' }),
        durationMs: 5,
        isError: true,
        shouldTerminate: false,
      }),
    }

    await collectLoop({
      llmService: llmService as never,
      modelConfig,
      messages: [{ role: 'user', content: '打开计算器' }],
      tools: [
        { name: 'open_application', description: '打开应用', parameters: { type: 'object' } },
      ],
      toolExecutor,
      source: 'desktop',
      config: { maxTurns: 2 },
    })

    expect(llmService.chatStream).toHaveBeenNthCalledWith(
      2,
      modelConfig,
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          reasoningContent: '用户要求打开应用，我需要调用工具。',
          toolCalls: [expect.objectContaining({ id: 'call-open' })],
        }),
        expect.objectContaining({
          role: 'tool',
          toolCallId: 'call-open',
          content: expect.stringContaining('APPROVAL_DENIED'),
        }),
      ]),
      expect.any(Object),
    )
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
      signal: undefined,
      tools: [],
    })
    expect(messages[messages.length - 1]).toMatchObject({ role: 'system' })
    expect(result.toolCalls).toEqual([
      {
        name: 'broken',
        args: {},
        result: '失败',
        durationMs: 5,
        isError: true,
        callId: 'call-1',
      },
    ])
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
      (y) =>
        typeof y === 'object' && y !== null && (y as { event?: string }).event === 'tool_result',
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
        isError: true,
        callId: 'call-1',
      },
      {
        name: 'lookup',
        args: { q: '修正后的查询' },
        result: '查询结果',
        durationMs: 8,
        isError: false,
        callId: 'call-2',
      },
    ])
  })

  it('模型关闭stream时应使用非流式配置入口并保持统一Delta语义', async () => {
    const llmService = {
      chatStream: vi.fn(),
      chatConfigured: vi.fn().mockReturnValue(
        streamFrom([
          {
            choices: [{ delta: { content: '完整回复' }, finishReason: 'stop' }],
          },
        ]),
      ),
    }

    const { yields, result } = await collectLoop({
      llmService: llmService as never,
      modelConfig: { ...modelConfig, stream: false },
      messages: [{ role: 'user', content: '你好' }],
      tools: undefined,
      toolExecutor: undefined,
      source: 'desktop',
      config: { maxTurns: 1 },
    })

    expect(llmService.chatConfigured).toHaveBeenCalledTimes(1)
    expect(llmService.chatStream).not.toHaveBeenCalled()
    expect(yields).toContain('完整回复')
    expect(result.rawText).toContain('完整回复')
  })

  it('桌面截图应保留坐标上下文并剥离base64', async () => {
    let turn = 0
    const observedMessages: unknown[][] = []
    const llmService = {
      chatStream: vi.fn((_config, messages) => {
        observedMessages.push(messages)
        turn++
        if (turn === 1) {
          return streamFrom([
            {
              choices: [
                {
                  delta: {
                    toolCalls: [
                      {
                        index: 0,
                        id: 'screenshot-1',
                        type: 'function',
                        function: { name: 'take_screenshot', arguments: '{}' },
                      },
                    ],
                  },
                },
              ],
            },
          ])
        }
        return streamFrom([{ choices: [{ delta: { content: '已看到' } }] }])
      }),
    }
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({
        output: JSON.stringify({
          success: true,
          screenshots: [
            {
              index: 0,
              dataUri: 'data:image/png;base64,AAAA',
              coordinateContext: {
                displayId: '7',
                coordinateSpace: 'screenshot',
                screenshotWidth: 1280,
                screenshotHeight: 720,
                scaleFactor: 1.5,
              },
            },
          ],
          message: '已截取屏幕',
        }),
        durationMs: 1,
        isError: false,
      }),
    }

    await collectLoop({
      llmService: llmService as never,
      modelConfig: { ...modelConfig, enableVision: true },
      messages: [{ role: 'user', content: '截图' }],
      tools: [{ name: 'take_screenshot', description: '截图', parameters: {} }],
      toolExecutor,
      source: 'desktop',
      config: { maxTurns: 2 },
    })

    const secondTurn = JSON.stringify(observedMessages[1])
    expect(secondTurn).toContain('coordinateSpace=screenshot')
    expect(secondTurn).toContain('displayId=7')
    expect(secondTurn).toContain('screenshotWidth=1280')
    expect(secondTurn).toContain('image_url')
    expect(secondTurn.match(/AAAA/g)).toHaveLength(1)
  })

  it('高级工具应在展开前隐藏，并在展开后的后续轮次持续可用', async () => {
    let call = 0
    const observedTools: string[][] = []
    const llmService = {
      chatStream: vi.fn((_config, _messages, options) => {
        observedTools.push((options?.tools ?? []).map((tool) => tool.function.name))
        call++
        if (call === 1) {
          return streamFrom([
            {
              choices: [
                {
                  delta: {
                    toolCalls: [
                      {
                        index: 0,
                        id: 'expand-1',
                        type: 'function',
                        function: { name: 'expand_advanced_tools', arguments: '{}' },
                      },
                    ],
                  },
                },
              ],
            },
          ])
        }
        return streamFrom([{ choices: [{ delta: { content: '已看到高级工具' } }] }])
      }),
    }
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({
        output: '高级工具列表已展开',
        durationMs: 1,
        isError: false,
      }),
    }

    await collectLoop({
      llmService: llmService as never,
      modelConfig,
      messages: [{ role: 'user', content: '操作网页' }],
      tools: [
        { name: 'finish_task', description: '完成', parameters: {} },
        { name: 'expand_advanced_tools', description: '展开', parameters: {} },
        { name: 'browser_open_url', description: '打开网页', parameters: {} },
        { name: 'automation_execute', description: '桌面操作', parameters: {} },
        { name: 'remote_terminal_nodes', description: '远程节点', parameters: {} },
        { name: 'remote_terminal_create', description: '远程终端', parameters: {} },
        { name: 'take_screenshot', description: '截图', parameters: {} },
        { name: 'web_fetch', description: '读取网页', parameters: {} },
      ],
      toolExecutor,
      source: 'desktop',
      config: { maxTurns: 3 },
    })

    expect(observedTools[0]).toEqual(
      expect.arrayContaining(['expand_advanced_tools', 'take_screenshot', 'web_fetch']),
    )
    expect(observedTools[0]).not.toContain('finish_task')
    expect(observedTools[0]).not.toEqual(
      expect.arrayContaining([
        'browser_open_url',
        'automation_execute',
        'remote_terminal_nodes',
        'remote_terminal_create',
      ]),
    )
    expect(observedTools[1]).toEqual(
      expect.arrayContaining([
        'browser_open_url',
        'automation_execute',
        'remote_terminal_nodes',
        'remote_terminal_create',
      ]),
    )
    expect(observedTools[1]).not.toContain('finish_task')
  })

  it('load_skill成功后应刷新下一轮工具定义', async () => {
    const observedTools: string[][] = []
    const llmService = {
      chatStream: vi.fn((_config, _messages, options) => {
        observedTools.push(
          (options?.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name),
        )
        return observedTools.length === 1
          ? streamFrom([
              {
                choices: [
                  {
                    delta: {
                      content: null,
                      toolCalls: [
                        {
                          index: 0,
                          id: 'skill-1',
                          type: 'function',
                          function: { name: 'load_skill', arguments: '{"skill_id":"demo"}' },
                        },
                      ],
                    },
                  },
                ],
              },
            ])
          : streamFrom([{ choices: [{ delta: { content: '已加载' } }] }])
      }),
    }
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({
        output: 'Skill内容',
        durationMs: 1,
        isError: false,
        shouldTerminate: false,
      }),
    }

    await collectLoop({
      llmService: llmService as never,
      modelConfig,
      messages: [{ role: 'user', content: '加载技能' }],
      tools: [{ name: 'load_skill', description: '加载', parameters: { type: 'object' } }],
      refreshToolDefinitions: () => [
        { name: 'load_skill', description: '加载', parameters: { type: 'object' } },
        { name: 'new_tool', description: '新工具', parameters: { type: 'object' } },
      ],
      toolExecutor: toolExecutor as never,
      source: 'desktop',
      sessionId: 's1',
      agentId: 'pero',
    })

    expect(observedTools[0]).toEqual(['load_skill'])
    expect(observedTools[1]).toContain('new_tool')
  })

  it('首轮幻觉调用finish_task时应拒绝执行并要求自然回复', async () => {
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

    expect(llmService.chatStream).toHaveBeenCalledTimes(2)
    expect(toolExecutor.execute).not.toHaveBeenCalled()
    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        name: 'finish_task',
        args: {},
        isError: true,
        result: expect.stringContaining('尚未开放'),
      }),
    ])
  })
})
