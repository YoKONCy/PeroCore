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
}

type EmbeddingServiceMock = {
  embedOne: ReturnType<typeof vi.fn>
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
  }

  const embeddingService: EmbeddingServiceMock = {
    embedOne: vi.fn(),
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
      expect(warnMock).toHaveBeenCalledWith('Embedding 为空，跳过检索')
    })
  })

  describe('searchAdvanced', () => {
    it('应当调用高级检索并关联元数据', async () => {
      embeddingService.embedOne.mockResolvedValue([0.3, 0.4])
      vectorRepo.searchAdvanced.mockResolvedValue([{ id: 5, score: 0.88 }])
      memoryRepo.findByIds.mockResolvedValue([
        {
          id: 5,
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
          content: '前文记忆',
          tags: 'before',
          importance: 2,
          source: 'desktop',
          type: 'event',
          timestamp: 1700000001,
        },
        {
          id: 12,
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
