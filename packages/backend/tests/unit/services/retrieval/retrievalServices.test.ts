import { describe, expect, it, vi } from 'vitest'
import { ClusterRouter } from '@perocore/backend/services/retrieval/clusterRouter'
import { ContextualRetriever } from '@perocore/backend/services/retrieval/contextualRetriever'

function createClusterRouter(overrides: Record<string, unknown> = {}) {
  const store = {
    leidenCluster: vi.fn(() => ({
      nodeToCluster: [1, 10, 2, 10, 3, 20],
      clusterLabels: ['10', '猫咪偏好', '20', '工作记忆'],
      centroids: [10, 1, 0, 20, 0, 1],
    })),
  }
  const deps = {
    vectorRepo: {},
    memoryRepo: {},
    storeRegistry: { getStoreBySource: vi.fn(() => store) },
    contextRnn: {
      computeClusterAffinities: vi.fn(
        () =>
          new Map([
            [10, 0.7],
            [20, 0.3],
          ]),
      ),
    },
    ...overrides,
  }
  return { router: new ClusterRouter(deps as never, { topActiveClusters: 1 }), deps, store }
}

describe('ClusterRouter', () => {
  it('应当从 store 聚类结果构建簇缓存、节点映射和统计信息', async () => {
    const { router, deps, store } = createClusterRouter()

    const count = await router.rebuildClusters('pero', 'desktop')

    expect(count).toBe(2)
    expect(deps.storeRegistry.getStoreBySource).toHaveBeenCalledWith('pero', 'desktop')
    expect(store.leidenCluster).toHaveBeenCalledWith({ minCommunitySize: 3 })
    expect(router.hasClusters('pero')).toBe(true)
    expect(router.getClusterMembers('pero', 10)).toEqual(new Set([1, 2]))
    expect(router.getClusterLabels('pero')).toEqual(['猫咪偏好', '工作记忆'])
    expect(router.getNodeCluster('pero', 3)).toBe(20)
    expect(router.getStats('pero')).toMatchObject({ clusterCount: 2, totalNodes: 3 })
  })

  it('应当在没有 store 时返回空聚类并允许全库 fallback', async () => {
    const { router } = createClusterRouter({
      storeRegistry: { getStoreBySource: vi.fn(() => undefined) },
    })

    const count = await router.rebuildClusters('pero', 'desktop')

    expect(count).toBe(0)
    expect(router.routeByContext('pero', 'main')).toEqual([])
    expect(router.shouldFallbackToFullSearch('pero')).toBe(true)
    expect(router.getClusterMembers('pero', 999)).toEqual(new Set())
    expect(router.getStats('pero')).toEqual({
      clusterCount: 0,
      lastClusteringAt: undefined,
      totalNodes: 0,
    })
  })

  it('应当按 ContextRNN 亲和度路由到 top 活跃簇', async () => {
    const { router, deps } = createClusterRouter()
    await router.rebuildClusters('pero', 'desktop')

    const active = router.routeByContext('pero', 'main')

    expect(deps.contextRnn.computeClusterAffinities).toHaveBeenCalledWith(
      'pero',
      'main',
      new Map([
        [10, new Float32Array([1, 0])],
        [20, new Float32Array([0, 1])],
      ]),
    )
    expect(active).toEqual([{ clusterId: 10, label: '猫咪偏好', affinity: 0.7 }])
  })
})

