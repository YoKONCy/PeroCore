import { afterEach, describe, expect, it, vi } from 'vitest'
import { LlmService, type ModelConfig } from '@infos/backend/services/llm/llmService'
import type { ChatDelta, ChatOptions, LlmProvider } from '@infos/backend/services/llm/types'

const model: ModelConfig = { provider: 'openai', modelId: 'test', apiKey: 'test' }
afterEach(() => vi.restoreAllMocks())

describe('退化生成的取消与重试边界', () => {
  it('取消真实请求信号、关闭迭代器，并阻止自动重试及多级模型回退', async () => {
    const service = new LlmService()
    let attempts = 0
    let signal: AbortSignal | undefined
    let closed = false
    vi.spyOn(service, 'createProvider').mockReturnValue({
      chat: vi.fn(),
      listModels: vi.fn(),
      getInputTokenPayload: () => ({}),
      async *chatStream(_messages, opts: ChatOptions): AsyncIterable<ChatDelta> {
        attempts++
        signal = opts.signal
        try {
          yield { choices: [{ delta: { content: '有效的前置进度。' } }] }
          yield {
            choices: [
              {
                delta: { reasoningContent: '反复检查相同的问题，没有发现新的信息。'.repeat(1000) },
              },
            ],
          }
        } finally {
          closed = true
        }
      },
    } as LlmProvider)
    const received: string[] = []
    const consume = async () => {
      for await (const delta of service.chatStream(
        { ...model, fallbackModels: [{ ...model, modelId: 'fallback' }] },
        [],
        {
          maxRetries: 5,
          retryPartialResponse: true,
        },
      )) {
        if (delta.retry) received.push('不应重试')
        for (const choice of delta.choices) received.push(choice.delta.content ?? '')
      }
    }
    await expect(consume()).rejects.toMatchObject({
      data: { loopDetected: true, retryable: false },
    })
    expect(attempts).toBe(1)
    expect(signal?.aborted).toBe(true)
    expect(closed).toBe(true)
    expect(received).toEqual(['有效的前置进度。'])
  })

  it('非流式的重复工具参数不能作为成功完成结果交给执行器', async () => {
    const service = new LlmService()
    const chat = vi.fn(async () => ({
      choices: [
        {
          message: {
            role: 'assistant' as const,
            content: '',
            toolCalls: [
              {
                id: 'call',
                type: 'function' as const,
                function: {
                  name: 'write_file',
                  arguments: '{"内容":"反复生成同一个字段"},'.repeat(6000),
                },
              },
            ],
          },
        },
      ],
    }))
    vi.spyOn(service, 'createProvider').mockReturnValue({
      chat,
      getInputTokenPayload: () => ({}),
    } as unknown as LlmProvider)
    await expect(service.chat(model, [])).rejects.toMatchObject({
      data: { loopDetected: true, channel: 'arguments:0:0' },
    })
    expect(chat).toHaveBeenCalledTimes(1)
  })
})
