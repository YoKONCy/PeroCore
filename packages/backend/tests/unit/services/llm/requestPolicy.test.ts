import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLlmResponse, combinedOutputLimit } from '@infos/backend/services/llm/requestPolicy'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('模型请求生命周期', () => {
  it('持续返回数据时跨过最初的超时时刻仍可继续，真正空闲后才终止', async () => {
    vi.useFakeTimers()
    let sink!: ReadableStreamDefaultController<Uint8Array>
    let signal!: AbortSignal
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init: RequestInit) => {
        signal = init.signal as AbortSignal
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              sink = controller
              signal.addEventListener('abort', () => controller.error(signal.reason), {
                once: true,
              })
            },
          }),
        )
      }),
    )
    const response = await fetchLlmResponse('https://model.invalid', {}, { timeout: 1000 }, 'test')
    const reader = response.body!.getReader()
    await vi.advanceTimersByTimeAsync(800)
    sink.enqueue(new TextEncoder().encode('思考片段'))
    expect((await reader.read()).done).toBe(false)
    await vi.advanceTimersByTimeAsync(800)
    expect(signal.aborted).toBe(false)
    const failed = expect(reader.read()).rejects.toMatchObject({ code: 'LLM_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(201)
    await failed
  })

  it('调用方停止读取后释放请求计时器和上游连接', async () => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init: RequestInit) => {
        signal = init.signal as AbortSignal
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1]))
            },
          }),
        )
      }),
    )
    const response = await fetchLlmResponse('https://model.invalid', {}, {}, 'test')
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()
    expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('正文额度保留完整空间，并额外预留思考；关闭思考时不预留', () => {
    const bodyBudget = 4096
    expect(combinedOutputLimit({ maxTokens: bodyBudget, reasoningEffort: 'high' })).toBeGreaterThan(
      bodyBudget,
    )
    expect(combinedOutputLimit({ maxTokens: bodyBudget, reasoningEffort: 'off' }, true)).toBe(
      bodyBudget,
    )
    expect(combinedOutputLimit({})).toBeUndefined()
  })
})
