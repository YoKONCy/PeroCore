import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAiProvider } from '@infos/backend/services/llm/providers/openaiProvider'

const config = { apiBase: 'https://models.test/v1', apiKey: 'test', modelId: 'test' }
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

describe('远程模型列表的失败边界', () => {
  it.each([401, 403, 429, 500])('HTTP %s 不能显示成功空列表或探测其他端点', async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('上游拒绝', { status }))
    await expect(new OpenAiProvider(config).listModels()).rejects.toMatchObject({
      data: { status },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([200, 403, 404])('HTTP %s 验证页不泄露 HTML、不触发端点回退', async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<!DOCTYPE html><title>Just a moment...</title>', {
        status,
        headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
      }),
    )
    await expect(new OpenAiProvider(config).listModels()).rejects.toMatchObject({
      message: expect.stringContaining('Cloudflare 人机验证'),
      data: { kind: 'challenge', retryable: false },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([404, 405])('HTTP %s 路由不支持时才允许兼容探测', async (status) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('不支持', { status }))
      .mockResolvedValueOnce(json({ models: ['b', { name: 'a' }, { id: 'b' }] }))
    await expect(new OpenAiProvider(config).listModels()).resolves.toEqual(['a', 'b'])
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      'https://models.test/v1/models',
      'https://models.test/v1/embeddings',
    ])
  })

  it('真实空列表直接返回，不探测其他端点', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ data: [] }))
    await expect(new OpenAiProvider(config).listModels()).resolves.toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('两个列表路由都不支持时提示手动填写', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response('不支持', { status: 404 }))
    await expect(new OpenAiProvider(config).listModels()).rejects.toThrow('请手动填写模型名称')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([{ unrelated: [] }, { data: [{}] }, null])(
    '损坏的列表结构必须报告失败：%j',
    async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body))
      await expect(new OpenAiProvider(config).listModels()).rejects.toMatchObject({
        code: 'LLM_ERROR',
      })
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it('无效 JSON 不能伪装成成功空列表', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{'))
    await expect(new OpenAiProvider(config).listModels()).rejects.toThrow('不是有效的 JSON')
  })
})
