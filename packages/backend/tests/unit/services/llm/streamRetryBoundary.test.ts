import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LlmService } from '../../../../src/services/llm/llmService'
import type { ChatDelta, LlmProvider } from '../../../../src/services/llm/types'
import { AppError } from '../../../../src/lib/appError'
import * as retryPolicy from '../../../../src/services/llm/retryPolicy'

afterEach(() => vi.restoreAllMocks())
beforeEach(() => vi.spyOn(retryPolicy, 'waitForRetry').mockResolvedValue(undefined))
const config = {
  provider: 'openai',
  modelId: 'test',
  apiKey: '',
  apiBase: 'https://example.invalid',
}

describe('流式模型重试边界', () => {
  it.each([
    { reasoningContent: '已交付的思考' },
    { nativeReasoning: [{ format: 'reasoning_content' as const, text: '已交付的原生思考' }] },
    { toolCalls: [{ index: 0, function: { arguments: '{"content":"片段' } }] },
  ])('输出思考或工具参数后不拼接第二次请求', async (delta) => {
    const stream = vi.fn(async function* () {
      yield { choices: [{ delta }] } satisfies ChatDelta
      throw new AppError('LLM_TIMEOUT', { message: '模拟流式中断' })
    })
    const provider = { chatStream: stream } as unknown as LlmProvider
    const service = new LlmService()
    vi.spyOn(
      service as unknown as { createProvider: () => LlmProvider },
      'createProvider',
    ).mockReturnValue(provider)
    const received: ChatDelta[] = []
    await expect(
      (async () => {
        for await (const item of service.chatStream(config, [{ role: 'user', content: '测试' }]))
          received.push(item)
      })(),
    ).rejects.toMatchObject({ code: 'LLM_TIMEOUT' })
    expect(stream).toHaveBeenCalledTimes(1)
    expect(received).toHaveLength(1)
  })

  it('没有任何模型输出时仍可自动重试', async () => {
    const stream = vi
      .fn()
      .mockImplementationOnce(async function* () {
        yield* []
        throw new AppError('LLM_TIMEOUT', { message: '模拟首包前中断', data: { retryable: true } })
      })
      .mockImplementationOnce(async function* () {
        yield { choices: [{ delta: { content: '成功' }, finishReason: 'stop' }] }
      })
    const service = new LlmService()
    vi.spyOn(
      service as unknown as { createProvider: () => LlmProvider },
      'createProvider',
    ).mockReturnValue({ chatStream: stream } as unknown as LlmProvider)
    const received: ChatDelta[] = []
    for await (const item of service.chatStream(config, [{ role: 'user', content: '测试' }]))
      received.push(item)
    expect(stream).toHaveBeenCalledTimes(2)
    expect(received.filter((delta) => !delta.retry)).toHaveLength(1)
    expect(received.filter((delta) => delta.retry).map((delta) => delta.retry?.state)).toEqual([
      'waiting',
      'retrying',
      'recovered',
    ])
  })

  it('ReAct 可重新请求中断响应，每次重试各保留一条原始记录', async () => {
    let calls = 0
    const stream = vi.fn(async function* () {
      calls++
      if (calls < 3) {
        yield { choices: [{ delta: { reasoningContent: `思考片段${calls}` } }] }
        throw new TypeError('terminated')
      }
      yield { choices: [{ delta: { content: '最终回复' }, finishReason: 'stop' }] }
    })
    const service = new LlmService()
    vi.spyOn(
      service as unknown as { createProvider: () => LlmProvider },
      'createProvider',
    ).mockReturnValue({ chatStream: stream } as unknown as LlmProvider)
    const received: ChatDelta[] = []
    for await (const delta of service.chatStream(config, [{ role: 'user', content: '测试' }], {
      retryPartialResponse: true,
      maxRetries: 5,
    }))
      received.push(delta)
    const records = received.flatMap((delta) =>
      delta.retry?.state === 'waiting' ? [delta.retry] : [],
    )
    expect(records.map((record) => record.attempt)).toEqual([1, 2])
    expect(new Set(records.map((record) => record.retryId)).size).toBe(2)
    for (const record of records) {
      for (const update of received.flatMap((delta) =>
        delta.retry?.retryId === record.retryId ? [delta.retry] : [],
      )) {
        expect(update).toMatchObject({
          retryId: record.retryId,
          attempt: record.attempt,
          maxRetries: 5,
          reason: record.reason,
          startedAt: record.startedAt,
          delayMs: record.delayMs,
        })
      }
    }
    expect(stream).toHaveBeenCalledTimes(3)
  })

  it('没有完成标记的 EOF 不能伪装正常结束，达到上限后明确失败', async () => {
    const stream = vi.fn(async function* () {
      yield { choices: [{ delta: { content: '半截正文' } }] }
    })
    const service = new LlmService()
    vi.spyOn(
      service as unknown as { createProvider: () => LlmProvider },
      'createProvider',
    ).mockReturnValue({ chatStream: stream } as unknown as LlmProvider)
    await expect(
      (async () => {
        for await (const delta of service.chatStream(config, [{ role: 'user', content: '测试' }], {
          retryPartialResponse: true,
          maxRetries: 1,
        }))
          void delta
      })(),
    ).rejects.toThrow('未收到模型完成标记')
    expect(stream).toHaveBeenCalledTimes(2)
  })

  it('退避期间取消不会再发请求，最后一条通知会结束动画', async () => {
    const controller = new AbortController()
    vi.mocked(retryPolicy.waitForRetry).mockImplementationOnce(async () => {
      controller.abort(new Error('用户停止'))
      throw controller.signal.reason
    })
    const stream = vi.fn(async function* () {
      yield* []
      throw new TypeError('fetch failed')
    })
    const service = new LlmService()
    vi.spyOn(
      service as unknown as { createProvider: () => LlmProvider },
      'createProvider',
    ).mockReturnValue({ chatStream: stream } as unknown as LlmProvider)
    const states: string[] = []
    await expect(
      (async () => {
        for await (const delta of service.chatStream(config, [], {
          signal: controller.signal,
          maxRetries: 5,
        }))
          if (delta.retry) states.push(delta.retry.state)
      })(),
    ).rejects.toThrow('用户停止')
    expect(states).toEqual(['waiting', 'cancelled'])
    expect(stream).toHaveBeenCalledTimes(1)
  })

  it('非流式模式在响应返回前交付每次重试记录', async () => {
    const chat = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: '成功' }, finishReason: 'stop' }],
      })
    const service = new LlmService()
    vi.spyOn(
      service as unknown as { createProvider: () => LlmProvider },
      'createProvider',
    ).mockReturnValue({ chat } as unknown as LlmProvider)
    const received: ChatDelta[] = []
    for await (const delta of service.chatConfigured({ ...config, stream: false }, [], {
      maxRetries: 5,
    }))
      received.push(delta)
    expect(received.flatMap((delta) => (delta.retry ? [delta.retry.state] : []))).toEqual([
      'waiting',
      'retrying',
      'recovered',
    ])
    expect(received.at(-1)?.choices[0]?.delta.content).toBe('成功')
  })
})
