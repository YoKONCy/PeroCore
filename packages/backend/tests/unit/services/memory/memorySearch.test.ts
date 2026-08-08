import { beforeEach, describe, expect, it, vi } from 'vitest'

const { warnMock } = vi.hoisted(() => ({
  warnMock: vi.fn(),
}))

vi.mock('@perocore/backend/lib/logger', () => ({
  createLogger: () => ({
    warn: warnMock,
  }),
}))

import { MemorySearchService } from '@perocore/backend/services/memory/memorySearch'

type VectorRepoMock = {
  search: ReturnType<typeof vi.fn>
  searchAdvanced: ReturnType<typeof vi.fn>
  searchHybrid: ReturnType<typeof vi.fn>
}

type MemoryRepoMock = {
  findById: ReturnType<typeof vi.fn>
  findByIds: ReturnType<typeof vi.fn>
  patternSearch: ReturnType<typeof vi.fn>
}

type EmbeddingServiceMock = {
  embedOne: ReturnType<typeof vi.fn>
  isAvailable: boolean
}

describe('MemorySearchService', () => {
  const vectorRepo: VectorRepoMock = {
    search: vi.fn(),
    searchAdvanced: vi.fn(),
    searchHybrid: vi.fn(),
  }

  const memoryRepo: MemoryRepoMock = {
    findById: vi.fn(),
    findByIds: vi.fn(),
    patternSearch: vi.fn().mockResolvedValue([]),
  }

  const embeddingService: EmbeddingServiceMock = {
    embedOne: vi.fn(),
    isAvailable: true,
  }

  let service: MemorySearchService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MemorySearchService(
      vectorRepo as never,
      memoryRepo as never,
      embeddingService as never,
    )
  })

  describe('search', () => {
    it('应当按模式限制 topK，并关联 SQLite 元数据', async () => {
      // social 模式被配置为 memories = 0，应直接短路，不触发向量化。
      const socialResult = await service.search({
        query: '你好',
        agentId: 'pero',
        source: 'social',
      })

      expect(socialResult).toEqual([])
      expect(embeddingService.embedOne).not.toHaveBeenCalled()

      // desktop 模式会把 topK 限制在 8 以内，并把检索结果映射到完整结构。
      embeddingService.embedOne.mockResolvedValue([0.1, 0.2])
      vectorRepo.search.mockResolvedValue([
        { id: 2, score: 0.92 },
        { id: 99, score: 0.3 },
      ])
      memoryRepo.findByIds.mockResolvedValue([
        {
          id: 2,
          agentId: 'pero',
          content: '记得今晚写周报',
          tags: '工作,提醒',
          importance: 4,
          source: 'desktop',
          type: 'event',
          timestamp: 1710000000,
        },
      ])

      const result = await service.search({
        query: '今晚要做什么',
        agentId: 'pero',
        source: 'desktop',
        topK: 99,
        expandDepth: 4,
        minScore: 0.5,
      })

      expect(vectorRepo.search).toHaveBeenCalledWith([0.1, 0.2], 'pero', 'desktop', 8, 4, 0.5)
      expect(result).toEqual([
        {
          id: 2,
          content: '记得今晚写周报',
          score: 0.92,
          tags: '工作,提醒',
          importance: 4,
          source: 'desktop',
          type: 'event',
          timestamp: 1710000000,
        },
      ])
    })

    it('embedding 为空时应当返回空结果并记录警告', async () => {
      embeddingService.embedOne.mockResolvedValue([])

      const result = await service.search({ query: '空向量', agentId: 'pero' })

      expect(result).toEqual([])
      expect(vectorRepo.search).not.toHaveBeenCalled()
      expect(warnMock).toHaveBeenCalledWith('Embedding 返回空向量，跳过检索')
    })
  })

  describe('searchAdvanced', () => {
    it('应当调用高级检索并关联元数据', async () => {
      embeddingService.embedOne.mockResolvedValue([0.3, 0.4])
      vectorRepo.searchAdvanced.mockResolvedValue([{ id: 5, score: 0.88 }])
      memoryRepo.findByIds.mockResolvedValue([
        {
          id: 5,
          agentId: 'pero',
          content: '高级检索命中',
          tags: null,
          importance: null,
          source: null,
          type: null,
          timestamp: 1711000000,
        },
      ])

      const config = { alpha: 0.5 }
      const result = await service.searchAdvanced({
        query: '高级搜索',
        agentId: 'pero',
        source: 'work',
        config: config as never,
      })

      expect(vectorRepo.searchAdvanced).toHaveBeenCalledWith([0.3, 0.4], 'pero', 'work', config)
      expect(result).toEqual([
        {
          id: 5,
          content: '高级检索命中',
          score: 0.88,
          tags: '',
          importance: 1,
          source: 'desktop',
          type: 'event',
          timestamp: 1711000000,
        },
      ])
    })
  })

  describe('searchHybrid', () => {
    it('应当将原始 query 同时传给向量与文本混合检索', async () => {
      embeddingService.embedOne.mockResolvedValue([0.9])
      vectorRepo.searchHybrid.mockResolvedValue([{ id: 6, score: 0.77 }])
      memoryRepo.findByIds.mockResolvedValue([
        {
          id: 6,
          agentId: 'pero',
          content: '混合检索命中',
          tags: 'tag',
          importance: 2,
          source: 'work',
          type: 'summary',
          timestamp: 1712000000,
        },
      ])

      const result = await service.searchHybrid({
        query: '混合策略',
        agentId: 'pero',
        source: 'work',
        topK: 3,
        expandDepth: 1,
        minScore: 0.2,
      })

      expect(vectorRepo.searchHybrid).toHaveBeenCalledWith(
        [0.9],
        '混合策略',
        'pero',
        'work',
        3,
        1,
        0.2,
      )
      expect(result[0]?.content).toBe('混合检索命中')
    })
  })

  describe('Pattern Search fallback', () => {
    it('CJK 查询应当触发 patternSearch 并与向量召回 RRF 融合', async () => {
      // 场景：向量召回命中 id=2，pattern 召回命中 id=7（仅 pattern 命中）
      // RRF 融合后两者都应出现，证明 fallback 补充了向量漏召回
      embeddingService.embedOne.mockResolvedValue([0.1, 0.2])
      vectorRepo.search.mockResolvedValue([{ id: 2, score: 0.92 }])
      memoryRepo.patternSearch.mockResolvedValue([
        { id: 7, score: 1.0 }, // pattern 独占命中
        { id: 2, score: 0.5 }, // 与向量重叠
      ])
      memoryRepo.findByIds.mockResolvedValue([
        {
          id: 2,
          agentId: 'pero',
          content: '向量召回记忆',
          tags: '',
          importance: 3,
          source: 'desktop',
          type: 'event',
          timestamp: 1710000000,
        },
        {
          id: 7,
          agentId: 'pero',
          content: 'pattern 补充记忆',
          tags: '',
          importance: 2,
          source: 'desktop',
          type: 'event',
          timestamp: 1710000001,
        },
      ])

      const result = await service.search({
        query: '小猫娘', // CJK 文本，触发 bigram 提取
        agentId: 'pero',
        source: 'desktop',
      })

      // patternSearch 应被调用，terms 为 CJK bigrams
      expect(memoryRepo.patternSearch).toHaveBeenCalledWith(
        'pero',
        expect.arrayContaining(['小猫', '猫娘']),
        expect.any(Number),
      )
      // 融合后两条记忆都应出现
      const ids = result.map((r) => r.id).sort()
      expect(ids).toEqual([2, 7])
    })

    it('ASCII 长词（>=3 字符）不应触发 patternSearch', async () => {
      // 长词由 BM25/向量处理，pattern search 不应被调用
      embeddingService.embedOne.mockResolvedValue([0.5])
      vectorRepo.search.mockResolvedValue([{ id: 1, score: 0.8 }])
      memoryRepo.findByIds.mockResolvedValue([
        {
          id: 1,
          agentId: 'pero',
          content: 'long query test',
          tags: '',
          importance: 1,
          source: 'desktop',
          type: 'event',
          timestamp: 1710000000,
        },
      ])

      await service.search({
        query: 'hello world', // 两个长词，不应触发
        agentId: 'pero',
        source: 'desktop',
      })

      expect(memoryRepo.patternSearch).not.toHaveBeenCalled()
    })

    it('ASCII 短词（<3 字符）应当触发 patternSearch', async () => {
      embeddingService.embedOne.mockResolvedValue([0.5])
      vectorRepo.search.mockResolvedValue([{ id: 1, score: 0.8 }])
      memoryRepo.patternSearch.mockResolvedValue([{ id: 3, score: 1.0 }])
      memoryRepo.findByIds.mockResolvedValue([
        {
          id: 1,
          agentId: 'pero',
          content: 'vector hit',
          tags: '',
          importance: 1,
          source: 'desktop',
          type: 'event',
          timestamp: 1710000000,
        },
        {
          id: 3,
          agentId: 'pero',
          content: 'short term hit',
          tags: '',
          importance: 1,
          source: 'desktop',
          type: 'event',
          timestamp: 1710000001,
        },
      ])

      await service.searchHybrid({
        query: 'AI OK', // 两个短词
        agentId: 'pero',
        source: 'desktop',
      })

      // 短词应被提取并传给 patternSearch
      expect(memoryRepo.patternSearch).toHaveBeenCalledWith(
        'pero',
        expect.arrayContaining(['AI', 'OK']),
        expect.any(Number),
      )
    })

    it('patternSearch 返回空时应当回退到原始向量召回结果', async () => {
      // pattern 无命中时，应直接使用向量召回，不破坏原行为
      embeddingService.embedOne.mockResolvedValue([0.5])
      const vectorHit = { id: 9, score: 0.75 }
      vectorRepo.search.mockResolvedValue([vectorHit])
      memoryRepo.patternSearch.mockResolvedValue([]) // pattern 无命中
      memoryRepo.findByIds.mockResolvedValue([
        {
          id: 9,
          agentId: 'pero',
          content: '原始向量召回',
          tags: '',
          importance: 1,
          source: 'desktop',
          type: 'event',
          timestamp: 1710000000,
        },
      ])

      const result = await service.search({
        query: '小猫',
        agentId: 'pero',
        source: 'desktop',
      })

      // pattern 被调用但无贡献，最终结果应保留向量召原始 score
      expect(result).toEqual([
        {
          id: 9,
          content: '原始向量召回',
          score: 0.75,
          tags: '',
          importance: 1,
          source: 'desktop',
          type: 'event',
          timestamp: 1710000000,
        },
      ])
    })
  })

  describe('flashback', () => {
    it('应当沿前后链路展开上下文', async () => {
      // 链路: 8 <- 10 -> 12
      memoryRepo.findById.mockImplementation(async (id: number) => {
        if (id === 10) return { id: 10, prevId: 8, nextId: 12 }
        if (id === 8) return { id: 8, prevId: 7, nextId: 10 }
        if (id === 12) return { id: 12, prevId: 10, nextId: 13 }
        return undefined
      })
      memoryRepo.findByIds.mockResolvedValue([
        {
          id: 8,
          agentId: 'pero',
          content: '前文记忆',
          tags: 'before',
          importance: 2,
          source: 'desktop',
          type: 'event',
          timestamp: 1700000001,
        },
        {
          id: 12,
          agentId: 'pero',
          content: '后文记忆',
          tags: 'after',
          importance: 3,
          source: 'desktop',
          type: 'event',
          timestamp: 1700000002,
        },
      ])

      const result = await service.flashback(10, 'pero', 1)

      expect(memoryRepo.findByIds).toHaveBeenCalledWith([8, 12])
      expect(result).toEqual([
        {
          id: 8,
          content: '前文记忆',
          score: 0,
          tags: 'before',
          importance: 2,
          source: 'desktop',
          type: 'event',
          timestamp: 1700000001,
        },
        {
          id: 12,
          content: '后文记忆',
          score: 0,
          tags: 'after',
          importance: 3,
          source: 'desktop',
          type: 'event',
          timestamp: 1700000002,
        },
      ])
    })

    it('锚点不存在时应当返回空数组', async () => {
      memoryRepo.findById.mockResolvedValue(undefined)

      const result = await service.flashback(404, 'pero')

      expect(result).toEqual([])
      expect(memoryRepo.findByIds).not.toHaveBeenCalled()
    })
  })
})
