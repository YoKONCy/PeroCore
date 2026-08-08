import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@perocore/nit-runtime', () => ({
  minGruTrain: vi.fn(() => 0.1234),
}))

import { RetrievalFeedback } from '@perocore/backend/services/retrieval/retrievalFeedback'
import { ImageCacheManager } from '@perocore/backend/services/social/imageCacheManager'
import { minGruTrain } from '@perocore/nit-runtime'

describe('RetrievalFeedback', () => {
  it('应当根据记忆和回复的 Jaccard 相似度生成正负反馈信号', () => {
    const repo = { updateRetrievalQuality: vi.fn() }
    const feedback = new RetrievalFeedback(repo as never, { positiveThreshold: 0.1 })

    const signals = feedback.collectSignals(
      [
        { id: 1, content: '主人喜欢猫猫和晒太阳' },
        { id: 2, content: '完全无关的工作安排' },
      ],
      '猫猫今天又去晒太阳了',
    )

    expect(signals).toHaveLength(2)
    expect(signals[0]).toMatchObject({ memoryId: 1, isPositive: true })
    expect(signals[0]!.jaccardScore).toBeGreaterThanOrEqual(0.1)
    expect(signals[1]).toMatchObject({ memoryId: 2, isPositive: false })
  })

  it('应当在空注入或空回复时返回空信号', () => {
    const feedback = new RetrievalFeedback({ updateRetrievalQuality: vi.fn() } as never)

    expect(feedback.collectSignals([], '回复')).toEqual([])
    expect(feedback.collectSignals([{ id: 1, content: '记忆' }], '   ')).toEqual([])
  })

  it('应当应用反馈并累计训练样本与统计信息', async () => {
    const repo = { updateRetrievalQuality: vi.fn().mockResolvedValue(undefined) }
    const feedback = new RetrievalFeedback(repo as never, {
      positiveDelta: 0.2,
      negativeDelta: -0.1,
      trainBatchSize: 10,
    })

    await feedback.applyFeedback(
      [
        { memoryId: 1, isPositive: true, jaccardScore: 0.5 },
        { memoryId: 2, isPositive: false, jaccardScore: 0 },
      ],
      [
        {
          id: 1,
          content: '猫',
          queryEmbedding: new Float32Array([1]),
          hiddenState: new Float32Array([2]),
        },
        { id: 2, content: '狗' },
      ],
    )

    expect(repo.updateRetrievalQuality).toHaveBeenCalledWith(1, 0.2)
    expect(repo.updateRetrievalQuality).toHaveBeenCalledWith(2, -0.1)
    expect(feedback.getStats()).toEqual({
      totalSignals: 2,
      positiveCount: 1,
      negativeCount: 1,
      trainTriggers: 0,
      lastTrainLoss: 0,
      pendingSamples: 1,
      positiveRate: '50.0%',
      // AIOS: CCSA W_out 更新次数（新增统计字段）
      wOutUpdates: 0,
    })
  })

  it('应当达到批量阈值后触发 minGRU 训练并清空样本', async () => {
    const repo = { updateRetrievalQuality: vi.fn().mockResolvedValue(undefined) }
    const feedback = new RetrievalFeedback(repo as never, { trainBatchSize: 2 })

    await feedback.applyFeedback(
      [
        { memoryId: 1, isPositive: true, jaccardScore: 1 },
        { memoryId: 2, isPositive: false, jaccardScore: 0 },
      ],
      [
        {
          id: 1,
          content: '一',
          queryEmbedding: new Float32Array([1]),
          hiddenState: new Float32Array([2]),
        },
        {
          id: 2,
          content: '二',
          queryEmbedding: new Float32Array([3]),
          hiddenState: new Float32Array([4]),
        },
      ],
    )

    expect(minGruTrain).toHaveBeenCalledWith(
      [
        { hiddenState: new Float32Array([2]), queryEmbedding: new Float32Array([1]), label: 1 },
        { hiddenState: new Float32Array([4]), queryEmbedding: new Float32Array([3]), label: 0 },
      ],
      0.001,
    )
    expect(feedback.getStats()).toMatchObject({
      trainTriggers: 1,
      lastTrainLoss: 0.1234,
      pendingSamples: 0,
    })
  })

  it('应当在训练失败时清空样本但不抛出异常', async () => {
    vi.mocked(minGruTrain).mockImplementationOnce(() => {
      throw new Error('训练失败')
    })
    const repo = { updateRetrievalQuality: vi.fn().mockResolvedValue(undefined) }
    const feedback = new RetrievalFeedback(repo as never, { trainBatchSize: 1 })

    await expect(
      feedback.applyFeedback(
        [{ memoryId: 1, isPositive: true, jaccardScore: 1 }],
        [
          {
            id: 1,
            content: '一',
            queryEmbedding: new Float32Array([1]),
            hiddenState: new Float32Array([2]),
          },
        ],
      ),
    ).resolves.toBeUndefined()

    expect(feedback.getStats()).toMatchObject({ trainTriggers: 0, pendingSamples: 0 })
  })
})

describe('ImageCacheManager', () => {
  let root: string
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    root = join(tmpdir(), `perocore-image-cache-${Date.now()}-${Math.random()}`)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('应当下载远程图片、命中缓存并读取 data URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('图片').buffer),
    })
    globalThis.fetch = fetchMock as never
    const manager = new ImageCacheManager({ cacheDir: root })

    const first = await manager.download('https://example.com/a.png')
    const second = await manager.download('https://example.com/a.png')
    const dataUrl = manager.readAsDataUrl(first!)

    expect(first).toBeTruthy()
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first).toMatch(/\.png$/)
    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('应当在 HTTP 失败、fetch 异常或文件不存在时返回 null', async () => {
    const manager = new ImageCacheManager({ cacheDir: root })

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as never
    await expect(manager.download('https://example.com/missing.jpg')).resolves.toBeNull()

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('网络失败')) as never
    await expect(manager.download('https://example.com/error.gif')).resolves.toBeNull()

    expect(manager.readAsDataUrl(join(root, 'missing.jpg'))).toBeNull()
  })

  it('应当推断常见图片扩展名并为未知格式使用 jpg', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('x').buffer),
    })
    globalThis.fetch = fetchMock as never
    const manager = new ImageCacheManager({ cacheDir: root, maxFiles: 10 })

    const gif = await manager.download('https://example.com/a.gif')
    const webp = await manager.download('https://example.com/a.webp')
    const jpg = await manager.download('https://example.com/a.unknown')

    expect(gif).toMatch(/\.gif$/)
    expect(webp).toMatch(/\.webp$/)
    expect(jpg).toMatch(/\.jpg$/)
    expect(manager.readAsDataUrl(gif!)).toMatch(/^data:image\/gif;base64,/)
    expect(manager.readAsDataUrl(webp!)).toMatch(/^data:image\/webp;base64,/)
  })

  it('应当在超过最大缓存文件数时清理旧文件', async () => {
    mkdirSync(root, { recursive: true })
    const oldFile = join(root, 'old.jpg')
    writeFileSync(oldFile, 'old')
    const oldTime = new Date(Date.now() - 60_000)
    await new Promise((resolve) => setTimeout(resolve, 5))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('new').buffer),
    } as never)

    const manager = new ImageCacheManager({ cacheDir: root, maxFiles: 1 })
    expect(statSync(oldFile).mtimeMs).toBeGreaterThan(0)
    await manager.download('https://example.com/new.png')

    const files = readdirSync(root)
    expect(files).toHaveLength(1)
    expect(files[0]).not.toBe('old.jpg')
    expect(oldTime).toBeInstanceOf(Date)
  })
})
