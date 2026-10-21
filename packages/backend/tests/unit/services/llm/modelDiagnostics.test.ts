import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAiProvider } from '@infos/backend/services/llm/providers/openaiProvider'
import { modelNetworkDetails, safeModelDiagnostic } from '@infos/backend/services/llm/diagnostics'

const model = { modelId: 'gemini-test', apiKey: 'test', apiBase: 'https://model.invalid/v1' }
afterEach(() => vi.unstubAllGlobals())

describe('模型故障诊断与确定性错误', () => {
  it('保留 fetch failed 下面的实际网络错误码与 cause', async () => {
    const cause = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    const failure = new TypeError('fetch failed', { cause })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure))
    await expect(new OpenAiProvider(model).chat([], {})).rejects.toMatchObject({
      cause: failure,
      message: expect.stringContaining('ECONNRESET'),
      data: {
        retryable: true,
        networkDetails: expect.arrayContaining(['ECONNRESET: connection reset']),
      },
    })
  })

  it.each([
    ["mime type is not supported by Gemini: 'image/gif'", false],
    ['upstream temporarily unavailable', true],
  ])('HTTP 500 按实际原因判断是否重试：%s', async (message, retryable) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ error: { message } }), { status: 500 })),
    )
    await expect(new OpenAiProvider(model).chat([], {})).rejects.toMatchObject({
      data: { status: 500, retryable },
    })
  })

  it('媒体正文与认证令牌不出现在诊断文字中，聚合错误仍保留错误码', () => {
    expect(
      safeModelDiagnostic(
        'data:image/gif;base64,R0lGODlhAQABAIA= Bearer secret-token https://x.test?a=1&api_key=hidden',
      ),
    ).not.toMatch(/R0lGODlh|secret-token|api_key=hidden/)
    const failure = new AggregateError(
      [Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' })],
      'fetch failed',
    )
    expect(modelNetworkDetails(failure)).toContain('ETIMEDOUT: connect timeout')
  })
})
