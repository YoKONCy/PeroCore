import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiEmbeddingProvider } from '@infos/backend/services/embedding/providers/apiProvider'
import { EmbeddingService } from '@infos/backend/services/embedding/embeddingService'

const config = {
  apiBase: 'https://embedding.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
  dimension: 3,
}
const challenge = () =>
  new Response('<!DOCTYPE html><title>Just a moment...</title>', {
    status: 403,
    headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge', 'cf-ray': 'test-ray' },
  })
const success = () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }] }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-18T00:00:00Z'))
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('向量服务故障冷却', () => {
  it('验证页返回明确原因，冷却不发送请求，也不把已启用服务视作关闭', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(challenge())
    const service = new EmbeddingService(config)
    await expect(service.embedOne('初次请求')).rejects.toMatchObject({
      code: 'EMBEDDING_ERROR',
      message: expect.stringContaining('Cloudflare 人机验证'),
      data: { kind: 'challenge', rayId: 'test-ray', retryable: false },
    })
    expect(service.isAvailable).toBe(true)
    await expect(service.embedOne('后续检索')).rejects.toMatchObject({
      message: expect.not.stringContaining('<!DOCTYPE'),
      data: { cooldown: true, retryAfter: 300_000 },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('冷却后只允许一个恢复探测，恢复成功再放开请求', async () => {
    let complete!: (value: Response) => void
    vi.mocked(fetch)
      .mockResolvedValueOnce(challenge())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve
          }),
      )
      .mockImplementation(async () => success())
    const provider = new ApiEmbeddingProvider(config)
    await expect(provider.embedOne('触发冷却')).rejects.toThrow('Cloudflare')
    vi.setSystemTime(Date.now() + 300_000)
    const probe = provider.embedOne('恢复探测')
    await expect(provider.embedOne('并发检索')).rejects.toMatchObject({
      message: expect.stringContaining('恢复探测进行中'),
      data: { cooldown: true },
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    complete(success())
    await expect(probe).resolves.toEqual([1, 2, 3])
    await expect(provider.embedOne('正常检索')).resolves.toEqual([1, 2, 3])
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('限流遵守 Retry-After，到期前不重试', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response('请求过多', {
          status: 429,
          headers: { 'Retry-After': '120' },
        }),
      )
      .mockImplementation(async () => success())
    const provider = new ApiEmbeddingProvider(config)
    await expect(provider.embedOne('首次')).rejects.toMatchObject({ code: 'LLM_RATE_LIMITED' })
    vi.setSystemTime(Date.now() + 119_000)
    await expect(provider.embedOne('仍限流')).rejects.toMatchObject({ data: { retryAfter: 1000 } })
    expect(fetch).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 1000)
    await expect(provider.embedOne('恢复')).resolves.toEqual([1, 2, 3])
  })

  it('网络故障短暂冷却后自动恢复', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('连接失败'))
      .mockImplementation(async () => success())
    const provider = new ApiEmbeddingProvider(config)
    await expect(provider.embedOne('首次')).rejects.toThrow('连接失败')
    await expect(provider.embedOne('冷却')).rejects.toMatchObject({ data: { retryAfter: 30_000 } })
    vi.setSystemTime(Date.now() + 30_000)
    await expect(provider.embedOne('恢复')).resolves.toEqual([1, 2, 3])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('主动取消不会触发冷却，后续请求可立即执行', async () => {
    const controller = new AbortController()
    vi.mocked(fetch)
      .mockImplementationOnce(async () => {
        controller.abort(new Error('用户已停止'))
        throw controller.signal.reason
      })
      .mockImplementation(async () => success())
    const provider = new ApiEmbeddingProvider(config)
    await expect(provider.embedOne('取消', controller.signal)).rejects.toThrow('用户已停止')
    await expect(provider.embedOne('继续')).resolves.toEqual([1, 2, 3])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('修改配置立即重置旧冷却，不能沿用旧地址的失败状态', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(challenge())
      .mockImplementation(async () => success())
    const service = new EmbeddingService(config)
    await expect(service.embedOne('旧服务')).rejects.toThrow('Cloudflare')
    service.reconfigure({ ...config, apiBase: 'https://new.test/v1' })
    await expect(service.embedOne('新服务')).resolves.toEqual([1, 2, 3])
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe('https://new.test/v1/embeddings')
  })

  it('旧配置迟到的失败不能污染已经切换的新服务', async () => {
    let complete!: (value: Response) => void
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve
          }),
      )
      .mockImplementation(async () => success())
    const service = new EmbeddingService(config)
    const old = service.embedOne('旧请求')
    const rejected = expect(old).rejects.toThrow('向量配置已变更')
    service.reconfigure({ ...config, apiBase: 'https://new.test/v1' })
    await expect(service.embedOne('新请求')).resolves.toEqual([1, 2, 3])
    complete(challenge())
    await rejected
    await expect(service.embedOne('继续请求')).resolves.toEqual([1, 2, 3])
  })

  it('成功状态码中的网页也不能当作向量写入', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html>错误的网页入口</html>', {
        headers: { 'content-type': 'text/html' },
      }),
    )
    const provider = new ApiEmbeddingProvider(config)
    await expect(provider.embedOne('请求')).rejects.toMatchObject({
      message: expect.stringContaining('返回了网页而非 API JSON'),
      data: { kind: 'html' },
    })
    await expect(provider.embedOne('冷却')).rejects.toMatchObject({ data: { cooldown: true } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('迟到的旧请求成功不能解除较新请求触发的冷却', async () => {
    let complete!: (value: Response) => void
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve
          }),
      )
      .mockResolvedValueOnce(challenge())
    const provider = new ApiEmbeddingProvider(config)
    const old = provider.embedOne('较早请求')
    await expect(provider.embedOne('较新请求')).rejects.toThrow('Cloudflare')
    complete(success())
    await expect(old).resolves.toEqual([1, 2, 3])
    await expect(provider.embedOne('不能冲掉冷却')).rejects.toMatchObject({
      data: { cooldown: true },
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('恢复探测取消后不占用探测名额', async () => {
    const controller = new AbortController()
    vi.mocked(fetch)
      .mockResolvedValueOnce(challenge())
      .mockImplementationOnce(async () => {
        controller.abort(new Error('取消探测'))
        throw controller.signal.reason
      })
      .mockImplementation(async () => success())
    const provider = new ApiEmbeddingProvider(config)
    await expect(provider.embedOne('失败')).rejects.toThrow('Cloudflare')
    vi.setSystemTime(Date.now() + 300_000)
    await expect(provider.embedOne('探测', controller.signal)).rejects.toThrow('取消探测')
    await expect(provider.embedOne('再次探测')).resolves.toEqual([1, 2, 3])
  })
})
