import { describe, expect, it, vi } from 'vitest'
import { Tagger } from '@infos/backend/services/memory/maintenance/tagger'
import { RetirementPolicy } from '@infos/backend/services/memory/maintenance/retirementPolicy'
import { Consolidator } from '@infos/backend/services/memory/maintenance/consolidator'

function createMemory(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    content: `记忆 ${id}`,
    agentId: 'pero',
    tags: '',
    clusters: '',
    importance: 2,
    source: 'desktop',
    type: 'event',
    timestamp: Date.now() - 10 * 24 * 60 * 60 * 1000,
    prevId: null,
    nextId: null,
    ...overrides,
  }
}

describe('Tagger', () => {
  it('应当批量标注未标注记忆并返回合并建议', async () => {
    const memories = [createMemory(1), createMemory(2)]
    const memoryRepo = {
      findUntagged: vi.fn(() => Promise.resolve(memories)),
      update: vi.fn(() => Promise.resolve()),
      findById: vi.fn((id: number) =>
        Promise.resolve(memories.find((item) => item.id === id) ?? null),
      ),
    }
    const vectorWriteHelper = { upsertWithFallback: vi.fn(() => Promise.resolve()) }
    const llmService = {
      chat: vi.fn(() =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  evaluations: {
                    1: {
                      importance: 12,
                      tags: ['猫咪'],
                      clusters: ['偏好'],
                      suggestedType: 'preference',
                    },
                    2: {
                      importance: 0,
                      tags: ['日常'],
                      clusters: ['生活'],
                      suggestedType: 'unsafe',
                    },
                    bad: { importance: 5, tags: ['忽略'], clusters: [], suggestedType: null },
                  },
                  merge_groups: [
                    {
                      ids_to_merge: [1, 2],
                      new_content: '主人喜欢猫咪',
                      tags: ['猫咪'],
                      importance: 6,
                    },
                  ],
                }),
              },
            },
          ],
        }),
      ),
    }
    const mdpEngine = { render: vi.fn(() => 'system prompt') }
    const tagger = new Tagger(
      memoryRepo as never,
      vectorWriteHelper as never,
      llmService as never,
      vi.fn(() => Promise.resolve({ provider: 'openai', modelId: 'gpt', apiKey: 'key' })),
      mdpEngine as never,
    )

    const result = await tagger.tagUntaggedMemories('pero', 10)

    expect(result).toEqual({
      tagged: 2,
      mergeGroups: [
        { ids_to_merge: [1, 2], new_content: '主人喜欢猫咪', tags: ['猫咪'], importance: 6 },
      ],
    })
    expect(memoryRepo.update).toHaveBeenCalledWith(1, {
      tags: '猫咪',
      clusters: '偏好',
      importance: 10,
      type: 'preference',
    })
    expect(memoryRepo.update).toHaveBeenCalledWith(2, {
      tags: '日常',
      clusters: '生活',
      importance: 1,
    })
    expect(vectorWriteHelper.upsertWithFallback).toHaveBeenCalledTimes(2)
    expect(llmService.chat).toHaveBeenCalledWith(
      expect.any(Object),
      expect.arrayContaining([expect.objectContaining({ role: 'system' })]),
      { responseFormat: { type: 'json_object' } },
    )
  })

  it('应当在没有待标注记忆、没有模型或 LLM 失败时安全返回', async () => {
    const emptyRepo = { findUntagged: vi.fn(() => Promise.resolve([])) }
    const noModelRepo = { findUntagged: vi.fn(() => Promise.resolve([createMemory(1)])) }
    const failRepo = {
      findUntagged: vi.fn(() => Promise.resolve([createMemory(1)])),
      update: vi.fn(),
      findById: vi.fn(),
    }

    const empty = new Tagger(emptyRepo as never, {} as never, {} as never, vi.fn(), {} as never)
    const noModel = new Tagger(
      noModelRepo as never,
      {} as never,
      {} as never,
      vi.fn(() => Promise.resolve(null)),
      {} as never,
    )
    const failing = new Tagger(
      failRepo as never,
      { upsertWithFallback: vi.fn() } as never,
      { chat: vi.fn(() => Promise.reject(new Error('失败'))) } as never,
      vi.fn(() => Promise.resolve({ provider: 'openai', modelId: 'gpt', apiKey: 'key' })),
      { render: vi.fn(() => 'prompt') } as never,
    )

    await expect(empty.tagUntaggedMemories('pero')).resolves.toEqual({ tagged: 0, mergeGroups: [] })
    await expect(noModel.tagUntaggedMemories('pero')).resolves.toEqual({
      tagged: 0,
      mergeGroups: [],
    })
    await expect(failing.tagUntaggedMemories('pero')).resolves.toEqual({
      tagged: 0,
      mergeGroups: [],
    })
  })
})

