import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleConnection, closeDrizzleConnection } from '@infos/backend/database'
import { EventNoteRepository } from '@infos/backend/repositories/eventNote.repo'
import { ThreadRepository } from '@infos/backend/repositories/thread.repo'
import { MemoryStoreRegistry } from '@infos/backend/repositories/storeRegistry'
import { EventMemoryService } from '@infos/backend/services/memory/eventMemoryService'
import { EventReflectionService } from '@infos/backend/services/memory/eventReflectionService'
import { DailyNotesService } from '@infos/backend/services/memory/dailyNotesService'
import { ThreadService } from '@infos/backend/services/thread/threadService'
import { createMemoryRouter } from '@infos/backend/routers/memory.router'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createFixture() {
  const root = join(tmpdir(), `infos-event-memory-${Date.now()}-${Math.random()}`)
  roots.push(root)
  mkdirSync(root, { recursive: true })
  const db = createDrizzleConnection(join(root, 'infos.db'))
  const resolver = {
    resolve(alias: string) {
      if (alias === '@data') return root
      if (alias.startsWith('@data/')) return join(root, alias.slice('@data/'.length))
      throw new Error(`未处理路径: ${alias}`)
    },
  }
  const stores = new MemoryStoreRegistry(resolver as never, 4)
  const embeddings = {
    embedOne: async (text: string) => [text.length % 3, 1, 0, 0],
  }
  const repo = new EventNoteRepository(db)
  const service = new EventMemoryService(repo, stores, embeddings as never)
  return { db, stores, repo, service }
}

function countNodesByKind(
  stores: MemoryStoreRegistry,
  kind: 'event_note' | 'event_entity',
): number {
  const store = stores.getAgentStore('pero')
  return store.allNodeIds().filter((id) => store.get<{ kind?: string }>(id)?.payload?.kind === kind)
    .length
}

const draft = {
  narrative: '我和用户确认了新版事件记忆的时间轴设计。',
  importance: 8,
  affect: { tones: ['认真'], valence: 7, arousal: 6 },
  participants: ['用户'],
  topics: ['事件记忆'],
  agentId: 'pero',
  eventAt: '2026-08-27T10:00:00.000Z',
  origin: {
    mode: 'active' as const,
    threadId: 'thread-1',
    pairIds: ['pair-1'],
    messageIds: ['message-1', 'message-2'],
    channel: 'desktop',
  },
}