function createRetriever(overrides: Record<string, unknown> = {}) {
  const rows = new Map([
    [
      1,
      {
        id: 1,
        content: '主人喜欢猫',
        retrievalQuality: 0.8,
        tags: '猫',
        importance: 5,
        source: 'desktop',
        type: 'preference',
        timestamp: 1000,
        prevId: 9,
        nextId: 2,
      },
    ],
    [
      2,
      {
        id: 2,
        content: '猫会晒太阳',
        retrievalQuality: 0.6,
        tags: '猫',
        importance: 4,
        source: 'desktop',
        type: 'event',
        timestamp: 2000,
        prevId: 1,
        nextId: undefined,
      },
    ],
    [
      9,
      {
        id: 9,
        content: '之前聊过宠物',
        retrievalQuality: 0.4,
        tags: '宠物',
        importance: 3,
        source: 'desktop',
        type: 'event',
        timestamp: 900,
        prevId: undefined,
        nextId: 1,
      },
    ],
  ])
  const deps = {
    embeddingService: { embedOne: vi.fn().mockResolvedValue([1, 0]) },
    contextRnn: {
      update: vi.fn(),
      generateBias: vi.fn(() => new Float32Array([1, 0])),
      getHiddenState: vi.fn(() => new Float32Array([0.2, 0.8])),
    },
    clusterRouter: {
      routeByContext: vi.fn(() => [{ clusterId: 10, label: '猫咪偏好', affinity: 0.9 }]),
      getNodeCluster: vi.fn((_: string, id: number) => (id === 1 ? 10 : 20)),
    },
    vectorRepo: {
      searchAdvanced: vi.fn().mockResolvedValue([
        { id: 1, score: 0.95 },
        { id: 2, score: 0.8 },
      ]),
      get: vi.fn((id: number) => Promise.resolve({ vector: id === 1 ? [1, 0] : [0, 1] })),
    },
    memoryRepo: {
      findByIds: vi.fn((ids: number[]) =>
        Promise.resolve(ids.map((id) => rows.get(id)).filter(Boolean)),
      ),
      findById: vi.fn((id: number) => Promise.resolve(rows.get(id) ?? null)),
    },
    retrievalFeedback: {
      collectSignals: vi.fn(() => [{ memoryId: 1, used: true }]),
      applyFeedback: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
  return { retriever: new ContextualRetriever(deps as never), deps }
}

describe('ContextualRetriever', () => {
  it('应当在 RAG 限制为 0 或 embedding 为空时返回空结果', async () => {
    const social = createRetriever()
    const socialResult = await social.retriever.search({
      query: '你好',
      agentId: 'pero',
      source: 'social',
    })

    const emptyEmbedding = createRetriever({
      embeddingService: { embedOne: vi.fn().mockResolvedValue([]) },
    })
    const emptyEmbeddingResult = await emptyEmbedding.retriever.search({
      query: '你好',
      agentId: 'pero',
    })

    expect(socialResult.memories).toEqual([])
    expect(social.deps.embeddingService.embedOne).not.toHaveBeenCalled()
    expect(emptyEmbeddingResult.memories).toEqual([])
    expect(emptyEmbedding.deps.contextRnn.update).not.toHaveBeenCalled()
  })

  it('应当执行完整检索管线并构建闪回和反馈注入数据', async () => {
    const { retriever, deps } = createRetriever()

    const result = await retriever.search({
      query: '猫猫',
      agentId: 'pero',
      topK: 2,
      flashbackRange: 1,
    })

    expect(deps.embeddingService.embedOne).toHaveBeenCalledWith('猫猫')
    expect(deps.contextRnn.update).toHaveBeenCalledWith('pero', 'main', [1, 0])
    expect(deps.clusterRouter.routeByContext).toHaveBeenCalledWith('pero', 'main')
    expect(deps.vectorRepo.searchAdvanced).toHaveBeenCalledWith(
      [1, 0],
      'pero',
      'desktop',
      expect.objectContaining({ topK: 6, enableAdvancedPipeline: true }),
    )
    expect(result.memories.map((memory) => memory.id)).toEqual([1, 2])
    expect(result.activeClusters).toEqual([{ clusterId: 10, label: '猫咪偏好', affinity: 0.9 }])
    expect(result.flashbackMemories).toEqual([
      { id: 9, content: '之前聊过宠物', timestamp: 900, direction: 'prev' },
    ])
    expect(result.injectedForFeedback).toHaveLength(2)
    expect(result.injectedForFeedback[0]).toMatchObject({ id: 1, content: '主人喜欢猫' })
  })

  it('应当在向量命中为空时保留活跃簇并返回空记忆', async () => {
    const { retriever, deps } = createRetriever({
      vectorRepo: {
        searchAdvanced: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
      },
    })

    const result = await retriever.search({ query: '猫猫', agentId: 'pero' })

    expect(result.memories).toEqual([])
    expect(result.activeClusters).toEqual([{ clusterId: 10, label: '猫咪偏好', affinity: 0.9 }])
    expect(deps.memoryRepo.findByIds).not.toHaveBeenCalled()
  })

  it('应当采集并应用 LLM 回复后的反馈信号', async () => {
    const { retriever, deps } = createRetriever()
    const injected = [
      {
        id: 1,
        content: '记忆',
        queryEmbedding: new Float32Array([1]),
        hiddenState: new Float32Array([2]),
      },
    ]

    await retriever.onLlmReply(injected, '回复里用了记忆')
    await retriever.onLlmReply([], '空')

    expect(deps.retrievalFeedback.collectSignals).toHaveBeenCalledWith(injected, '回复里用了记忆')
    expect(deps.retrievalFeedback.applyFeedback).toHaveBeenCalledWith(
      [{ memoryId: 1, used: true }],
      injected,
    )
    expect(deps.retrievalFeedback.collectSignals).toHaveBeenCalledTimes(1)
  })
})
