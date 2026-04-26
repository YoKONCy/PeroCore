import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryGraphService } from '@perocore/backend/services/memory/graph/memoryGraph'
import { SocialScorerService } from '@perocore/backend/services/memory/socialScorer'

function createMemory(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    content: `这是一条用于图谱展示的很长记忆内容 ${id}`,
    type: 'event',
    importance: id,
    sentiment: 'positive',
    tags: '猫咪, 主人',
    clusters: '日常',
    timestamp: id * 1000,
    source: 'desktop',
    accessCount: id,
    prevId: id > 1 ? id - 1 : null,
    nextId: id < 3 ? id + 1 : null,
    ...overrides,
  }
}

describe('MemoryGraphService', () => {
  it('应当生成全局图谱、去重邻居边并计算统计信息', async () => {
    const memories = [
      createMemory(1),
      createMemory(2),
      createMemory(3, { type: 'profile', tags: '主人' }),
    ]
    const memoryRepo = {
      list: vi.fn(() => Promise.resolve({ data: memories })),
      findByIds: vi.fn((ids: number[]) =>
        Promise.resolve(memories.filter((m) => ids.includes(m.id))),
      ),
    }
    const vectorRepo = {
      neighbors: vi.fn((id: number) => {
        if (id === 1) return Promise.resolve([2, 3])
        if (id === 2) return Promise.resolve([1, 3])
        return Promise.reject(new Error('缺少节点'))
      }),
    }
    const service = new MemoryGraphService(memoryRepo as never, vectorRepo as never)

    const graph = await service.getGraph({ agentId: 'pero', maxNodes: 3 })

    expect(memoryRepo.list).toHaveBeenCalledWith({
      agentId: 'pero',
      page: 1,
      pageSize: 3,
      type: undefined,
      source: 'desktop',
    })
    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { source: 1, target: 2, label: 'temporal', weight: 0.2 },
        { source: 2, target: 3, label: 'temporal', weight: 0.2 },
        { source: 1, target: 3, label: 'graph', weight: 0.5 },
      ]),
    )
    expect(graph.stats.nodesByType).toEqual({ event: 2, profile: 1 })
    expect(graph.stats.edgesByLabel).toEqual({ temporal: 2, graph: 1 })
    expect(graph.stats.centralNodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 2, degree: 2 })]),
    )
  })

  it('应当支持中心节点展开、类型过滤和空图谱', async () => {
    const memories = [createMemory(1), createMemory(2, { type: 'profile' }), createMemory(3)]
    const memoryRepo = {
      list: vi.fn(() => Promise.resolve({ data: [] })),
      findById: vi.fn((id: number) => Promise.resolve(memories.find((m) => m.id === id))),
      findByIds: vi.fn((ids: number[]) =>
        Promise.resolve(memories.filter((m) => ids.includes(m.id))),
      ),
    }
    const vectorRepo = {
      neighbors: vi.fn((id: number) => (id === 1 ? Promise.resolve([2]) : Promise.resolve([3]))),
    }
    const service = new MemoryGraphService(memoryRepo as never, vectorRepo as never)

    const centered = await service.getGraph({
      agentId: 'pero',
      centerId: 1,
      depth: 2,
      maxNodes: 3,
      types: ['event'],
    })
    const empty = await service.getGraph({ agentId: 'pero', maxNodes: 10 })

    expect(centered.nodes.map((node) => node.id)).toEqual([1, 3])
    expect(centered.stats.totalNodes).toBe(2)
    expect(empty).toEqual({
      nodes: [],
      edges: [],
      stats: { totalNodes: 0, totalEdges: 0, nodesByType: {}, edgesByLabel: {}, centralNodes: [] },
    })
  })

  it('应当缓存标签云并支持按 agent 或全量失效', async () => {
    const memoryRepo = {
      list: vi.fn(() =>
        Promise.resolve({
          data: [
            createMemory(1, { tags: '猫咪,主人' }),
            createMemory(2, { tags: '猫咪,游戏' }),
            createMemory(3, { tags: '' }),
          ],
        }),
      ),
    }
    const service = new MemoryGraphService(memoryRepo as never, { neighbors: vi.fn() } as never)

    const first = await service.getTagCloud('pero', 2)
    const cached = await service.getTagCloud('pero', 1)
    service.invalidateTagCloudCache('pero')
    const refreshed = await service.getTagCloud('pero', 3)
    service.invalidateTagCloudCache()

    expect(first).toEqual([
      { tag: '猫咪', count: 2 },
      { tag: '主人', count: 1 },
    ])
    expect(cached).toEqual([{ tag: '猫咪', count: 2 }])
    expect(refreshed).toHaveLength(3)
    expect(memoryRepo.list).toHaveBeenCalledTimes(2)
  })
})