describe('RetirementPolicy', () => {
  it('应当按年龄、重要性和容量边界退役低价值记忆', async () => {
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000
    const fresh = Date.now()
    const candidates = [
      createMemory(1, { timestamp: old, importance: 1 }),
      createMemory(2, { timestamp: old, type: 'preference' }),
      createMemory(3, { timestamp: fresh, importance: 1 }),
    ]
    const overflow = [createMemory(4, { importance: 3 }), createMemory(5, { importance: 5 })]
    const memoryRepo = {
      findRetirementCandidates: vi.fn(() => Promise.resolve(candidates)),
      countByType: vi.fn(() => Promise.resolve(1002)),
      findOverflowMemories: vi.fn(() => Promise.resolve(overflow)),
      update: vi.fn(() => Promise.resolve()),
    }
    const vectorWriteHelper = { deleteWithFallback: vi.fn(() => Promise.resolve()) }
    const policy = new RetirementPolicy(memoryRepo as never, vectorWriteHelper as never, {
      ageDays: 30,
      eventCapacity: 1000,
    })

    const retired = await policy.retire('pero')

    expect(retired).toBe(2)
    expect(memoryRepo.update).toHaveBeenCalledWith(1, { type: 'retired' })
    expect(memoryRepo.update).toHaveBeenCalledWith(4, { type: 'retired' })
    expect(vectorWriteHelper.deleteWithFallback).toHaveBeenCalledWith(1, 'pero', 'desktop')
    expect(vectorWriteHelper.deleteWithFallback).toHaveBeenCalledWith(4, 'pero', 'desktop')
  })

  it('应当在无候选、容量未超限或单条退役失败时继续执行', async () => {
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000
    const memoryRepo = {
      findRetirementCandidates: vi.fn(() =>
        Promise.resolve([createMemory(1, { timestamp: old }), createMemory(2, { timestamp: old })]),
      ),
      countByType: vi.fn(() => Promise.resolve(10)),
      findOverflowMemories: vi.fn(),
      update: vi.fn((id: number) =>
        id === 1 ? Promise.reject(new Error('失败')) : Promise.resolve(),
      ),
    }
    const vectorWriteHelper = { deleteWithFallback: vi.fn(() => Promise.resolve()) }
    const policy = new RetirementPolicy(memoryRepo as never, vectorWriteHelper as never, {
      ageDays: 30,
    })

    await expect(policy.retire('pero')).resolves.toBe(1)
    expect(memoryRepo.findOverflowMemories).not.toHaveBeenCalled()
  })
})

describe('Consolidator', () => {
  function createDeps(memories = [createMemory(1), createMemory(2)]) {
    const memoryRepo = {
      findById: vi.fn((id: number) =>
        Promise.resolve(memories.find((item) => item.id === id) ?? null),
      ),
      create: vi.fn((data: Record<string, unknown>) => Promise.resolve(createMemory(99, data))),
      update: vi.fn(() => Promise.resolve()),
      findConsolidationCandidates: vi.fn(() => Promise.resolve(memories)),
    }
    const vectorRepo = {
      neighbors: vi.fn((id: number) => Promise.resolve(id === 1 ? [7, 2] : [8])),
      link: vi.fn(() => Promise.resolve()),
    }
    const vectorWriteHelper = {
      upsertWithFallback: vi.fn(() => Promise.resolve()),
      deleteWithFallback: vi.fn(() => Promise.resolve()),
    }
    const llmService = {
      chat: vi.fn(() =>
        Promise.resolve({
          choices: [
            { message: { content: JSON.stringify({ summary: '整合后的记忆', importance: 8 }) } },
          ],
        }),
      ),
    }
    const mdpEngine = { render: vi.fn(() => 'reflection prompt') }
    const getModelConfig: () => Promise<{
      provider: string
      modelId: string
      apiKey: string
    } | null> = vi.fn(() => Promise.resolve({ provider: 'openai', modelId: 'gpt', apiKey: 'key' }))
    return { memoryRepo, vectorRepo, vectorWriteHelper, llmService, mdpEngine, getModelConfig }
  }

  it('应当应用 Tagger 的合并建议并归档原始记忆', async () => {
    const memories = [createMemory(1, { prevId: 10 }), createMemory(2, { nextId: 11 })]
    const deps = createDeps(memories)
    const consolidator = new Consolidator(deps as never)

    const count = await consolidator.applyMergeGroups('pero', [
      { ids_to_merge: [1, 2], new_content: '主人喜欢猫咪', tags: ['猫咪', '偏好'], importance: 12 },
      { ids_to_merge: [1], new_content: '忽略', tags: [], importance: 1 },
    ])

    expect(count).toBe(2)
    expect(deps.memoryRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: '主人喜欢猫咪', importance: 10 }),
    )
    expect(deps.vectorWriteHelper.upsertWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ memoryId: 99 }),
    )
    expect(deps.memoryRepo.update).toHaveBeenCalledWith(1, { type: 'archived_event' })
    expect(deps.memoryRepo.update).toHaveBeenCalledWith(2, { type: 'archived_event' })
    expect(deps.vectorRepo.link).toHaveBeenCalledWith(99, 7, 'inherited', 0.6, 'pero', 'desktop')
  })

  it('应当主动整合候选记忆并处理模型或候选不足场景', async () => {
    const date = Date.now() - 5 * 24 * 60 * 60 * 1000
    const memories = [
      createMemory(1, { timestamp: date }),
      createMemory(2, { timestamp: date }),
      createMemory(3, { timestamp: date }),
    ]
    const deps = createDeps(memories)
    const consolidator = new Consolidator(deps as never, { minGroupSize: 3, maxGroups: 1 })
    const noModelDeps = createDeps(memories)
    noModelDeps.getModelConfig = vi.fn(() => Promise.resolve(null))
    const noModel = new Consolidator(noModelDeps as never, { minGroupSize: 3 })
    const tooFewDeps = createDeps([createMemory(1)])
    const tooFew = new Consolidator(tooFewDeps as never, { minGroupSize: 3 })

    await expect(consolidator.consolidate('pero')).resolves.toBe(3)
    await expect(noModel.consolidate('pero')).resolves.toBe(0)
    await expect(tooFew.consolidate('pero')).resolves.toBe(0)
    expect(deps.llmService.chat).toHaveBeenCalledWith(
      expect.any(Object),
      expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ role: 'user' }),
      ]),
      { responseFormat: { type: 'json_object' } },
    )
  })
})
