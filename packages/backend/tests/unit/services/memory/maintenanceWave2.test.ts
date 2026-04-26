import { describe, expect, it, vi } from 'vitest'
import { Auditor } from '@perocore/backend/services/memory/maintenance/auditor'
import { DreamAssociator } from '@perocore/backend/services/memory/maintenance/dreamAssociator'
import { GraphGardener } from '@perocore/backend/services/memory/maintenance/graphGardener'
import { ReflectionOrchestrator } from '@perocore/backend/services/memory/maintenance/reflectionOrchestrator'

function createMemory(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    content: `主人喜欢猫咪 ${id}`,
    importance: 5,
    type: 'event',
    source: 'desktop',
    tags: '猫咪,主人',
    clusters: '日常',
    timestamp: Date.now() - id * 10 * 60 * 60 * 1000,
    ...overrides,
  }
}

describe('Auditor', () => {
  it('应当去重重复内容并执行 LLM 审计安全删除', async () => {
    const memories = [
      createMemory(1, { content: '主人今天喜欢猫咪', importance: 1 }),
      createMemory(2, { content: '主人今天喜欢猫咪', importance: 9 }),
      createMemory(3, { content: '需要删除的噪音记忆', source: 'social' }),
      createMemory(4, { content: '正常记忆' }),
      createMemory(5, { content: '另一条正常记忆' }),
    ]
    const deps = {
      memoryRepo: {
        list: vi.fn(() => Promise.resolve({ data: memories })),
        delete: vi.fn(() => Promise.resolve()),
        findById: vi.fn((id: number) => Promise.resolve(memories.find((m) => m.id === id))),
      },
      vectorWriteHelper: { deleteWithFallback: vi.fn(() => Promise.resolve()) },
      getModelConfig: vi.fn(() =>
        Promise.resolve({ provider: 'openai', modelId: 'gpt', apiKey: 'key' }),
      ),
      mdpEngine: { render: vi.fn(() => '审计提示词') },
      llmService: {
        chat: vi.fn(() =>
          Promise.resolve({
            choices: [{ message: { content: JSON.stringify({ ids: [3, 999] }) } }],
          }),
        ),
      },
    }
    const auditor = new Auditor(deps as never, { minBatch: 1, minContentLengthForDedup: 5 })

    const cleaned = await auditor.audit('pero')

    expect(cleaned).toBe(2)
    expect(deps.memoryRepo.delete).toHaveBeenCalledWith(1)
    expect(deps.memoryRepo.delete).toHaveBeenCalledWith(3)
    expect(deps.vectorWriteHelper.deleteWithFallback).toHaveBeenCalledWith(1, 'pero', 'desktop')
    expect(deps.vectorWriteHelper.deleteWithFallback).toHaveBeenCalledWith(3, 'pero', 'social')
    expect(deps.llmService.chat).toHaveBeenCalledWith(expect.any(Object), expect.any(Array), {
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
    })
  })

  it('应当在批次过小、无模型或 LLM 失败时安全返回', async () => {
    const small = new Auditor({
      memoryRepo: { list: vi.fn(() => Promise.resolve({ data: [createMemory(1)] })) },
    } as never)
    const noModel = new Auditor({
      memoryRepo: {
        list: vi.fn(() => Promise.resolve({ data: [1, 2, 3, 4, 5].map((id) => createMemory(id)) })),
      },
      vectorWriteHelper: { deleteWithFallback: vi.fn() },
      getModelConfig: vi.fn(() => Promise.resolve(null)),
      mdpEngine: { render: vi.fn() },
      llmService: { chat: vi.fn() },
    } as never)
    const failed = new Auditor({
      memoryRepo: {
        list: vi.fn(() => Promise.resolve({ data: [1, 2, 3, 4, 5].map((id) => createMemory(id)) })),
      },
      vectorWriteHelper: { deleteWithFallback: vi.fn() },
      getModelConfig: vi.fn(() =>
        Promise.resolve({ provider: 'openai', modelId: 'gpt', apiKey: 'key' }),
      ),
      mdpEngine: { render: vi.fn(() => '提示词') },
      llmService: { chat: vi.fn(() => Promise.reject(new Error('失败'))) },
    } as never)

    await expect(small.audit('pero')).resolves.toBe(0)
    await expect(noModel.audit('pero')).resolves.toBe(0)
    await expect(failed.audit('pero')).resolves.toBe(0)
  })
})

