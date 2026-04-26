import { describe, expect, it, vi } from 'vitest'
import { runSynthesis, runSynthesisStream } from '@perocore/backend/services/pipeline/synthesis'
import type { ModelConfig } from '@perocore/backend/services/llm/llmService'
import type { ChatCompletion, ChatDelta } from '@perocore/backend/services/llm/types'

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

function createCompletion(
  content: string | null,
  toolCalls: ChatCompletion['choices'][number]['message']['toolCalls'] = [],
) {
  return {
    choices: [
      {
        message: {
          role: 'assistant' as const,
          content,
          toolCalls,
        },
      },
    ],
  } satisfies ChatCompletion
}

describe('runSynthesis', () => {
  it('应当在没有工具调用时返回模型文本', async () => {
    const llmService = {
      chat: vi.fn().mockResolvedValue(createCompletion('你好，主人')),
    }

    const result = await runSynthesis(
      { llmService: llmService as never, modelConfig },
      { messages: [{ role: 'user', content: '打招呼' }], source: 'unit' },
    )

    expect(llmService.chat).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ text: '你好，主人', toolCalls: [], usage: null })
  })

  it('应当执行工具调用并把工具结果注入下一轮上下文', async () => {
    const toolCall = {
      id: 'call-1',
      type: 'function' as const,
      function: { name: 'search_memory', arguments: '{"query":"猫猫"}' },
    }
    const llmService = {
      chat: vi
        .fn()
        .mockResolvedValueOnce(createCompletion('', [toolCall]))
        .mockResolvedValueOnce(createCompletion('找到了猫猫记忆')),
    }
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue('工具结果'),
    }

    const result = await runSynthesis(
      { llmService: llmService as never, modelConfig, toolExecutor },
      { messages: [{ role: 'user', content: '查记忆' }], source: 'unit' },
    )

    expect(toolExecutor.execute).toHaveBeenCalledWith('search_memory', { query: '猫猫' })
    expect(llmService.chat).toHaveBeenLastCalledWith(
      modelConfig,
      [
        { role: 'user', content: '查记忆' },
        { role: 'assistant', content: '', toolCalls: [toolCall] },
        { role: 'tool', content: '工具结果', toolCallId: 'call-1' },
      ],
      { tools: undefined },
    )
    expect(result.text).toBe('找到了猫猫记忆')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]).toMatchObject({
      name: 'search_memory',
      args: { query: '猫猫' },
      result: '工具结果',
    })
  })

  it('应当把工具执行异常转换为工具结果并继续生成', async () => {
    const toolCall = {
      id: 'call-err',
      type: 'function' as const,
      function: { name: 'broken_tool', arguments: '{"id":1}' },
    }
    const llmService = {
      chat: vi
        .fn()
        .mockResolvedValueOnce(createCompletion(null, [toolCall]))
        .mockResolvedValueOnce(createCompletion('已处理失败')),
    }
    const toolExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('工具坏掉了')),
    }

    const result = await runSynthesis(
      { llmService: llmService as never, modelConfig, toolExecutor },
      { messages: [{ role: 'user', content: '执行工具' }], source: 'unit' },
    )

    expect(result.text).toBe('已处理失败')
    expect(result.toolCalls[0]).toMatchObject({
      name: 'broken_tool',
      args: { id: 1 },
      result: '工具执行失败: 工具坏掉了',
    })
  })

  it('应当在模型没有返回 choice 时返回空文本', async () => {
    const llmService = {
      chat: vi.fn().mockResolvedValue({ choices: [] }),
    }

    const result = await runSynthesis(
      { llmService: llmService as never, modelConfig },
      { messages: [], source: 'unit' },
    )

    expect(result).toEqual({ text: '', toolCalls: [], usage: null })
  })
})

describe('runSynthesisStream', () => {
  it('应当流式输出状态和文本增量', async () => {
    const llmService = {
      chatStream: vi
        .fn()
        .mockReturnValue(
          streamFrom([
            { choices: [{ delta: { content: '你' } }] },
            { choices: [{ delta: { content: '好' } }] },
          ]),
        ),
    }

    const generator = runSynthesisStream(
      { llmService: llmService as never, modelConfig },
      { messages: [{ role: 'user', content: '打招呼' }], source: 'unit' },
    )
    const events = []
    let next = await generator.next()
    while (!next.done) {
      events.push(next.value)
      next = await generator.next()
    }

    expect(events).toEqual([
      { event: 'status', data: { state: 'generating', message: '正在生成...', turn: 1 } },
      { event: 'delta', data: { content: '你' } },
      { event: 'delta', data: { content: '好' } },
    ])
    expect(next.value).toEqual({ text: '你好', toolCalls: [], usage: null })
  })

  it('应当累积跨 chunk 的工具参数并发送工具事件', async () => {
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
                        function: { name: 'lookup', arguments: '{"q"' },
                      },
                    ],
                  },
                },
              ],
            },
            {
              choices: [
                {
                  delta: {
                    toolCalls: [{ index: 0, id: 'call-1', function: { arguments: ':"猫"}' } }],
                  },
                },
              ],
            },
          ]),
        )
        .mockReturnValueOnce(streamFrom([{ choices: [{ delta: { content: '完成' } }] }])),
    }
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue('查找结果'),
    }

    const generator = runSynthesisStream(
      { llmService: llmService as never, modelConfig, toolExecutor },
      { messages: [{ role: 'user', content: '查找' }], source: 'unit' },
    )
    const events = []
    let next = await generator.next()
    while (!next.done) {
      events.push(next.value)
      next = await generator.next()
    }

    expect(toolExecutor.execute).toHaveBeenCalledWith('lookup', { q: '猫' })
    expect(events).toEqual([
      { event: 'status', data: { state: 'generating', message: '正在生成...', turn: 1 } },
      { event: 'tool_call', data: { name: 'lookup', args: { q: '猫' } } },
      { event: 'status', data: { state: 'calling', message: '正在调用 lookup...', turn: 1 } },
      {
        event: 'tool_result',
        data: { name: 'lookup', result: '查找结果', durationMs: expect.any(Number) },
      },
      {
        event: 'status',
        data: { state: 'generating', message: '继续生成 (工具调用轮次 1)...', turn: 2 },
      },
      { event: 'delta', data: { content: '完成' } },
    ])
    expect(next.value).toMatchObject({
      text: '完成',
      toolCalls: [{ name: 'lookup', args: { q: '猫' }, result: '查找结果' }],
      usage: null,
    })
  })

  it('应当在流式工具参数不是 JSON 时保留原始参数', async () => {
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
                        id: 'call-raw',
                        type: 'function',
                        function: { name: 'raw_tool', arguments: '不是JSON' },
                      },
                    ],
                  },
                },
              ],
            },
          ]),
        )
        .mockReturnValueOnce(streamFrom([])),
    }
    const toolExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('执行失败')),
    }

    const generator = runSynthesisStream(
      { llmService: llmService as never, modelConfig, toolExecutor },
      { messages: [{ role: 'user', content: '原始参数' }], source: 'unit' },
    )
    const events = []
    let next = await generator.next()
    while (!next.done) {
      events.push(next.value)
      next = await generator.next()
    }

    expect(toolExecutor.execute).toHaveBeenCalledWith('raw_tool', { raw: '不是JSON' })
    expect(events).toContainEqual({
      event: 'tool_call',
      data: { name: 'raw_tool', args: { raw: '不是JSON' } },
    })
    expect(events).toContainEqual({
      event: 'tool_result',
      data: { name: 'raw_tool', result: '工具执行失败: 执行失败', durationMs: expect.any(Number) },
    })
  })
})
