import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAiProvider } from '../../../../../src/services/llm/providers/openaiProvider'
import { OpenAiResponsesProvider } from '../../../../../src/services/llm/providers/openaiResponsesProvider'

const config = { apiKey: 'test', apiBase: 'https://example.invalid/v1', modelId: 'test' }
afterEach(() => vi.unstubAllGlobals())

describe('上游错误重试分类', () => {
  it('OpenAI 验证页不能作为临时故障反复重试', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response('<!DOCTYPE html><title>Just a moment...</title>', {
            status: 403,
            headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
          }),
      ),
    )
    const provider = new OpenAiProvider(config)
    await expect(provider.chat([], {})).rejects.toMatchObject({
      message: expect.stringContaining('Cloudflare 人机验证'),
      data: { status: 403, retryable: false },
    })
    await expect(
      (async () => {
        for await (const delta of provider.chatStream([], {})) void delta
      })(),
    ).rejects.toMatchObject({ data: { kind: 'challenge', retryable: false } })
  })

  it.each([
    { status: 503, body: '暂时不可用', retryable: true },
    { status: 401, body: '鉴权失败', retryable: false },
    { status: 429, body: 'insufficient_quota', retryable: false },
  ])('Responses HTTP $status 不能遗漏或误判重试标记', async ({ status, body, retryable }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(body, { status, headers: { 'Retry-After': '2' } })),
    )
    await expect(new OpenAiResponsesProvider(config).chat([], {})).rejects.toMatchObject({
      data: { status, retryable, retryAfter: 2000 },
    })
  })

  it('OpenAI 流内错误直接向上报告，不能被坏 JSON 兼容逻辑吞掉', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('data: {"error":{"type":"server_error","message":"上游过载"}}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
    )
    await expect(
      (async () => {
        for await (const delta of new OpenAiProvider(config).chatStream([], {})) void delta
      })(),
    ).rejects.toMatchObject({ message: '上游过载', data: { retryable: true } })
  })

  it('兼容仅有 DONE 的完成标记，不将明确完成误判成 EOF 中断', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('data: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
    )
    const reasons: Array<string | null | undefined> = []
    for await (const delta of new OpenAiProvider(config).chatStream([], {}))
      reasons.push(delta.choices[0]?.finishReason)
    expect(reasons.at(-1)).toBe('stop')
  })
})
