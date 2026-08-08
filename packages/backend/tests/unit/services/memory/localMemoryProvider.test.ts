import { describe, expect, it, vi } from 'vitest'
import { LocalMemoryProvider } from '@perocore/backend/services/memory/localMemoryProvider'
import type { AddMemoryInput } from '@perocore/backend/services/memory/memoryProvider'

/** 构造 LocalMemoryProvider + mock 依赖 */
function createProvider(options: { searchResults?: unknown[]; memoryNode?: { id: number } } = {}) {
  const canonicalMemoryRepo = {
    create: vi.fn().mockResolvedValue({
      id: 'canonical-uuid',
      agentId: 'pero',
      type: 'event',
      content: '记忆内容',
      summary: '',
      importance: 0.5,
      confidence: 0.5,
      status: 'active',
      provenance: {
        originThreadId: 'thread-1',
        originMessageIds: [],
        originChannel: 'desktop',
        createdFrom: 'gate',
        createdAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    findRecent: vi.fn().mockResolvedValue([
      {
        id: 'recent-1',
        agentId: 'pero',
        type: 'event',
        content: '最近记忆',
        summary: '',
        importance: 0.5,
        confidence: 0.5,
        status: 'active',
        provenance: {
          originThreadId: 'thread-1',
          originMessageIds: [],
          originChannel: 'desktop',
          createdFrom: 'scorer',
          createdAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]),
    deleteByThreadId: vi.fn().mockResolvedValue(2),
  }
  const memoryCandidateRepo = { create: vi.fn() }
  const memorySearchService = {
    search: vi.fn().mockResolvedValue(
      options.searchResults ?? [
        { id: 10, content: '命中1', score: 0.9, tags: '', importance: 8, source: 'desktop', type: 'event', timestamp: 0 },
        { id: 11, content: '命中2', score: 0.8, tags: '', importance: 5, source: 'desktop', type: 'entity', timestamp: 0 },
      ],
    ),
  }
  const memoryService = {
    create: vi.fn().mockResolvedValue(options.memoryNode ?? { id: 42 }),
  }
  const provider = new LocalMemoryProvider(
    canonicalMemoryRepo as never,
    memoryCandidateRepo as never,
    memorySearchService as never,
    memoryService as never,
    {} as never,
    {} as never,
  )
  return { provider, canonicalMemoryRepo, memoryCandidateRepo, memorySearchService, memoryService }
}

describe('LocalMemoryProvider', () => {
  describe('search', () => {
    it('应当调用 memorySearchService.search 并映射结果（过滤 entity 节点）', async () => {
      const { provider, memorySearchService } = createProvider()

      const results = await provider.search({
        query: '猫',
        agentId: 'pero',
        channel: 'desktop',
        limit: 10,
      })

      expect(memorySearchService.search).toHaveBeenCalledWith({
        query: '猫',
        agentId: 'pero',
        source: 'desktop',
        topK: 10,
      })
      // 默认 searchResults 含 2 条，其中一条 type=entity 应被过滤
      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('10')
      expect(results[0]!.content).toBe('命中1')
      expect(results[0]!.score).toBe(0.9)
      expect(results[0]!.type).toBe('event')
      expect(results[0]!.summary).toBe('')
    })

    it('应当把 social/group channel 映射为 social source', async () => {
      const { provider, memorySearchService } = createProvider({ searchResults: [] })

      await provider.search({
        query: '群聊',
        agentId: 'pero',
        channel: 'group',
      })

      expect(memorySearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'social' }),
      )
    })

    it('应当在查询为空时返回空数组', async () => {
      const { provider, memorySearchService } = createProvider()

      const results = await provider.search({
        query: '   ',
        agentId: 'pero',
        channel: 'desktop',
      })

      expect(results).toEqual([])
      expect(memorySearchService.search).not.toHaveBeenCalled()
    })

    it('应当在检索异常时返回空数组', async () => {
      const { provider, memorySearchService } = createProvider()
      memorySearchService.search.mockRejectedValueOnce(new Error('检索失败'))

      const results = await provider.search({
        query: '猫',
        agentId: 'pero',
        channel: 'desktop',
      })

      expect(results).toEqual([])
    })
  })

  describe('add', () => {
    it('应当同时写 memory_nodes 和 canonical_memories，vectorId 关联数字 id', async () => {
      const { provider, memoryService, canonicalMemoryRepo } = createProvider()

      const input: AddMemoryInput = {
        agentId: 'pero',
        content: '新记忆',
        summary: '摘要',
        type: 'preference',
        importance: 8,
        confidence: 0.9,
        tags: ['猫'],
        provenance: {
          originThreadId: 'thread-1',
          originMessageIds: ['1', '2'],
          originChannel: 'desktop',
          createdFrom: 'gate',
          createdAt: new Date().toISOString(),
        },
      }

      const result = await provider.add(input)

      // memoryService.create 应被调用（写 memory_nodes 获取数字 id）
      expect(memoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '新记忆',
          agentId: 'pero',
          type: 'preference',
          source: 'desktop',
        }),
      )
      // canonicalMemoryRepo.create 应被调用，vectorId 为数字 id 字符串
      expect(canonicalMemoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'pero',
          type: 'preference',
          content: '新记忆',
          summary: '摘要',
          provenance: input.provenance,
          vectorId: '42',
        }),
      )
      expect(result.id).toBe('canonical-uuid')
    })
  })

  describe('getRecent', () => {
    it('应当调用 canonicalMemoryRepo.findRecent', async () => {
      const { provider, canonicalMemoryRepo } = createProvider()

      const results = await provider.getRecent('pero', 5)

      expect(canonicalMemoryRepo.findRecent).toHaveBeenCalledWith('pero', 5)
      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('recent-1')
    })

    it('应当在未传 limit 时使用默认值 10', async () => {
      const { provider, canonicalMemoryRepo } = createProvider()

      await provider.getRecent('pero')

      expect(canonicalMemoryRepo.findRecent).toHaveBeenCalledWith('pero', 10)
    })
  })

  describe('deleteByThreadId', () => {
    it('应当调用 canonicalMemoryRepo.deleteByThreadId 并返回删除数', async () => {
      const { provider, canonicalMemoryRepo } = createProvider()

      const count = await provider.deleteByThreadId('thread-1')

      expect(canonicalMemoryRepo.deleteByThreadId).toHaveBeenCalledWith('thread-1')
      expect(count).toBe(2)
    })
  })
})