describe('EventMemoryService真实双库存储', () => {
  it('Coverage Claim应原子互斥并在提交后释放', async () => {
    const { db, stores, repo } = createFixture()
    const first = await repo.claimCoverageRange({
      agentId: 'pero',
      threadId: 'thread-1',
      pairIds: ['pair-claim-1', 'pair-claim-2'],
      ownerId: 'active-owner',
    })
    const competing = await repo.claimCoverageRange({
      agentId: 'pero',
      threadId: 'thread-1',
      pairIds: ['pair-claim-2'],
      ownerId: 'background-owner',
    })
    expect(first).toBe(true)
    expect(competing).toBe(false)

    await repo.commitCoverageUnderClaim(
      {
        id: 'coverage-claim',
        agentId: 'pero',
        threadId: 'thread-1',
        pairIds: ['pair-claim-1', 'pair-claim-2'],
        messageIds: ['1', '2'],
        outcome: 'reviewed_no_event',
        eventNoteIds: [],
        mode: 'active',
        coveredAt: '2026-08-27T10:00:00.000Z',
      },
      'active-owner',
    )
    expect(
      await repo.claimCoverageRange({
        agentId: 'pero',
        threadId: 'thread-1',
        pairIds: ['pair-claim-1'],
        ownerId: 'later-owner',
      }),
    ).toBe(false)

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('按Pair回溯失效后只应重新开放命中的Coverage', async () => {
    const { db, stores, repo } = createFixture()
    for (const [id, pairId] of [
      ['coverage-a', 'pair-a'],
      ['coverage-b', 'pair-b'],
    ] as const) {
      await repo.saveCoverage({
        id,
        agentId: 'pero',
        threadId: 'thread-1',
        pairIds: [pairId],
        messageIds: [],
        outcome: 'reviewed_no_event',
        eventNoteIds: [],
        mode: 'background',
        coveredAt: '2026-08-27T10:00:00.000Z',
      })
    }
    await repo.invalidateCoverageByPairIds('thread-1', ['pair-a'])

    expect(await repo.coveredPairIds('pero', 'thread-1')).toEqual(new Set(['pair-b']))
    expect(
      await repo.claimCoverageRange({
        agentId: 'pero',
        threadId: 'thread-1',
        pairIds: ['pair-a'],
        ownerId: 'rewind-owner',
      }),
    ).toBe(true)

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('日记任务应持久幂等并按10分钟开始退避且不把审计写入正文', async () => {
    const { db, stores, repo, service } = createFixture()
    await service.create(draft, 'daily-note-event')
    const write = vi.fn()
    const chatText = vi
      .fn()
      .mockRejectedValueOnce(new Error('日记模型暂时失败'))
      .mockResolvedValue('今天我和用户认真确认了事件记忆方案。')
    let now = new Date('2026-08-27T21:00:00.000Z')
    const getModelConfig = vi.fn().mockResolvedValue({})
    const createDaily = () =>
      new DailyNotesService(
        service,
        { getAgent: vi.fn().mockReturnValue(null) } as never,
        { write } as never,
        { resolve: vi.fn().mockReturnValue('Z:/不存在/system_prompt.md') } as never,
        { chatText } as never,
        getModelConfig as never,
        repo,
        undefined,
        undefined,
        () => now,
      )
    const daily = createDaily()
    await expect(daily.generate('pero', '2026-08-27', true)).rejects.toThrow('日记模型暂时失败')
    expect((await repo.dailyNoteTask('pero', '2026-08-27'))?.nextAttemptAt).toBe(
      '2026-08-27T21:10:00.000Z',
    )

    expect(await createDaily().generate('pero', '2026-08-27', true)).toEqual([])
    now = new Date('2026-08-27T21:10:00.000Z')
    expect(await createDaily().generate('pero', '2026-08-27', true)).toEqual(['2026-08-27.md'])
    expect(getModelConfig).toHaveBeenCalledWith('pero')
    expect(write).toHaveBeenCalledWith(
      'pero',
      'dailynotes/2026-08-27.md',
      expect.not.stringContaining('sourceIncomplete'),
      'desktop',
    )

    const restarted = createDaily()
    expect(await restarted.generate('pero', '2026-08-27', false)).toEqual(['2026-08-27.md'])
    expect(write).toHaveBeenCalledTimes(1)

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('日记应合并事件记忆、已审阅原始互动和Application当日摘要', async () => {
    const { db, stores, repo, service } = createFixture()
    await service.create(draft, 'daily-note-three-sources')
    await repo.saveCoverage({
      id: 'daily-reviewed-coverage',
      agentId: 'pero',
      threadId: 'thread-1',
      pairIds: ['pair-reviewed'],
      messageIds: ['message-reviewed-user', 'message-reviewed-assistant'],
      outcome: 'reviewed_no_event',
      eventNoteIds: [],
      mode: 'background',
      coveredAt: '2026-08-27T12:00:00.000Z',
    })
    const chatText = vi.fn().mockResolvedValue('今天发生了值得整理的互动。')
    const write = vi.fn()
    const findMessagesByPairIds = vi.fn().mockResolvedValue([
      { role: 'user', content: '今天继续完成长记忆收口。' },
      { role: 'assistant', content: '我会继续完成最后验收。' },
    ])
    const daily = new DailyNotesService(
      service,
      { getAgent: vi.fn().mockReturnValue(null) } as never,
      { write } as never,
      { resolve: vi.fn().mockReturnValue('Z:/不存在/system_prompt.md') } as never,
      { chatText } as never,
      async () => ({}) as never,
      repo,
      { findMessagesByPairIds } as never,
      async () => ['社交应用完成了当日消息整理。'],
      () => new Date('2026-08-27T21:00:00.000Z'),
    )

    expect(await daily.generate('pero', '2026-08-27', true)).toEqual(['2026-08-27.md'])
    const prompt = chatText.mock.calls[0]?.[1]?.[1]?.content as string
    expect(prompt).toContain(draft.narrative)
    expect(prompt).toContain('user: 今天继续完成长记忆收口。')
    expect(prompt).toContain('assistant: 我会继续完成最后验收。')
    expect(prompt).toContain('社交应用完成了当日消息整理。')
    expect(prompt).not.toContain('sourceIncomplete')
    expect(findMessagesByPairIds).toHaveBeenCalledWith('thread-1', ['pair-reviewed'])

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('Reflection持久任务应支持失败重试、主事件修订与重叠事件归档', async () => {
    const { db, stores, repo, service } = createFixture()
    const main = await service.create(draft, 'reflection-main')
    const overlap = await service.create(
      {
        ...draft,
        narrative: '同一互动的重复记述。',
        eventAt: '2026-08-27T11:00:00.000Z',
        origin: { ...draft.origin, pairIds: ['reflection-overlap'] },
      },
      'reflection-overlap',
    )
    const model = {
      reflect: vi
        .fn()
        .mockRejectedValueOnce(new Error('模型暂时失败'))
        .mockResolvedValue({
          links: [],
          removeLinks: [],
          archive: false,
          revision: { narrative: '我修订并保留了更完整的主事件。', topics: ['事件记忆', '修订'] },
          archiveOverlaps: [overlap.id],
        }),
    }
    const reflection = new EventReflectionService(service, stores, model, repo)
    await reflection.enqueue('pero', main.id)
    await reflection.drain()
    expect(model.reflect).toHaveBeenCalledTimes(1)

    const restarted = new EventReflectionService(service, stores, model, repo)
    await restarted.drain()
    expect(model.reflect).toHaveBeenCalledTimes(2)

    const current = (await repo.list('pero', { includeArchived: true })).find(
      (note) => note.narrative === '我修订并保留了更完整的主事件。',
    )
    expect(current?.topics).toContain('修订')
    expect((await repo.findById(overlap.id))?.status).toBe('archived')
    const overlapRelation = (await repo.listRelations(current!.id)).find(
      (relation) => relation.relation === 'same_event',
    )
    expect(overlapRelation).toBeDefined()
    expect(new Set([overlapRelation!.sourceId, overlapRelation!.targetId])).toEqual(
      new Set([current!.id, overlap.id]),
    )

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('详细查询应返回确定性路径并遵守节点与Token预算', async () => {
    const { db, stores, service } = createFixture()
    const first = await service.create(draft, 'query-path-first')
    const second = await service.create(
      {
        ...draft,
        narrative: '第二个事件沿着主题关系连接。',
        eventAt: '2026-08-27T11:00:00.000Z',
        origin: { ...draft.origin, pairIds: ['query-path-pair-2'] },
      },
      'query-path-second',
    )
    await service.addRelation(first.id, second.id, 'same_topic', 0.9, 'query-path-link')

    const detailed = await service.queryDetailed({
      agentId: 'pero',
      mode: 'time_range',
      from: first.eventAt,
      to: first.eventAt,
      limit: 1,
      maxDepth: 1,
      maxNodes: 2,
      maxReturnTokens: 4_000,
      edgeLabels: ['same_topic'],
      direction: 'both',
    })
    expect(detailed.notes.map((note) => note.id)).toEqual([first.id, second.id])
    const path = detailed.paths.find((item) => item.targetId === second.id)?.edges
    expect(path).toHaveLength(1)
    expect(path?.[0]).toMatchObject({ relation: 'same_topic', weight: 0.9 })
    expect(new Set([path?.[0]?.fromEventId, path?.[0]?.toEventId])).toEqual(
      new Set([first.id, second.id]),
    )
    expect(detailed.truncated).toBe(false)
    expect(detailed.returnedTokens).toBeGreaterThan(0)

    const entityResult = await service.queryDetailed({
      agentId: 'pero',
      mode: 'time_range',
      from: first.eventAt,
      to: first.eventAt,
      limit: 1,
      maxDepth: 1,
      maxNodes: 5,
      edgeLabels: ['involves_person'],
    })
    expect(entityResult.entities).toContainEqual(
      expect.objectContaining({
        entityType: 'person',
        name: '用户',
      }),
    )
    expect(
      entityResult.paths.find((item) => item.targetId === 'entity:person:用户')?.edges[0],
    ).toMatchObject({ relation: 'involves_person', fromKind: 'event_note', toKind: 'event_entity' })

    const tokenLimited = await service.queryDetailed({
      agentId: 'pero',
      mode: 'recent',
      limit: 2,
      maxDepth: 0,
      maxReturnTokens: 1,
    })
    expect(tokenLimited.notes).toHaveLength(0)
    expect(tokenLimited.truncated).toBe(true)

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('写入事件时应同时创建SQLite备份、Coverage和TDB节点', async () => {
    const { db, stores, repo, service } = createFixture()
    const note = await service.create(draft, 'operation-create')

    const backup = await repo.findById(note.id)
    expect(backup?.narrative).toBe(draft.narrative)
    expect(stores.getAgentStore('pero').get(backup!.tdbId)?.payload).toMatchObject({
      id: note.id,
      kind: 'event_note',
    })
    expect(await repo.coveredPairIds('pero', 'thread-1')).toContain('pair-1')

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('修订时应替换TDB节点并在SQLite保留旧版本', async () => {
    const { db, stores, repo, service } = createFixture()
    const old = await service.create(draft, 'operation-old')
    const oldBackup = await repo.findById(old.id)
    const revised = await service.revise(
      old.id,
      {
        ...draft,
        narrative: '我和用户最终确认了新版事件记忆的完整时间轴方案。',
        origin: { ...draft.origin, pairIds: ['pair-2'], messageIds: ['message-3'] },
      },
      'operation-revise',
    )

    expect((await repo.findById(old.id))?.replacedBy).toBe(revised.id)
    expect(stores.getAgentStore('pero').contains(oldBackup!.tdbId)).toBe(false)
    expect((await repo.findById(revised.id))?.origin.pairIds).toEqual(['pair-1', 'pair-2'])

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('修订在TDB提交后SQLite committed标记失败，重放不得产生重复节点或断裂时间链', async () => {
    const { db, stores, repo, service } = createFixture()
    const first = await service.create(draft, 'revise-commit-first')
    const target = await service.create(
      {
        ...draft,
        narrative: '等待故障修订的中间事件。',
        eventAt: '2026-08-27T11:00:00.000Z',
        origin: { ...draft.origin, pairIds: ['revise-commit-target'] },
      },
      'revise-commit-target',
    )
    const last = await service.create(
      {
        ...draft,
        narrative: '修订目标之后的事件。',
        eventAt: '2026-08-27T12:00:00.000Z',
        origin: { ...draft.origin, pairIds: ['revise-commit-last'] },
      },
      'revise-commit-last',
    )
    const originalMarkCommitted = repo.markOperationCommitted.bind(repo)
    let failed = false
    const markSpy = vi
      .spyOn(repo, 'markOperationCommitted')
      .mockImplementation(async (operationId) => {
        if (operationId === 'revise-commit-fault' && !failed) {
          failed = true
          throw new Error('模拟SQLite committed标记失败')
        }
        await originalMarkCommitted(operationId)
      })

    await expect(
      service.revise(
        target.id,
        {
          ...draft,
          narrative: '故障恢复后的修订事件。',
          origin: { ...draft.origin, pairIds: ['revise-commit-new'] },
        },
        'revise-commit-fault',
        { deferCoverage: true },
      ),
    ).rejects.toThrow('模拟SQLite committed标记失败')
    const operation = await repo.findOperation('revise-commit-fault')
    const replacement = (operation!.payload as { replacement: typeof target }).replacement
    const replacementRow = await repo.findById(replacement.id)
    const firstRow = await repo.findById(first.id)
    const lastRow = await repo.findById(last.id)
    const store = stores.getAgentStore('pero')
    expect(countNodesByKind(stores, 'event_note')).toBe(3)
    expect(store.getEdge(firstRow!.tdbId, replacementRow!.tdbId, 'temporal_next')).not.toBeNull()
    expect(store.getEdge(replacementRow!.tdbId, lastRow!.tdbId, 'temporal_next')).not.toBeNull()

    markSpy.mockRestore()
    await service.replayPending()
    expect((await repo.findOperation('revise-commit-fault'))?.status).toBe('committed')
    expect(countNodesByKind(stores, 'event_note')).toBe(3)
    expect(store.getEdge(firstRow!.tdbId, replacementRow!.tdbId, 'temporal_next')).not.toBeNull()
    expect(store.getEdge(replacementRow!.tdbId, lastRow!.tdbId, 'temporal_next')).not.toBeNull()

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('修订关系替换失败后重放应恢复关系且不产生重复边', async () => {
    const { db, stores, repo, service } = createFixture()
    const target = await service.create(draft, 'revise-relation-target')
    const related = await service.create(
      {
        ...draft,
        narrative: '与修订目标保持主题关系的事件。',
        eventAt: '2026-08-27T11:00:00.000Z',
        origin: { ...draft.origin, pairIds: ['revise-relation-related'] },
      },
      'revise-relation-related',
    )
    await service.addRelation(target.id, related.id, 'same_topic', 0.9, 'revise-relation-link')
    const originalAddRelation = repo.addRelation.bind(repo)
    let failed = false
    const addSpy = vi.spyOn(repo, 'addRelation').mockImplementation(async (input) => {
      if (!failed) {
        failed = true
        throw new Error('模拟关系替换失败')
      }
      await originalAddRelation(input)
    })

    await expect(
      service.revise(
        target.id,
        {
          ...draft,
          narrative: '关系故障恢复后的修订事件。',
          origin: { ...draft.origin, pairIds: ['revise-relation-new'] },
        },
        'revise-relation-fault',
        { deferCoverage: true },
      ),
    ).rejects.toThrow('模拟关系替换失败')
    addSpy.mockRestore()
    await service.replayPending()

    const operation = await repo.findOperation('revise-relation-fault')
    const replacement = (operation!.payload as { replacement: typeof target }).replacement
    expect(operation?.status).toBe('committed')
    expect(await repo.listRelations(target.id)).toHaveLength(0)
    expect(await repo.listRelations(replacement.id)).toEqual([
      expect.objectContaining({ relation: 'same_topic', weight: 0.9 }),
    ])
    const replacementRow = await repo.findById(replacement.id)
    const relatedRow = await repo.findById(related.id)
    const store = stores.getAgentStore('pero')
    const outgoing = store
      .getEdges(replacementRow!.tdbId)
      .filter((edge) => edge.targetId === relatedRow!.tdbId && edge.label === 'same_topic')
    const incoming = store
      .getIncomingEdges(replacementRow!.tdbId)
      .filter((edge) => edge.sourceId === relatedRow!.tdbId && edge.label === 'same_topic')
    expect(outgoing.length + incoming.length).toBe(1)
    expect(countNodesByKind(stores, 'event_note')).toBe(2)

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('自动RAG只应从活跃时间轴补充末尾与直接前驱', async () => {
    const { db, stores, service } = createFixture()
    const first = await service.create(draft, 'operation-first')
    const second = await service.create(
      {
        ...draft,
        narrative: '第二件互动事件',
        eventAt: '2026-08-27T11:00:00.000Z',
        origin: { ...draft.origin, pairIds: ['pair-2'] },
      },
      'operation-second',
    )
    await service.addRelation(first.id, second.id, 'same_topic', 1, 'operation-link')
    await service.archive(first.id, 'operation-archive')

    const firstRow = await service.detail(first.id)
    const secondRow = await service.detail(second.id)
    const store = stores.getAgentStore('pero')
    expect(firstRow?.status).toBe('archived')
    expect(
      store
        .getEdges((await service.detail(first.id))!.tdbId)
        .some((edge) => edge.targetId === secondRow!.tdbId && edge.label === 'same_topic'),
    ).toBe(true)

    const rag = await service.automaticRag('pero', '第二件互动事件', 1)
    expect(rag.map((note) => note.id)).not.toContain(first.id)
    expect(rag.map((note) => note.id)).toContain(second.id)
    expect(rag.every((note) => note.status === 'active')).toBe(true)

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('应通过真实TDB高级API执行SA-PPR、FISTA、DPP与Leiden并按Pair隔离Trace', async () => {
    const { db, stores, service } = createFixture()
    await service.create(draft, 'advanced-first')
    await service.create(
      {
        ...draft,
        narrative: '我继续和用户确认高级记忆检索管线。',
        eventAt: '2026-08-27T11:00:00.000Z',
        origin: { ...draft.origin, pairIds: ['pair-2'] },
      },
      'advanced-second',
    )
    await service.create(
      {
        ...draft,
        narrative: '我完成了SA-PPR与Leiden的接线。',
        eventAt: '2026-08-27T12:00:00.000Z',
        origin: { ...draft.origin, pairIds: ['pair-3'] },
      },
      'advanced-third',
    )
    const store = stores.getAgentStore('pero')
    const searchAdvanced = vi.spyOn(store, 'searchAdvanced')
    const leidenCluster = vi.spyOn(store, 'leidenCluster')
    service.setAdvancedRetrieval({} as never, async () => ({
      channels: {
        desktop: { contextPairs: 20, enableAutoRag: true, retrievalLimit: 8 },
        group: { contextPairs: 20, enableAutoRag: true, retrievalLimit: 3 },
      },
      advanced: {
        enableSaPpr: true,
        expandDepth: 3,
        teleportAlpha: 0.2,
        minScore: -1,
        enableFista: true,
        enableDpp: true,
        enableContextRnn: false,
        enableLeiden: true,
        enableFeedback: true,
      },
    }))

    const progress: Array<{ stage: string; message: string }> = []
    const notes = await service.automaticRag(
      'pero',
      '高级记忆检索',
      2,
      'desktop',
      'pair-advanced',
      (event) => {
        progress.push(event)
      },
    )

    expect(notes.length).toBeGreaterThan(0)
    expect(progress.map((event) => event.stage)).toEqual([
      'embedding',
      'retrieval',
      'reranking',
      'timeline',
      'completed',
    ])
    expect(progress[1]?.message).toContain('Top-2')
    expect(searchAdvanced).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        expandDepth: 3,
        teleportAlpha: 0.2,
        enableSparseResidual: true,
        enableDpp: true,
        enableAdvancedPipeline: true,
      }),
    )
    expect(leidenCluster).toHaveBeenCalledWith({ withCentroids: true })
    expect(service.takeAutomaticRagTrace('pair-advanced')).toMatchObject({
      agentId: 'pero',
      channel: 'desktop',
      query: '高级记忆检索',
    })
    expect(service.takeAutomaticRagTrace('pair-advanced')).toBeUndefined()

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('TDB全库丢失后应从SQLite完整重建节点、时间链和关系', async () => {
    const { db, stores, repo, service } = createFixture()
    const first = await service.create(draft, 'operation-rebuild-first')
    const second = await service.create(
      { ...draft, narrative: '重建后的第二个事件', eventAt: '2026-08-27T11:00:00.000Z' },
      'operation-rebuild-second',
    )
    await service.addRelation(first.id, second.id, 'same_topic', 1, 'operation-rebuild-relation')
    const firstRow = await repo.findById(first.id)
    const secondRow = await repo.findById(second.id)

    await service.rebuildAgentStore('pero')
    const store = stores.getAgentStore('pero')
    expect(countNodesByKind(stores, 'event_note')).toBe(2)
    expect(countNodesByKind(stores, 'event_entity')).toBe(1)
    expect(store.getEdge(firstRow!.tdbId, secondRow!.tdbId, 'temporal_next')).not.toBeNull()
    const [source, target] =
      first.id < second.id ? [firstRow!, secondRow!] : [secondRow!, firstRow!]
    expect(store.getEdge(source.tdbId, target.tdbId, 'same_topic')).not.toBeNull()

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('对称关系应按EventNote ID规范为单边并可双向查询', async () => {
    const { db, stores, repo, service } = createFixture()
    const first = await service.create(draft, 'operation-relation-first')
    const second = await service.create(
      { ...draft, narrative: '同一次持续互动的补充', eventAt: '2026-08-27T11:00:00.000Z' },
      'operation-relation-second',
    )
    await service.addRelation(second.id, first.id, 'same_event', 1, 'operation-same-event')

    const relations = await repo.listRelations(first.id)
    expect(relations).toHaveLength(1)
    expect(relations[0]).toMatchObject({
      sourceId: [first.id, second.id].sort()[0],
      targetId: [first.id, second.id].sort()[1],
      relation: 'same_event',
    })
    const queried = await service.query({
      agentId: 'pero',
      query: first.narrative,
      mode: 'same_event',
      limit: 10,
    })
    expect(queried.map((note) => note.id)).toEqual(expect.arrayContaining([first.id, second.id]))

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('正常查询应以TDB为唯一运行时数据源', async () => {
    const { db, stores, repo, service } = createFixture()
    const note = await service.create(draft, 'operation-tdb-query')
    await repo.deleteBackup(note.id)

    const result = await service.query({
      agentId: 'pero',
      query: '时间轴设计',
      mode: 'mixed',
      limit: 10,
    })
    expect(result.map((item) => item.id)).toContain(note.id)

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('Thread软删除应失效Coverage并使来源Router返回原文不可用', async () => {
    const { db, stores, repo, service } = createFixture()
    const threads = new ThreadRepository(db)
    await threads.createThread({
      id: 'thread-lifecycle',
      agentId: 'pero',
      channel: 'desktop',
    })
    const user = await threads.appendMessage({
      threadId: 'thread-lifecycle',
      role: 'user',
      content: '将被软删除的来源消息。',
      pairId: 'pair-lifecycle',
      agentId: 'pero',
    })
    const assistant = await threads.appendMessage({
      threadId: 'thread-lifecycle',
      role: 'assistant',
      content: '这条回复对应同一个来源Pair。',
      pairId: 'pair-lifecycle',
      agentId: 'pero',
    })
    const note = await service.create(
      {
        ...draft,
        origin: {
          ...draft.origin,
          threadId: 'thread-lifecycle',
          pairIds: ['pair-lifecycle'],
          messageIds: [String(user.id), String(assistant.id)],
        },
      },
      'thread-lifecycle-note',
    )
    const threadService = new ThreadService(threads, undefined, undefined, {
      invalidatePairs: (threadId, pairIds) => repo.invalidateCoverageByPairIds(threadId, pairIds),
      invalidateThread: (threadId) => repo.invalidateThreadCoverage(threadId),
    })

    expect(await repo.coveredPairIds('pero', 'thread-lifecycle')).toContain('pair-lifecycle')
    expect(await threadService.deleteThread('thread-lifecycle')).toBe(true)
    expect(await repo.coveredPairIds('pero', 'thread-lifecycle')).not.toContain('pair-lifecycle')
    const router = createMemoryRouter({ eventMemoryService: service, threadRepo: threads } as never)
    const sourceResponse = await router.request(`http://test/${note.id}/source`)
    const source = (await sourceResponse.json()) as {
      data: { available: boolean; messages: unknown[] }
    }
    expect(source.data).toEqual({ available: false, messages: [] })
    expect(await service.detail(note.id)).toBeDefined()

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('同一operationId直接重复调用不应创建第二个SQLite备份或TDB节点', async () => {
    const { db, stores, repo, service } = createFixture()
    const first = await service.create(draft, 'direct-replay-operation')
    const replayed = await service.create(
      { ...draft, narrative: '这次输入不应生效' },
      'direct-replay-operation',
    )

    expect(replayed.id).toBe(first.id)
    expect((await repo.list('pero', { includeArchived: true })).length).toBe(1)
    expect(countNodesByKind(stores, 'event_note')).toBe(1)
    expect(countNodesByKind(stores, 'event_entity')).toBe(1)

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('同一operationId重放不应生成重复节点', async () => {
    const { db, stores, repo, service } = createFixture()
    await service.create(draft, 'same-operation')
    await service.replayPending()

    expect((await repo.list('pero', { includeArchived: true })).length).toBe(1)
    expect(countNodesByKind(stores, 'event_note')).toBe(1)
    expect(countNodesByKind(stores, 'event_entity')).toBe(1)

    stores.closeAll()
    closeDrizzleConnection(db)
  })
})
