import { jsonBody } from '../../../helpers/jsonBody'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiEmbeddingProvider } from '@infos/backend/services/embedding/providers/apiProvider'
import { ApiRerankerProvider } from '@infos/backend/services/embedding/providers/apiReranker'
import {
  EmbeddingService,
  type EmbeddingConfig,
} from '@infos/backend/services/embedding/embeddingService'

const embeddingConfig: EmbeddingConfig = {
  apiBase: 'https://example.test/v1/',
  apiKey: 'embedding-key',
  model: 'embedding-model',
  dimension: 3,
}

describe('ApiEmbeddingProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('应当请求 Embedding API 并按 index 还原向量顺序', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          { index: 1, embedding: [2, 2, 2] },
          { index: 0, embedding: [1, 1, 1] },
        ],
      }),
    } as never)
    const provider = new ApiEmbeddingProvider(embeddingConfig)

    const vectors = await provider.embed(['第一段', '第二段'])

    expect(fetch).toHaveBeenCalledWith('https://example.test/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer embedding-key',
      },
      body: jsonBody({
        input: ['第一段', '第二段'],
        model: 'embedding-model',
        dimensions: 3,
      }),
      signal: expect.any(AbortSignal),
    })
    expect(vectors).toEqual([
      [1, 1, 1],
      [2, 2, 2],
    ])
  })

  it('应当在空输入时直接返回空数组', async () => {
    const provider = new ApiEmbeddingProvider(embeddingConfig)

    const vectors = await provider.embed([])

    expect(fetch).not.toHaveBeenCalled()
    expect(vectors).toEqual([])
  })

  it('拒绝维度不匹配的向量，不能作为零向量悄悄写入索引', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [1, 2] }] }),
    } as never)
    await expect(new ApiEmbeddingProvider(embeddingConfig).embedOne('测试')).rejects.toMatchObject({
      code: 'EMBEDDING_ERROR',
      message: expect.stringContaining('配置 3 维，实际 2 维'),
    })
  })

  it('应当把 429 响应转换为限流错误', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue('请求太多'),
    } as never)
    const provider = new ApiEmbeddingProvider(embeddingConfig)

    await expect(provider.embedOne('文本')).rejects.toMatchObject({
      code: 'LLM_RATE_LIMITED',
      message: expect.stringContaining('请求太多'),
    })
  })

  it('应当把网络异常转换为 Embedding 错误', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('网络断开'))
    const provider = new ApiEmbeddingProvider(embeddingConfig)

    await expect(provider.embedOne('文本')).rejects.toMatchObject({
      code: 'EMBEDDING_ERROR',
      message: expect.stringContaining('网络断开'),
    })
  })
})

describe('ApiRerankerProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('应当请求 Reranker API 并解析带文档的结果', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        results: [
          { index: 1, relevance_score: 0.9, document: { text: '文档二' } },
          { index: 0, relevance_score: 0.7 },
        ],
      }),
    } as never)
    const provider = new ApiRerankerProvider({
      apiBase: 'https://rerank.test/api/',
      apiKey: 'rerank-key',
      model: 'rerank-model',
      defaultTopK: 5,
    })

    const results = await provider.rerank('问题', ['文档一', '文档二'], 10)

    expect(fetch).toHaveBeenCalledWith('https://rerank.test/api/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer rerank-key',
      },
      body: jsonBody({
        model: 'rerank-model',
        query: '问题',
        documents: ['文档一', '文档二'],
        top_n: 2,
        return_documents: true,
      }),
      signal: expect.any(AbortSignal),
    })
    expect(results).toEqual([
      { index: 1, score: 0.9, text: '文档二' },
      { index: 0, score: 0.7, text: '文档一' },
    ])
  })

  it('应当在候选文档为空时直接返回空数组', async () => {
    const provider = new ApiRerankerProvider({
      apiBase: 'https://rerank.test',
      apiKey: 'rerank-key',
      model: 'rerank-model',
      defaultTopK: 3,
    })

    const results = await provider.rerank('问题', [])

    expect(fetch).not.toHaveBeenCalled()
    expect(results).toEqual([])
  })

  it('应当把 Reranker 非成功响应转换为外部错误', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('服务错误'),
    } as never)
    const provider = new ApiRerankerProvider({
      apiBase: 'https://rerank.test',
      apiKey: 'rerank-key',
      model: 'rerank-model',
      defaultTopK: 3,
    })

    await expect(provider.rerank('问题', ['文档'])).rejects.toMatchObject({
      code: 'EXTERNAL_ERROR',
      message: expect.stringContaining('服务错误'),
    })
  })
})

describe('EmbeddingService', () => {
  it('关闭向量后不发送请求，并保留模型配置供重新开启使用', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const service = new EmbeddingService({ ...embeddingConfig, enabled: false })
    expect(service.isEnabled).toBe(false)
    expect(service.isAvailable).toBe(false)
    expect(await service.embed(['文本'])).toEqual([])
    expect(await service.embedOne('文本')).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
    expect(service.getConfig().model).toBe(embeddingConfig.model)
    service.reconfigure({ ...embeddingConfig, enabled: true })
    expect(service.isAvailable).toBe(true)
  })

  it('关闭后在途请求即使迟到返回，也不能把旧向量交给调用方', async () => {
    let complete!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve
          }),
      ),
    )
    const service = new EmbeddingService(embeddingConfig)
    const signal = service.cancellationSignal
    const pending = service.embedOne('正在处理')
    service.reconfigure({ ...embeddingConfig, enabled: false })
    expect(signal.aborted).toBe(true)
    const rejected = expect(pending).rejects.toThrow('向量配置已变更')
    complete(
      new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }] }), { status: 200 }),
    )
    await rejected
  })

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('应当在未配置 Reranker 时按原顺序降级排序', async () => {
    const service = new EmbeddingService(embeddingConfig)

    const results = await service.rerank('问题', ['甲', '乙', '丙'])

    expect(results.map(({ index, text }) => ({ index, text }))).toEqual([
      { index: 0, text: '甲' },
      { index: 1, text: '乙' },
      { index: 2, text: '丙' },
    ])
    expect(results.every((item) => Number.isFinite(item.score))).toBe(true)
    expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score)
    expect(results[1]!.score).toBeGreaterThanOrEqual(results[2]!.score)
    expect(fetch).not.toHaveBeenCalled()
    expect(service.hasReranker).toBe(false)
  })

  it('应当在重新配置后启用 Reranker 并代理请求', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        results: [{ index: 0, relevance_score: 0.8 }],
      }),
    } as never)
    const service = new EmbeddingService(embeddingConfig)

    service.reconfigure({
      ...embeddingConfig,
      reranker: {
        apiBase: 'https://rerank.test',
        apiKey: 'rerank-key',
        model: 'rerank-model',
        defaultTopK: 1,
      },
    })
    const results = await service.rerank('问题', ['文档'])

    expect(service.hasReranker).toBe(true)
    expect(results).toEqual([{ index: 0, score: 0.8, text: '文档' }])
  })
})