describe('GraphGardener', () => {
  it('应当构建语义、实体、主题和原子化实体边', async () => {
    const memories = [
      createMemory(1),
      createMemory(2),
      createMemory(3, { tags: '通用', clusters: '技术' }),
    ]
    const deps = {
      memoryRepo: { list: vi.fn(() => Promise.resolve({ data: memories })) },
      vectorRepo: {
        get: vi.fn((id: number) => Promise.resolve({ id, vector: [1, 0, 0] })),
        search: vi.fn(
          (_: unknown, __: string, ___: string, ____: number, _____: number, ______: number) =>
            Promise.resolve([
              { id: 1, score: 1 },
              { id: 2, score: 0.9 },
            ]),
        ),
        link: vi.fn(() => Promise.resolve()),
        indexKeyword: vi.fn(() => Promise.resolve()),
      },
      vectorWriteHelper: {},
      getModelConfig: vi.fn(() =>
        Promise.resolve({ provider: 'openai', modelId: 'gpt', apiKey: 'key' }),
      ),
      mdpEngine: { render: vi.fn(() => '图谱提示词') },
      llmService: {
        chat: vi.fn(() =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    new_entities: [{ name: '猫咪', type: 'topic' }],
                    relations: [{ event_id: 1, entity: '猫咪', rel: 'likes', weight: 0.8 }],
                  }),
                },
              },
            ],
          }),
        ),
      },
    }
    const gardener = new GraphGardener(deps as never, { maxBatch: 3, semanticThreshold: 0.75 })

    const total = await gardener.maintain('pero')

    expect(total).toBeGreaterThanOrEqual(8)
    expect(deps.vectorRepo.link).toHaveBeenCalledWith(
      1,
      2,
      'semantic',
      expect.any(Number),
      'pero',
      'desktop',
    )
    expect(deps.vectorRepo.link).toHaveBeenCalledWith(1, 2, 'entity', 0.4, 'pero', 'desktop')
    expect(deps.vectorRepo.link).toHaveBeenCalledWith(1, 2, 'thematic', 0.3, 'pero', 'desktop')
    expect(deps.vectorRepo.indexKeyword).toHaveBeenCalledWith(1, 'atom_猫咪', 'pero', 'desktop')
    expect(deps.vectorRepo.indexKeyword).toHaveBeenCalledWith(
      1,
      'rel_likes_猫咪',
      'pero',
      'desktop',
    )
  })

  it('应当在记忆不足、无向量或无模型时跳过对应步骤', async () => {
    const deps = {
      memoryRepo: { list: vi.fn(() => Promise.resolve({ data: [createMemory(1)] })) },
      vectorRepo: { get: vi.fn(), search: vi.fn(), link: vi.fn(), indexKeyword: vi.fn() },
      vectorWriteHelper: {},
      getModelConfig: vi.fn(() => Promise.resolve(null)),
      mdpEngine: { render: vi.fn() },
      llmService: { chat: vi.fn() },
    }
    const gardener = new GraphGardener(deps as never)

    await expect(gardener.maintain('pero')).resolves.toBe(0)
    expect(deps.vectorRepo.link).not.toHaveBeenCalled()
  })
})