describe('SocialScorerService', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function createStore() {
    return {
      insertWithId: vi.fn(),
      indexText: vi.fn(),
      get: vi.fn((_id: number): { id: number } | null => null),
      indexKeyword: vi.fn(),
      link: vi.fn(),
      buildTextIndex: vi.fn(),
    }
  }

  function createService(overrides: Record<string, unknown> = {}) {
    const store = createStore()
    const socialMessageRepo = {
      getUnsummarizedStats: vi.fn(() => Promise.resolve({ count: 0, totalChars: 0 })),
      getUnsummarized: vi.fn(() =>
        Promise.resolve([
          {
            id: 1,
            senderName: '主人',
            content: '今天想吃蛋糕',
            channelType: 'group',
            channelId: '100',
          },
          {
            id: 2,
            senderName: null,
            content: '猫猫也想吃',
            channelType: 'group',
            channelId: '100',
          },
        ]),
      ),
      markSummarized: vi.fn(() => Promise.resolve()),
    }
    const deps = {
      socialMessageRepo,
      storeRegistry: { getAgentStore: vi.fn(() => store) },
      llmService: {
        chat: vi.fn(() =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    new_event: { summary: '主人和猫猫讨论蛋糕', features: ['主人', '猫猫', 'x'] },
                    ontology_updates: [
                      { source: '主人', target: '猫猫', relation: 'equality', strength: 1.5 },
                      { source: '蛋糕', target: '甜点', relation: 'representation', strength: 0 },
                    ],
                  }),
                },
              },
            ],
          }),
        ),
      },
      getModelConfig: vi.fn(() =>
        Promise.resolve({ provider: 'openai', modelId: 'gpt', apiKey: 'key' }),
      ),
      mdpEngine: { render: vi.fn(() => '总结提示词') },
      ...overrides,
    }
    const service = new SocialScorerService(
      deps.socialMessageRepo as never,
      deps.storeRegistry as never,
      deps.llmService as never,
      deps.getModelConfig as never,
      deps.mdpEngine as never,
      { messageThreshold: 2, charThreshold: 20, batchLimit: 10, vectorDim: 3, maxRetries: 1 },
    )
    return { service, deps, store }
  }

  it('应当在消息数或字符数达到门控时处理批次', async () => {
    const { service, deps, store } = createService({
      socialMessageRepo: {
        getUnsummarizedStats: vi.fn(() => Promise.resolve({ count: 2, totalChars: 10 })),
        getUnsummarized: vi.fn(() =>
          Promise.resolve([
            {
              id: 1,
              senderName: '主人',
              content: '今天想吃蛋糕',
              channelType: 'private',
              channelId: 'u1',
            },
          ]),
        ),
        markSummarized: vi.fn(() => Promise.resolve()),
      },
    })

    await service.checkAndProcess('pero')

    expect(deps.mdpEngine.render).toHaveBeenCalledWith(
      'tasks/memory/scorer/social_segment_summarizer',
      expect.objectContaining({
        session_type: 'private',
        session_name: '私聊',
        agent_name: 'pero',
      }),
    )
    expect(deps.llmService.chat).toHaveBeenCalledWith(
      expect.any(Object),
      [{ role: 'user', content: '总结提示词' }],
      { temperature: 0.3, responseFormat: { type: 'json_object' } },
    )
    expect(store.insertWithId).toHaveBeenCalledWith(
      expect.any(Number),
      [0, 0, 0],
      expect.objectContaining({ type: 'event', content: '主人和猫猫讨论蛋糕' }),
    )
    expect(store.indexText).toHaveBeenCalledWith(expect.any(Number), '主人和猫猫讨论蛋糕')
    expect(store.indexKeyword).toHaveBeenCalled()
    expect(store.link).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      'memory_edge',
      1,
    )
    expect(store.link).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 'equality', 1)
    expect(store.link).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      'representation',
      0.1,
    )
    expect(store.buildTextIndex).toHaveBeenCalled()
    expect(deps.socialMessageRepo.markSummarized).toHaveBeenCalledWith([1])
  })

  it('应当在未达门控、无消息、无模型或无有效事件时安全跳过', async () => {
    const idle = createService()
    const empty = createService({
      socialMessageRepo: {
        getUnsummarizedStats: vi.fn(),
        getUnsummarized: vi.fn(() => Promise.resolve([])),
        markSummarized: vi.fn(),
      },
    })
    const noModel = createService({ getModelConfig: vi.fn(() => Promise.resolve(null)) })
    const invalid = createService({
      llmService: {
        chat: vi.fn(() =>
          Promise.resolve({
            choices: [
              { message: { content: JSON.stringify({ new_event: { features: ['猫猫'] } }) } },
            ],
          }),
        ),
      },
    })

    await idle.service.checkAndProcess('pero')
    await empty.service.processBatch('pero')
    await noModel.service.processBatch('pero')
    await invalid.service.processBatch('pero')

    expect(idle.deps.socialMessageRepo.getUnsummarized).not.toHaveBeenCalled()
    expect(empty.store.insertWithId).not.toHaveBeenCalled()
    expect(noModel.store.insertWithId).not.toHaveBeenCalled()
    expect(invalid.store.insertWithId).not.toHaveBeenCalled()
    expect(invalid.deps.socialMessageRepo.markSummarized).toHaveBeenCalledWith([1, 2])
  })

  it('应当处理已有 feature、LLM 异常和批次异常', async () => {
    const existingStore = createStore()
    existingStore.get.mockReturnValue({ id: 1 })
    const existing = createService({ storeRegistry: { getAgentStore: vi.fn(() => existingStore) } })
    const failed = createService({
      llmService: { chat: vi.fn(() => Promise.reject(new Error('模型失败'))) },
    })

    await existing.service.processBatch('pero')
    await failed.service.processBatch('pero')

    expect(existingStore.insertWithId).toHaveBeenCalledWith(
      expect.any(Number),
      [0, 0, 0],
      expect.objectContaining({ type: 'event' }),
    )
    expect(existingStore.insertWithId).not.toHaveBeenCalledWith(
      expect.any(Number),
      [0, 0, 0],
      expect.objectContaining({ type: 'feature' }),
    )
    expect(failed.deps.socialMessageRepo.markSummarized).not.toHaveBeenCalled()
  })
})
