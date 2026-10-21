import { describe, expect, it, vi } from 'vitest'
import { runReActLoop, type ToolExecutor } from '@infos/backend/services/agent/reactLoop'
import { RuntimeStateService } from '@infos/backend/services/runtime/runtimeStateService'
import { LlmService } from '@infos/backend/services/llm/llmService'
import type { ChatDelta, ChatOptions } from '@infos/backend/services/llm/types'

async function collect(params: Parameters<typeof runReActLoop>[0]) {
  const generator = runReActLoop(params)
  let next = await generator.next()
  while (!next.done) next = await generator.next()
  return next.value
}

describe('队列指令的安全交接', () => {
  it('中断上游生成，保留正文，未完成工具参数不执行且不重试', async () => {
    const runtime = new RuntimeStateService()
    runtime.registerTask('t', 'pero')
    const parent = runtime.getAbortSignal('t')!
    const service = new LlmService()
    const execute = vi.fn()
    const chatStream = vi.fn(async function* (
      _config: unknown,
      _messages: unknown,
      options: ChatOptions,
    ): AsyncIterable<ChatDelta> {
      yield { choices: [{ delta: { content: '已确认现有文件。' } }] }
      yield {
        choices: [
          {
            delta: {
              toolCalls: [
                {
                  index: 0,
                  id: 'draft',
                  type: 'function',
                  function: { name: 'edit_file', arguments: '{"path":' },
                },
              ],
            },
          },
        ],
      }
      runtime.requestHandoff('t')
      options.signal!.throwIfAborted()
    })
    try {
      const result = await collect({
        llmService: {
          chatStream,
          estimateInputTokens: service.estimateInputTokens.bind(service),
        } as never,
        modelConfig: { provider: 'openai', modelId: 'test', apiKey: 'test' },
        source: 'desktop',
        sessionId: 't',
        threadContext: { threadId: 't', executionId: 'execution-test' as never },
        messages: [{ role: 'user', content: '原请求' }],
        tools: [{ name: 'edit_file', description: '编辑文件', parameters: {} }],
        toolExecutor: { execute },
        cancelChecker: runtime,
        signal: parent,
      })
      expect(parent.aborted).toBe(false)
      expect(execute).not.toHaveBeenCalled()
      expect(chatStream).toHaveBeenCalledOnce()
      expect(result.rawText).toContain('已确认现有文件')
      expect(result.contentBlocks).toContainEqual(
        expect.objectContaining({ kind: 'tool', isError: true, args: '{}' }),
      )
    } finally {
      runtime.unregisterTask('t')
    }
  })

  it('工具已经开始时先保留回传，剩余调用补齐未执行结果后停止旧 ReAct', async () => {
    const runtime = new RuntimeStateService()
    runtime.registerTask('t', 'pero')
    const service = new LlmService()
    const chatStream = vi.fn(async function* (): AsyncIterable<ChatDelta> {
      yield {
        choices: [
          {
            delta: {
              toolCalls: ['a', 'b'].map((id, index) => ({
                index,
                id,
                type: 'function' as const,
                function: {
                  name: 'edit_file',
                  arguments: JSON.stringify({ path: `${id}.ts`, old_text: 'x', new_text: 'y' }),
                },
              })),
            },
            finishReason: 'tool_calls',
          },
        ],
      }
    })
    const execute: ToolExecutor['execute'] = vi.fn(async () => {
      runtime.requestHandoff('t')
      expect(runtime.getAbortSignal('t')!.aborted).toBe(false)
      return { output: '文件已写入', isError: false, durationMs: 1, shouldTerminate: false }
    })
    try {
      const result = await collect({
        llmService: {
          chatStream,
          estimateInputTokens: service.estimateInputTokens.bind(service),
        } as never,
        modelConfig: { provider: 'openai', modelId: 'test', apiKey: 'test' },
        source: 'desktop',
        sessionId: 't',
        threadContext: { threadId: 't', executionId: 'execution-test' as never },
        messages: [{ role: 'user', content: '原请求' }],
        tools: [{ name: 'edit_file', description: '编辑文件', parameters: {} }],
        toolExecutor: { execute },
        cancelChecker: runtime,
        signal: runtime.getAbortSignal('t'),
      })
      expect(execute).toHaveBeenCalledOnce()
      expect(result.messages).toContainEqual(
        expect.objectContaining({
          role: 'tool',
          toolCallId: 'a',
          content: expect.stringContaining('文件已写入'),
        }),
      )
      expect(result.messages).toContainEqual(
        expect.objectContaining({
          role: 'tool',
          toolCallId: 'b',
          content: expect.stringContaining('尚未执行'),
        }),
      )
      expect(chatStream).toHaveBeenCalledOnce()
    } finally {
      runtime.unregisterTask('t')
    }
  })
})