describe('DreamAssociator', () => {
  it('应当建立梦境关联并修复孤独记忆', async () => {
    const memories = [createMemory(1), createMemory(2), createMemory(3)]
    const deps = {
      memoryRepo: { list: vi.fn(() => Promise.resolve({ data: memories })) },
      memorySearch: {
        search: vi.fn((input: { query: string }) =>
          Promise.resolve([
            createMemory(input.query.includes('1') ? 2 : 1, {
              score: 0.9,
              timestamp: Date.now() - 24 * 60 * 60 * 1000,
            }),
          ]),
        ),
      },
      vectorRepo: {
        link: vi.fn(() => Promise.resolve()),
        neighbors: vi.fn(() => Promise.resolve([])),
      },
      getModelConfig: vi.fn(() =>
        Promise.resolve({ provider: 'openai', modelId: 'gpt', apiKey: 'key' }),
      ),
      mdpEngine: { render: vi.fn(() => '关系提示词') },
      llmService: {
        chat: vi.fn(() =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({ has_relation: true, type: 'dream', strength: 0.7 }),
                },
              },
            ],
          }),
        ),
      },
    }
    const associator = new DreamAssociator(deps as never, {
      anchorCount: 2,
      candidatesPerAnchor: 2,
      minTimeGapMs: 1,
      lonelyMemoryLimit: 2,
    })

    const linked = await associator.associate('pero')

    expect(linked).toBeGreaterThanOrEqual(2)
    expect(deps.memorySearch.search).toHaveBeenCalled()
    expect(deps.vectorRepo.link).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      'dream',
      0.7,
      'pero',
      'desktop',
    )
  })

  it('应当在无关联、低分和无模型时安全跳过', async () => {
    const memories = [createMemory(1), createMemory(2)]
    const deps = {
      memoryRepo: { list: vi.fn(() => Promise.resolve({ data: memories })) },
      memorySearch: { search: vi.fn(() => Promise.resolve([{ ...createMemory(2), score: 0.7 }])) },
      vectorRepo: { link: vi.fn(), neighbors: vi.fn(() => Promise.resolve([{ id: 9 }])) },
      getModelConfig: vi.fn(() => Promise.resolve(null)),
      mdpEngine: { render: vi.fn() },
      llmService: { chat: vi.fn() },
    }
    const associator = new DreamAssociator(deps as never, {
      enableLlmJudgment: true,
      minTimeGapMs: 1,
    })

    await expect(associator.associate('pero')).resolves.toBe(0)
    expect(deps.vectorRepo.link).not.toHaveBeenCalled()
  })
})

describe('ReflectionOrchestrator', () => {
  function createDeps(overrides: Record<string, unknown> = {}) {
    return {
      tagger: {
        tagUntaggedMemories: vi.fn(() =>
          Promise.resolve({
            tagged: 2,
            mergeGroups: [{ ids_to_merge: [1, 2], new_content: '合并', tags: [], importance: 5 }],
          }),
        ),
      },
      consolidator: {
        applyMergeGroups: vi.fn(() => Promise.resolve(2)),
        consolidate: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      },
      auditor: { audit: vi.fn(() => Promise.resolve(3)) },
      retirementPolicy: { retire: vi.fn(() => Promise.resolve(4)) },
      dreamAssociator: { associate: vi.fn(() => Promise.resolve(5)) },
      graphGardener: { maintain: vi.fn(() => Promise.resolve(6)) },
      waifuTextUpdater: { update: vi.fn(() => Promise.resolve(7)) },
      memoryRepo: {
        listDistinctAgentIds: vi.fn(() => Promise.resolve(['pero'])),
        countSince: vi.fn(() => Promise.resolve(10)),
      },
      gateway: { pushNotification: vi.fn(() => Promise.resolve()) },
      ...overrides,
    }
  }

  it('应当按顺序执行完整维护流程并广播进度', async () => {
    const deps = createDeps()
    const orchestrator = new ReflectionOrchestrator(deps as never, {
      minIntervalMs: 0,
      costSavingThreshold: 5,
      maxConsolidateRounds: 3,
    })

    const result = await orchestrator.run()

    expect(result.agents[0]).toMatchObject({
      agentId: 'pero',
      tagged: 2,
      consolidated: 3,
      audited: 3,
      retired: 4,
      dreamLinked: 5,
      graphEdges: 6,
      waifuTextsUpdated: 7,
    })
    expect(result.skippedByThreshold).toBe(0)
    expect(deps.gateway.pushNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: '记忆维护', level: 'info' }),
    )
    expect(orchestrator.isRunning).toBe(false)
  })

  it('应当支持降本跳过、频率限制和运行中保护', async () => {
    const deps = createDeps({
      memoryRepo: {
        listDistinctAgentIds: vi.fn(() => Promise.resolve(['pero'])),
        countSince: vi.fn(() => Promise.resolve(1)),
      },
    })
    const orchestrator = new ReflectionOrchestrator(deps as never, {
      minIntervalMs: 1000,
      costSavingThreshold: 5,
    })

    const first = await orchestrator.run(['pero'])
    const second = await orchestrator.run(['pero'])
    ;(orchestrator as unknown as { running: boolean; lastRunTime: number }).running = true
    ;(orchestrator as unknown as { lastRunTime: number }).lastRunTime = 0
    const running = await orchestrator.run(['pero'])

    expect(first.agents[0]).toMatchObject({ skippedReason: '今日新增 1 条，低于阈值', retired: 4 })
    expect(first.skippedByThreshold).toBe(1)
    expect(second.agents).toEqual([])
    expect(running.agents).toEqual([])
  })
})
