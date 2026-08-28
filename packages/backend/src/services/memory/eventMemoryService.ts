import { randomUUID } from 'node:crypto'
import type {
  ConversationCoverage,
  EventNote,
  EventNoteArchiveFilter,
  EventNoteArchiveResult,
  EventNoteDetail,
  EventNoteDraftInput,
  EventNoteQuery,
  EventNoteQueryPath,
  EventNoteQueryResult,
  EventNoteRelation,
  EventNoteRelationView,
  EventMemoryGraphSnapshot,
} from '@infos/shared'
import type { TransactionOperation } from 'triviumdb'
import type { EmbeddingService } from '../embedding/embeddingService'
import type { ContextRnn } from '../retrieval/contextRnn'
import type { MemoryRuntimeConfig } from './memoryRuntimeConfig'
import type { MemoryStoreRegistry } from '../../repositories/storeRegistry'
import { EventNoteRepository, type StoredEventNote } from '../../repositories/eventNote.repo'
import { createLogger } from '../../lib/logger'
import { tokenCounter } from '../tokenizer/tokenCounter'

const logger = createLogger('EventMemoryService')
const SYMMETRIC_RELATIONS = new Set<EventNoteRelation>(['same_event', 'same_topic'])

interface TdbEventPayload extends EventNote {
  kind: 'event_note'
  operationId: string
}

interface TdbEntityPayload {
  kind: 'event_entity'
  id: string
  entityType: 'person' | 'place' | 'object'
  name: string
}

type TdbMemoryPayload = TdbEventPayload | TdbEntityPayload

interface CreateEventInput extends EventNoteDraftInput {
  agentId: string
  eventAt: string
  origin: EventNote['origin']
}

interface EventWriteOptions {
  coverageOwnerId?: string
  deferCoverage?: boolean
}

export interface AutomaticRagProgress {
  stage: 'embedding' | 'retrieval' | 'reranking' | 'timeline' | 'completed'
  status?: 'running' | 'completed' | 'failed'
  failureKind?: 'embedding' | 'rag'
  message: string
  candidateCount?: number
  resultCount?: number
}

export class AutomaticRagStageError extends Error {
  constructor(
    readonly failureKind: 'embedding' | 'rag',
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'AutomaticRagStageError'
  }
}

export interface AutomaticRagTrace {
  agentId: string
  channel: string
  query: string
  queryEmbedding: number[]
  notes: EventNote[]
  contextBias?: Float32Array
}

export class EventMemoryService {
  private nextTdbId?: number
  private onCommitted?: (note: EventNote) => void | Promise<void>
  private contextRnn?: ContextRnn
  private getRuntimeConfig?: () => Promise<MemoryRuntimeConfig>
  private automaticRagTraces = new Map<string, AutomaticRagTrace>()

  constructor(
    private repo: EventNoteRepository,
    private stores: MemoryStoreRegistry,
    private embeddings: EmbeddingService,
  ) {}

  setCommitListener(listener: (note: EventNote) => void | Promise<void>): void {
    this.onCommitted = listener
  }

  setAdvancedRetrieval(
    contextRnn: ContextRnn,
    getRuntimeConfig: () => Promise<MemoryRuntimeConfig>,
  ): void {
    this.contextRnn = contextRnn
    this.getRuntimeConfig = getRuntimeConfig
  }

  takeAutomaticRagTrace(traceId: string): AutomaticRagTrace | undefined {
    const trace = this.automaticRagTraces.get(traceId)
    this.automaticRagTraces.delete(traceId)
    return trace
  }

  async applyRetrievalFeedback(traceId: string, reply: string): Promise<void> {
    const trace = this.takeAutomaticRagTrace(traceId)
    if (!trace || !this.contextRnn || !this.getRuntimeConfig) return
    const { agentId, channel } = trace
    const config = await this.getRuntimeConfig()
    if (!config.advanced.enableSaPpr || !config.advanced.enableFeedback) return
    const normalizedReply = reply.toLocaleLowerCase()
    const positive = trace.notes.some((note) => {
      const terms = [...note.topics, ...note.participants]
        .map((term) => term.trim().toLocaleLowerCase())
        .filter((term) => term.length >= 2)
      return terms.some((term) => normalizedReply.includes(term))
    })
    this.contextRnn.trainMinGru(agentId, channel, new Float32Array(trace.queryEmbedding), positive)
    if (trace.contextBias && trace.notes[0]) {
      const target = await this.safeVector(trace.notes[0].narrative)
      this.contextRnn.updateOutputWeights(
        this.contextRnn.getHiddenState(agentId, channel),
        trace.contextBias,
        new Float32Array(target),
        positive,
      )
    }
    this.contextRnn.save(agentId, channel)
  }

  async create(
    input: CreateEventInput,
    operationId: string = randomUUID(),
    options: EventWriteOptions = {},
  ): Promise<EventNote> {
    const existing = await this.repo.findOperation(operationId)
    if (existing?.operation === 'create') {
      const payload = existing.payload as { note: EventNote; tdbId: number }
      await this.applyCreate(operationId, payload.note, payload.tdbId)
      if (options.coverageOwnerId) await this.commitCoverage(payload.note, options, input.origin)
      return payload.note
    }
    this.validateDraft(input)
    const note: EventNote = {
      id: randomUUID(),
      agentId: input.agentId,
      narrative: input.narrative.trim(),
      eventAt: input.eventAt,
      createdAt: new Date().toISOString(),
      importance: input.importance,
      affect: input.affect,
      participants: input.participants ?? [],
      places: input.places ?? [],
      objects: input.objects ?? [],
      topics: input.topics ?? [],
      origin: input.origin,
      status: 'active',
    }
    const tdbId = await this.allocateTdbId()
    await this.repo.prepareCreate(operationId, note, tdbId)
    await this.applyCreate(operationId, note, tdbId)
    if (!options.deferCoverage) {
      const coverage = this.coverageFor([note], note.origin.mode)
      if (options.coverageOwnerId) {
        await this.repo.commitCoverageUnderClaim(coverage, options.coverageOwnerId)
      } else {
        await this.repo.saveCoverage(coverage)
      }
    }
    if (note.origin.mode === 'active') await this.repo.resetTimer(`agent-silence:${note.agentId}`)
    await this.onCommitted?.(note)
    return note
  }

  async revise(
    targetId: string,
    input: CreateEventInput,
    operationId: string = randomUUID(),
    options: EventWriteOptions = {},
  ): Promise<EventNote> {
    const existing = await this.repo.findOperation(operationId)
    if (existing?.operation === 'revise') {
      const payload = existing.payload as {
        target: StoredEventNote
        replacement: EventNote
        newTdbId: number
        relations: EventNoteRelationView[]
      }
      await this.applyRevise(
        operationId,
        payload.target,
        payload.replacement,
        payload.newTdbId,
        payload.relations,
      )
      if (options.coverageOwnerId)
        await this.commitCoverage(payload.replacement, options, input.origin)
      return payload.replacement
    }
    this.validateDraft(input)
    const target = await this.repo.findById(targetId)
    if (!target || target.replacedBy) throw new Error('目标事件不存在或已被修订')
    if (target.agentId !== input.agentId) throw new Error('不能修订其他 Agent 的事件')

    const replacement: EventNote = {
      id: randomUUID(),
      agentId: target.agentId,
      narrative: input.narrative.trim(),
      eventAt: target.eventAt,
      createdAt: new Date().toISOString(),
      importance: input.importance,
      affect: input.affect,
      participants: input.participants ?? target.participants,
      places: input.places ?? target.places,
      objects: input.objects ?? target.objects,
      topics: input.topics ?? target.topics,
      origin: {
        ...target.origin,
        pairIds: [...new Set([...target.origin.pairIds, ...input.origin.pairIds])],
        messageIds: [...new Set([...target.origin.messageIds, ...input.origin.messageIds])],
      },
      status: 'active',
    }
    const newTdbId = await this.allocateTdbId()
    const relations = await this.repo.listRelations(targetId)
    await this.repo.prepareRevise(operationId, target, replacement, newTdbId, relations)
    await this.applyRevise(operationId, target, replacement, newTdbId, relations)
    await this.commitCoverage(replacement, options, input.origin)
    await this.repo.resetTimer(`agent-silence:${replacement.agentId}`)
    await this.onCommitted?.(replacement)
    return replacement
  }

  async archive(id: string, operationId: string = randomUUID()): Promise<void> {
    const note = await this.repo.findById(id)
    if (!note) throw new Error('事件不存在')
    if (note.status === 'archived') return
    const inserted = await this.repo.createOperation(operationId, note.agentId, 'archive', {
      id,
      tdbId: note.tdbId,
    })
    if (inserted) await this.repo.archive(id)
    const store = this.stores.getAgentStore(note.agentId, 'main')
    const node = store.get<TdbEventPayload>(note.tdbId)
    if (node) store.updatePayload(note.tdbId, { ...node.payload, status: 'archived', operationId })
    await this.repo.markOperationCommitted(operationId)
  }

  async addRelation(
    sourceId: string,
    targetId: string,
    relation: EventNoteRelation,
    weight = 1,
    operationId: string = randomUUID(),
  ): Promise<void> {
    const source = await this.requireCurrent(sourceId)
    const target = await this.requireCurrent(targetId)
    if (source.agentId !== target.agentId) throw new Error('不能跨 Agent 建立事件关系')
    let src = source
    let dst = target
    if (SYMMETRIC_RELATIONS.has(relation) && source.id > target.id) [src, dst] = [target, source]
    const relationView = { sourceId: src.id, targetId: dst.id, relation, weight }
    const inserted = await this.repo.createOperation(operationId, src.agentId, 'link', relationView)
    if (inserted) await this.repo.addRelation(relationView)
    this.stores
      .getAgentStore(src.agentId, 'main')
      .upsertEdge(src.tdbId, dst.tdbId, relation, weight, { operationId })
    await this.repo.markOperationCommitted(operationId)
  }

  async removeRelation(
    sourceId: string,
    targetId: string,
    relation: EventNoteRelation,
    operationId: string = randomUUID(),
  ): Promise<void> {
    const source = await this.requireCurrent(sourceId)
    const target = await this.requireCurrent(targetId)
    let src = source
    let dst = target
    if (SYMMETRIC_RELATIONS.has(relation) && source.id > target.id) [src, dst] = [target, source]
    const inserted = await this.repo.createOperation(operationId, src.agentId, 'unlink', {
      sourceId: src.id,
      targetId: dst.id,
      relation,
    })
    if (inserted) await this.repo.removeRelation(src.id, dst.id, relation)
    this.stores.getAgentStore(src.agentId, 'main').unlink(src.tdbId, dst.tdbId, relation)
    await this.repo.markOperationCommitted(operationId)
  }

  /**
   * 核心记忆档案查询：关键词组合过滤 + 排序 + 分页 + facet 聚合。
   *
   * TDB 是运行时查询权威；这里在内存中对全量 EventNote 过滤，
   * 不触发 Embedding / 语义检索（语义 RAG 属于对话链路，不是档案浏览）。
   */
  async archiveQuery(filter: EventNoteArchiveFilter): Promise<EventNoteArchiveResult> {
    const agentIds = filter.agentIds?.length ? filter.agentIds : [filter.agentId]
    const all = agentIds.flatMap((agentId) => this.listTdbNotes(agentId))
    const stats = this.buildArchiveStats(all)

    const needle = filter.query?.trim().toLocaleLowerCase()
    const channels = filter.channels?.length ? new Set(filter.channels) : null
    const statuses = filter.statuses?.length ? new Set(filter.statuses) : null
    const modes = filter.modes?.length ? new Set(filter.modes) : null
    const tones = filter.tones?.length ? filter.tones.map((tone) => tone.toLocaleLowerCase()) : null
    const participants = filter.participants?.length
      ? filter.participants.map((value) => value.toLocaleLowerCase())
      : null
    const places = filter.places?.length
      ? filter.places.map((value) => value.toLocaleLowerCase())
      : null
    const objects = filter.objects?.length
      ? filter.objects.map((value) => value.toLocaleLowerCase())
      : null
    const topics = filter.topics?.length
      ? filter.topics.map((value) => value.toLocaleLowerCase())
      : null

    const filtered = all.filter((note) => {
      if (statuses && !statuses.has(note.status)) return false
      if (modes && !modes.has(note.origin.mode)) return false
      if (channels && !channels.has(note.origin.channel)) return false
      if (filter.importanceMin !== undefined && note.importance < filter.importanceMin) return false
      if (filter.importanceMax !== undefined && note.importance > filter.importanceMax) return false
      if (filter.eventAtFrom && note.eventAt < filter.eventAtFrom) return false
      if (filter.eventAtTo && note.eventAt > filter.eventAtTo) return false
      if (filter.createdAtFrom && note.createdAt < filter.createdAtFrom) return false
      if (filter.createdAtTo && note.createdAt > filter.createdAtTo) return false
      if (tones && !note.affect.tones.some((tone) => tones.includes(tone.toLocaleLowerCase()))) {
        return false
      }
      if (
        participants &&
        !participants.some((name) =>
          note.participants.some((value) => value.toLocaleLowerCase().includes(name)),
        )
      )
        return false
      if (
        places &&
        !places.some((name) =>
          note.places.some((value) => value.toLocaleLowerCase().includes(name)),
        )
      )
        return false
      if (
        objects &&
        !objects.some((name) =>
          note.objects.some((value) => value.toLocaleLowerCase().includes(name)),
        )
      )
        return false
      if (
        topics &&
        !topics.some((name) =>
          note.topics.some((value) => value.toLocaleLowerCase().includes(name)),
        )
      )
        return false
      if (needle) {
        const haystack = [
          note.narrative,
          ...note.topics,
          ...note.participants,
          ...note.places,
          ...note.objects,
        ]
        if (!haystack.some((value) => value.toLocaleLowerCase().includes(needle))) return false
      }
      return true
    })

    const sortKey = filter.sort ?? 'eventAt'
    const direction = filter.order === 'asc' ? 1 : -1
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === 'importance') {
        return (a.importance - b.importance) * direction || b.eventAt.localeCompare(a.eventAt)
      }
      if (sortKey === 'createdAt') {
        return a.createdAt.localeCompare(b.createdAt) * direction || a.id.localeCompare(b.id)
      }
      return a.eventAt.localeCompare(b.eventAt) * direction || a.id.localeCompare(b.id)
    })

    const page = Math.max(1, filter.page ?? 1)
    const pageSize = Math.max(1, Math.min(filter.pageSize ?? 30, 100))
    const total = sorted.length
    const pageCount = Math.max(1, Math.ceil(total / pageSize))
    const safePage = Math.min(page, pageCount)
    const items = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

    return {
      items,
      page: safePage,
      pageSize,
      total,
      pageCount,
      facets: this.buildArchiveFacets(filtered),
      stats,
    }
  }

  /**
   * 记忆图谱快照：直接从 TDB 批量读取节点与边，替代旧的逐节点 detail 调用。
   *
   * 旧实现对每个节点调用 detail()，每次 detail 又会从 SQLite 拉取全量时间轴
   * 定位前后事件，属于重量级 N+1；本方法纯内存读取，一次完成。
   */
  graphSnapshot(
    agentId: string,
    options?: { includeArchived?: boolean; limit?: number },
  ): EventMemoryGraphSnapshot {
    const limit = Math.max(1, Math.min(options?.limit ?? 300, 1000))
    const store = this.stores.getAgentStore(agentId, 'main')
    const tdbIdToNoteId = new Map<number, string>()
    const noteIdToTdbId = new Map<string, number>()
    const nodes: EventNote[] = []
    for (const id of store.allNodeIds()) {
      const payload = store.get<TdbEventPayload>(id)?.payload
      if (payload?.kind !== 'event_note') continue
      const note = payload as EventNote
      if (!options?.includeArchived && note.status === 'archived') continue
      tdbIdToNoteId.set(id, note.id)
      noteIdToTdbId.set(note.id, id)
      nodes.push(note)
    }
    nodes.sort((a, b) => a.eventAt.localeCompare(b.eventAt) || a.id.localeCompare(b.id))
    const truncated = nodes.length > limit
    const visible = truncated ? nodes.slice(-limit) : nodes
    const visibleIds = new Set(visible.map((note) => note.id))

    const edges: EventNoteRelationView[] = []
    const seen = new Set<string>()
    for (const note of visible) {
      const tdbId = noteIdToTdbId.get(note.id)
      if (tdbId === undefined) continue
      for (const edge of store.getEdges(tdbId)) {
        const targetNoteId = tdbIdToNoteId.get(edge.targetId)
        if (!targetNoteId || !visibleIds.has(targetNoteId)) continue
        const key = `${note.id}:${edge.label}:${targetNoteId}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({
          sourceId: note.id,
          targetId: targetNoteId,
          relation: edge.label as EventNoteRelation,
          weight: edge.weight,
        })
      }
    }
    return { nodes: visible, edges, truncated }
  }

  private buildArchiveStats(all: EventNote[]): EventNoteArchiveResult['stats'] {
    let active = 0
    let archived = 0
    let importanceSum = 0
    const topics = new Set<string>()
    for (const note of all) {
      if (note.status === 'archived') archived++
      else active++
      importanceSum += note.importance
      for (const topic of note.topics) topics.add(topic)
    }
    return {
      active,
      archived,
      averageImportance: all.length ? Math.round((importanceSum / all.length) * 10) / 10 : 0,
      topicCount: topics.size,
    }
  }

  private buildArchiveFacets(filtered: EventNote[]): EventNoteArchiveResult['facets'] {
    const counter = () => {
      const map = new Map<string, number>()
      return {
        add(value: string) {
          if (!value) return
          map.set(value, (map.get(value) ?? 0) + 1)
        },
        list: () =>
          [...map.entries()]
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh-CN')),
      }
    }
    const channels = counter()
    const statuses = counter()
    const modes = counter()
    const tones = counter()
    const participants = counter()
    const places = counter()
    const objects = counter()
    const topics = counter()
    for (const note of filtered) {
      channels.add(note.origin.channel)
      statuses.add(note.status)
      modes.add(note.origin.mode)
      for (const tone of note.affect.tones) tones.add(tone)
      for (const name of note.participants) participants.add(name)
      for (const name of note.places) places.add(name)
      for (const name of note.objects) objects.add(name)
      for (const name of note.topics) topics.add(name)
    }
    return {
      channels: channels.list(),
      statuses: statuses.list(),
      modes: modes.list(),
      tones: tones.list().slice(0, 40),
      participants: participants.list().slice(0, 60),
      places: places.list().slice(0, 60),
      objects: objects.list().slice(0, 60),
      topics: topics.list().slice(0, 80),
    }
  }

  async query(input: EventNoteQuery): Promise<EventNote[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 10, 100))
    const all = this.listTdbNotes(input.agentId).filter(
      (note) => input.includeArchived || note.status === 'active',
    )
    if (!input.query || input.mode === 'recent' || input.mode === 'time_range') {
      return all
        .filter(
          (note) =>
            (!input.from || note.eventAt >= input.from) && (!input.to || note.eventAt <= input.to),
        )
        .sort((a, b) => b.eventAt.localeCompare(a.eventAt) || b.id.localeCompare(a.id))
        .slice(0, limit)
    }
    if (input.mode === 'entity') {
      const needle = input.query.toLocaleLowerCase()
      return all
        .filter((note) =>
          [...note.participants, ...note.places, ...note.objects, ...note.topics].some((value) =>
            value.toLocaleLowerCase().includes(needle),
          ),
        )
        .slice(0, limit)
    }
    if (input.mode === 'affective') {
      const needle = input.query.toLocaleLowerCase()
      return all
        .filter((note) =>
          note.affect.tones.some((tone) => tone.toLocaleLowerCase().includes(needle)),
        )
        .slice(0, limit)
    }
    const vector = await this.safeVector(input.query)
    const store = this.stores.ensureTextIndexReady(input.agentId, 'desktop')
    const hits =
      input.mode === 'semantic'
        ? store.search(vector, limit * 3, 0, -1)
        : store.searchHybrid(vector, input.query, limit * 3, 0, -1)
    const notes = hits
      .flatMap((hit) => {
        const node = store.get<TdbEventPayload>(hit.id)
        return node?.payload?.kind === 'event_note' ? [node.payload as EventNote] : []
      })
      .filter((note) => input.includeArchived || note.status === 'active')
    if (input.mode !== 'same_event' && input.mode !== 'logical') return notes.slice(0, limit)
    const relation = input.mode === 'same_event' ? 'same_event' : 'caused_by'
    const expanded = [...notes]
    for (const note of notes) {
      const node = this.findTdbNode(input.agentId, note.id)
      if (!node) continue
      const relatedIds = [
        ...store
          .getEdges(node.id)
          .filter((edge) => edge.label === relation)
          .map((edge) => edge.targetId),
        ...store
          .getIncomingEdges(node.id)
          .filter((edge) => edge.label === relation)
          .map((edge) => edge.sourceId),
      ]
      for (const id of relatedIds) {
        const related = store.get<TdbEventPayload>(id)?.payload
        if (
          related?.kind === 'event_note' &&
          (input.includeArchived || related.status === 'active')
        )
          expanded.push(related)
      }
    }
    return [...new Map(expanded.map((note) => [note.id, note])).values()].slice(0, limit)
  }

  async queryDetailed(input: EventNoteQuery): Promise<EventNoteQueryResult> {
    const maxDepth = Math.max(0, Math.min(input.maxDepth ?? 2, 6))
    const maxNodes = Math.max(1, Math.min(input.maxNodes ?? input.limit ?? 20, 100))
    const maxReturnTokens = Math.max(1, Math.min(input.maxReturnTokens ?? 4_000, 32_000))
    const direction = input.direction ?? 'both'
    const labels = new Set<EventNoteRelation>(
      input.edgeLabels ?? [
        'temporal_next',
        'temporal_prev',
        'caused_by',
        'same_event',
        'same_topic',
        'involves_person',
        'involves_place',
        'involves_object',
      ],
    )
    const anchorLimit = Math.max(1, Math.min(input.limit ?? 10, maxNodes))
    const anchors = await this.query({ ...input, limit: anchorLimit })
    const store = this.stores.getAgentStore(input.agentId, 'main')
    const payloadByTdbId = new Map<number, TdbMemoryPayload>()
    const tdbIdByNoteId = new Map<string, number>()
    for (const id of store.allNodeIds()) {
      const payload = store.get<TdbMemoryPayload>(id)?.payload
      if (payload?.kind !== 'event_note' && payload?.kind !== 'event_entity') continue
      payloadByTdbId.set(id, payload)
      if (payload.kind === 'event_note') tdbIdByNoteId.set(payload.id, id)
    }

    const paths = new Map<number, EventNoteQueryPath['edges']>()
    const queue: Array<{ id: number; depth: number }> = []
    for (const anchor of anchors) {
      const id = tdbIdByNoteId.get(anchor.id)
      if (id === undefined || paths.has(id)) continue
      paths.set(id, [])
      queue.push({ id, depth: 0 })
    }
    let graphTruncated = false
    while (queue.length) {
      const current = queue.shift()!
      if (current.depth >= maxDepth) continue
      const outgoing =
        direction === 'incoming'
          ? []
          : store.getEdges(current.id).map((edge) => ({
              from: current.id,
              to: edge.targetId,
              label: edge.label,
              weight: edge.weight,
            }))
      const incoming =
        direction === 'outgoing'
          ? []
          : store.getIncomingEdges(current.id).map((edge) => ({
              from: edge.sourceId,
              to: current.id,
              label: edge.label,
              weight: edge.weight,
            }))
      for (const edge of [...outgoing, ...incoming]) {
        if (!labels.has(edge.label as EventNoteRelation)) continue
        const neighborId = edge.from === current.id ? edge.to : edge.from
        const neighbor = payloadByTdbId.get(neighborId)
        if (!neighbor) continue
        if (
          neighbor.kind === 'event_note' &&
          !input.includeArchived &&
          neighbor.status === 'archived'
        )
          continue
        if (paths.has(neighborId)) continue
        if (paths.size >= maxNodes) {
          graphTruncated = true
          continue
        }
        const source = payloadByTdbId.get(edge.from)
        const target = payloadByTdbId.get(edge.to)
        if (!source || !target) continue
        const path = [
          ...(paths.get(current.id) ?? []),
          {
            sourceId: source.id,
            targetId: target.id,
            fromEventId: source.id,
            toEventId: target.id,
            fromKind: source.kind,
            toKind: target.kind,
            relation: edge.label as EventNoteRelation,
            weight: edge.weight,
          },
        ]
        paths.set(neighborId, path)
        queue.push({ id: neighborId, depth: current.depth + 1 })
      }
    }

    const notes: EventNote[] = []
    const entities: Array<{ id: string; entityType: 'person' | 'place' | 'object'; name: string }> =
      []
    const resultPaths: EventNoteQueryPath[] = []
    let returnedTokens = 0
    let tokenTruncated = false
    for (const [id, path] of paths) {
      const payload = payloadByTdbId.get(id)
      if (!payload) continue
      const serialized = JSON.stringify({ payload, path })
      const tokens = tokenCounter.countTokens(serialized)
      if (returnedTokens + tokens > maxReturnTokens) {
        tokenTruncated = true
        break
      }
      if (payload.kind === 'event_note') notes.push(payload)
      else entities.push({ id: payload.id, entityType: payload.entityType, name: payload.name })
      resultPaths.push({ targetId: payload.id, edges: path })
      returnedTokens += tokens
    }
    const result: EventNoteQueryResult = {
      notes,
      entities,
      paths: resultPaths,
      truncated: graphTruncated || tokenTruncated,
      returnedTokens,
    }
    await this.repo.recordQueryAudit({
      id: randomUUID(),
      agentId: input.agentId,
      mode: input.mode ?? 'mixed',
      query: input,
      resultCount: notes.length + entities.length,
      returnedTokens,
      truncated: result.truncated,
      queriedAt: new Date().toISOString(),
    })
    return result
  }

  async automaticRag(
    agentId: string,
    query: string,
    topK = 10,
    channel = 'desktop',
    traceId?: string,
    onProgress?: (progress: AutomaticRagProgress) => void | Promise<void>,
  ): Promise<EventNote[]> {
    const timeline = this.listTdbNotes(agentId)
      .filter((note) => note.status === 'active')
      .sort((a, b) => a.eventAt.localeCompare(b.eventAt) || a.id.localeCompare(b.id))
    const latest = timeline.at(-1)
    const config = this.getRuntimeConfig ? await this.getRuntimeConfig() : undefined
    const advanced = config?.advanced
    let queryEmbedding: number[] = []
    let contextBias: Float32Array | undefined
    let hits: EventNote[]

    if (advanced?.enableSaPpr) {
      await onProgress?.({ stage: 'embedding', message: '正在生成记忆检索向量' })
      queryEmbedding = await this.safeVector(query)
      if (advanced.enableContextRnn && this.contextRnn) {
        this.contextRnn.update(agentId, channel, queryEmbedding)
        contextBias = this.contextRnn.generateBias(agentId, channel)
      }
      const store = this.stores.ensureTextIndexReady(agentId, channel)
      await onProgress?.({
        stage: 'retrieval',
        message: `正在执行 SA-PPR Top-${topK} 候选召回`,
      })
      const advancedHits = store.searchAdvanced(queryEmbedding, {
        topK: Math.max(topK * 3, topK),
        expandDepth: advanced.expandDepth,
        minScore: advanced.minScore,
        teleportAlpha: advanced.teleportAlpha,
        enableAdvancedPipeline: true,
        enableSparseResidual: advanced.enableFista,
        enableDpp: advanced.enableDpp,
        enableTextHybridSearch: true,
        customQueryText: query,
        diffusionBias: contextBias ? Array.from(contextBias) : undefined,
      })
      const rerankers = [
        advanced.enableContextRnn ? 'ContextRNN' : '',
        advanced.enableLeiden ? 'Leiden' : '',
        advanced.enableDpp ? 'DPP' : '',
      ].filter(Boolean)
      await onProgress?.({
        stage: 'reranking',
        message: rerankers.length
          ? `正在使用 ${rerankers.join(' + ')} 重排 ${advancedHits.length} 个候选`
          : `正在筛选 ${advancedHits.length} 个候选`,
        candidateCount: advancedHits.length,
      })
      const clusterBonus = advanced.enableLeiden
        ? this.leidenClusterBonus(store, contextBias ?? new Float32Array(queryEmbedding))
        : new Map<number, number>()
      hits = advancedHits
        .sort(
          (a, b) =>
            b.score + (clusterBonus.get(b.id) ?? 0) - (a.score + (clusterBonus.get(a.id) ?? 0)),
        )
        .flatMap((hit) => {
          const payload = store.get<TdbEventPayload>(hit.id)?.payload
          return payload?.kind === 'event_note' && payload.status === 'active'
            ? [payload as EventNote]
            : []
        })
        .slice(0, topK)
    } else {
      await onProgress?.({ stage: 'embedding', message: '正在生成记忆检索向量' })
      await onProgress?.({
        stage: 'retrieval',
        message: `正在执行向量 + BM25 Top-${topK} 混合召回`,
      })
      hits = await this.query({ agentId, query, mode: 'mixed', limit: topK })
      await onProgress?.({
        stage: 'reranking',
        message: `基础召回已筛选出 ${hits.length} 个相关事件`,
        candidateCount: hits.length,
      })
    }

    await onProgress?.({
      stage: 'timeline',
      message: '正在补充时间轴末尾与命中事件直接前驱',
      candidateCount: hits.length,
    })
    const index = new Map(timeline.map((note, i) => [note.id, i]))
    const result: EventNote[] = []
    if (latest) result.push(latest)
    for (const hit of hits) {
      result.push(hit)
      const position = index.get(hit.id)
      if (position !== undefined && position > 0) result.push(timeline[position - 1]!)
    }
    const notes = [...new Map(result.map((note) => [note.id, note])).values()]
    if (advanced?.enableSaPpr && advanced.enableFeedback && traceId) {
      this.automaticRagTraces.set(traceId, {
        agentId,
        channel,
        query,
        queryEmbedding,
        notes: hits,
        contextBias,
      })
    }
    await onProgress?.({
      stage: 'completed',
      message: `记忆上下文已就绪，共注入 ${notes.length} 个事件`,
      candidateCount: hits.length,
      resultCount: notes.length,
    })
    return notes
  }

  private leidenClusterBonus(
    store: ReturnType<MemoryStoreRegistry['getAgentStore']>,
    direction: Float32Array,
  ): Map<number, number> {
    const clusters = store.leidenCluster({ withCentroids: true })
    if (!clusters.centroids.length) return new Map()
    const dimension = this.stores.getDimension()
    const centroids = new Map<number, Float32Array>()
    for (let offset = 0; offset < clusters.centroids.length; offset += dimension + 1) {
      const clusterId = clusters.centroids[offset]
      if (clusterId === undefined) break
      centroids.set(
        clusterId,
        new Float32Array(clusters.centroids.slice(offset + 1, offset + 1 + dimension)),
      )
    }
    const scores = new Map<number, number>()
    let maxScore = Number.NEGATIVE_INFINITY
    for (const [clusterId, centroid] of centroids) {
      let score = 0
      const length = Math.min(direction.length, centroid.length)
      for (let index = 0; index < length; index++) {
        score += direction[index]! * centroid[index]!
      }
      scores.set(clusterId, score)
      maxScore = Math.max(maxScore, score)
    }
    let scoreSum = 0
    for (const [clusterId, score] of scores) {
      const normalized = Math.exp(score - maxScore)
      scores.set(clusterId, normalized)
      scoreSum += normalized
    }
    const bonus = new Map<number, number>()
    for (let offset = 0; offset < clusters.nodeToCluster.length; offset += 2) {
      const nodeId = clusters.nodeToCluster[offset]
      const clusterId = clusters.nodeToCluster[offset + 1]
      if (nodeId !== undefined && clusterId !== undefined) {
        bonus.set(nodeId, scoreSum > 0 ? (scores.get(clusterId) ?? 0) / scoreSum : 0)
      }
    }
    return bonus
  }

  async detail(id: string): Promise<EventNoteDetail | undefined> {
    const note = await this.repo.findById(id)
    if (!note || note.replacedBy) return undefined
    const timeline = await this.repo.list(note.agentId, {
      includeArchived: true,
      ascending: true,
      limit: 10_000,
    })
    const position = timeline.findIndex((item) => item.id === id)
    return {
      ...note,
      previous: position > 0 ? timeline[position - 1] : undefined,
      next: position >= 0 ? timeline[position + 1] : undefined,
      relations: await this.repo.listRelations(id),
    }
  }

  async replayPending(): Promise<void> {
    for (const operation of await this.repo.pendingOperations()) {
      try {
        if (operation.operation === 'create') {
          const payload = operation.payload as { note: EventNote; tdbId: number }
          await this.applyCreate(operation.operationId, payload.note, payload.tdbId)
        } else if (operation.operation === 'revise') {
          const payload = operation.payload as {
            target: StoredEventNote
            replacement: EventNote
            newTdbId: number
            relations: EventNoteRelationView[]
          }
          await this.applyRevise(
            operation.operationId,
            payload.target,
            payload.replacement,
            payload.newTdbId,
            payload.relations,
          )
        }
      } catch (error) {
        await this.repo.markOperationFailed(operation.operationId, String(error))
        logger.warn(`事件记忆事务重放失败: ${operation.operationId}`, { error })
      }
    }
  }

  async rebuildAgentStore(agentId: string): Promise<void> {
    this.stores.resetAgentStore(agentId, 'main')
    const notes = await this.repo.list(agentId, {
      includeArchived: true,
      ascending: true,
      limit: 100_000,
    })
    const store = this.stores.getAgentStore(agentId, 'main')
    const insertOperations: TransactionOperation[] = []
    for (const note of notes) {
      insertOperations.push({
        type: 'insertWithId',
        id: note.tdbId,
        vector: await this.safeVector(note.narrative),
        payload: { ...note, kind: 'event_note', operationId: `rebuild:${note.id}` },
      })
    }
    if (insertOperations.length) store.commitTransaction(insertOperations)
    const edgeOperations: TransactionOperation[] = []
    for (let index = 1; index < notes.length; index++) {
      const previous = notes[index - 1]!
      const current = notes[index]!
      edgeOperations.push(
        {
          type: 'upsertEdge',
          src: previous.tdbId,
          dst: current.tdbId,
          label: 'temporal_next',
          weight: 1,
        },
        {
          type: 'upsertEdge',
          src: current.tdbId,
          dst: previous.tdbId,
          label: 'temporal_prev',
          weight: 1,
        },
      )
    }
    for (const note of notes) {
      store.indexText(note.tdbId, note.narrative)
      await this.ensureEntityRelations(note, note.tdbId)
      for (const relation of await this.repo.listRelations(note.id)) {
        if (relation.sourceId !== note.id) continue
        const target = await this.repo.findById(relation.targetId)
        if (target && !target.replacedBy)
          edgeOperations.push({
            type: 'upsertEdge',
            src: note.tdbId,
            dst: target.tdbId,
            label: relation.relation,
            weight: relation.weight,
          })
      }
    }
    if (edgeOperations.length) store.commitTransaction(edgeOperations)
    this.stores.markTextIndexDirty(this.stores.resolveAgentStorePath(agentId, 'main'))
  }

  private async applyCreate(
    operationId: string,
    note: EventNote,
    tdbId: number,
    markCommitted = true,
  ): Promise<void> {
    try {
      const store = this.stores.getAgentStore(note.agentId, 'main')
      const vector = await this.safeVector(note.narrative)
      const payload: TdbEventPayload = { ...note, kind: 'event_note', operationId }
      const timeline = await this.repo.list(note.agentId, {
        includeArchived: true,
        ascending: true,
        limit: 100_000,
      })
      const position = timeline.findIndex((item) => item.id === note.id)
      const previous = position > 0 ? timeline[position - 1] : undefined
      const next = position >= 0 ? timeline[position + 1] : undefined
      const operations: TransactionOperation[] = [
        { type: 'insertWithId', id: tdbId, vector, payload },
      ]
      if (previous)
        operations.push(
          {
            type: 'upsertEdge',
            src: previous.tdbId,
            dst: tdbId,
            label: 'temporal_next',
            weight: 1,
          },
          {
            type: 'upsertEdge',
            src: tdbId,
            dst: previous.tdbId,
            label: 'temporal_prev',
            weight: 1,
          },
        )
      if (next) {
        if (previous)
          operations.push(
            { type: 'unlinkLabel', src: previous.tdbId, dst: next.tdbId, label: 'temporal_next' },
            { type: 'unlinkLabel', src: next.tdbId, dst: previous.tdbId, label: 'temporal_prev' },
          )
        operations.push(
          { type: 'upsertEdge', src: tdbId, dst: next.tdbId, label: 'temporal_next', weight: 1 },
          { type: 'upsertEdge', src: next.tdbId, dst: tdbId, label: 'temporal_prev', weight: 1 },
        )
      }
      if (!store.contains(tdbId)) store.commitTransaction(operations)
      store.indexText(tdbId, note.narrative)
      await this.ensureEntityRelations(note, tdbId)
      this.stores.markTextIndexDirty(this.stores.resolveAgentStorePath(note.agentId, 'main'))
      if (markCommitted) await this.repo.markOperationCommitted(operationId)
    } catch (error) {
      await this.repo.markOperationFailed(operationId, String(error))
      throw error
    }
  }

  private async applyRevise(
    operationId: string,
    target: StoredEventNote,
    replacement: EventNote,
    newTdbId: number,
    relations: EventNoteRelationView[],
  ): Promise<void> {
    try {
      const store = this.stores.getAgentStore(target.agentId, 'main')
      if (!store.contains(newTdbId)) {
        const vector = await this.safeVector(replacement.narrative)
        const operations: TransactionOperation[] = [
          {
            type: 'insertWithId',
            id: newTdbId,
            vector,
            payload: { ...replacement, kind: 'event_note', operationId },
          },
        ]
        for (const edge of store.getIncomingEdges(target.tdbId))
          operations.push({
            type: 'upsertEdge',
            src: edge.sourceId,
            dst: newTdbId,
            label: edge.label,
            weight: edge.weight,
          })
        for (const edge of store.getEdges(target.tdbId))
          operations.push({
            type: 'upsertEdge',
            src: newTdbId,
            dst: edge.targetId,
            label: edge.label,
            weight: edge.weight,
          })
        operations.push({ type: 'delete', id: target.tdbId })
        store.commitTransaction(operations)
        store.indexText(newTdbId, replacement.narrative)
      }
      for (const relation of relations) {
        const sourceId = relation.sourceId === target.id ? replacement.id : relation.sourceId
        const targetId = relation.targetId === target.id ? replacement.id : relation.targetId
        await this.repo.removeRelation(relation.sourceId, relation.targetId, relation.relation)
        await this.repo.addRelation({ ...relation, sourceId, targetId })
      }
      await this.repo.markOperationCommitted(operationId)
    } catch (error) {
      await this.repo.markOperationFailed(operationId, String(error))
      throw error
    }
  }

  private async ensureEntityRelations(note: EventNote, noteTdbId: number): Promise<void> {
    const store = this.stores.getAgentStore(note.agentId, 'main')
    const groups = [
      ['person', 'involves_person', note.participants],
      ['place', 'involves_place', note.places],
      ['object', 'involves_object', note.objects],
    ] as const
    for (const [entityType, relation, values] of groups) {
      for (const name of [...new Set(values.map((value) => value.trim()).filter(Boolean))]) {
        const id = `entity:${entityType}:${name.toLocaleLowerCase()}`
        let entityTdbId = this.findEntityTdbId(store, id)
        if (entityTdbId === undefined) {
          entityTdbId = await this.allocateTdbId()
          while (store.contains(entityTdbId)) entityTdbId = await this.allocateTdbId()
          const payload: TdbEntityPayload = { kind: 'event_entity', id, entityType, name }
          store.insertWithId(entityTdbId, await this.safeVector(name), payload)
          store.indexText(entityTdbId, name)
        }
        store.upsertEdge(noteTdbId, entityTdbId, relation, 1)
      }
    }
  }

  private findEntityTdbId(
    store: ReturnType<MemoryStoreRegistry['getAgentStore']>,
    entityId: string,
  ): number | undefined {
    for (const id of store.allNodeIds()) {
      const payload = store.get<TdbMemoryPayload>(id)?.payload
      if (payload?.kind === 'event_entity' && payload.id === entityId) return id
    }
    return undefined
  }

  private async commitCoverage(
    note: EventNote,
    options: EventWriteOptions,
    coverageOrigin: EventNote['origin'] = note.origin,
  ): Promise<void> {
    if (options.deferCoverage) return
    const coverageNote = { ...note, origin: coverageOrigin }
    const coverage = this.coverageFor([coverageNote], coverageOrigin.mode)
    if (options.coverageOwnerId) {
      await this.repo.commitCoverageUnderClaim(coverage, options.coverageOwnerId)
    } else {
      await this.repo.saveCoverage(coverage)
    }
  }

  private coverageFor(notes: EventNote[], mode: EventNote['origin']['mode']): ConversationCoverage {
    const origin = notes[0]!.origin
    return {
      id: randomUUID(),
      agentId: notes[0]!.agentId,
      threadId: origin.threadId,
      pairIds: [...new Set(notes.flatMap((note) => note.origin.pairIds))],
      messageIds: [...new Set(notes.flatMap((note) => note.origin.messageIds))],
      outcome: 'event_recorded',
      eventNoteIds: notes.map((note) => note.id),
      mode,
      coveredAt: new Date().toISOString(),
    }
  }

  private async requireCurrent(id: string): Promise<StoredEventNote> {
    const note = await this.repo.findById(id)
    if (!note || note.replacedBy) throw new Error('事件不存在或已被修订')
    return note
  }

  private validateDraft(input: EventNoteDraftInput): void {
    if (!input.narrative?.trim()) throw new Error('事件记叙不能为空')
    for (const [name, value] of [
      ['importance', input.importance],
      ['valence', input.affect?.valence],
      ['arousal', input.affect?.arousal],
    ] as const) {
      if (!Number.isInteger(value) || value < 0 || value > 10)
        throw new Error(`${name} 必须是0到10的整数`)
    }
  }

  private async allocateTdbId(): Promise<number> {
    if (this.nextTdbId === undefined) this.nextTdbId = (await this.repo.maxTdbId()) + 1
    return this.nextTdbId++
  }

  private listTdbNotes(agentId: string): EventNote[] {
    const store = this.stores.getAgentStore(agentId, 'main')
    return store.allNodeIds().flatMap((id) => {
      const payload = store.get<TdbEventPayload>(id)?.payload
      return payload?.kind === 'event_note' ? [payload as EventNote] : []
    })
  }

  private findTdbNode(
    agentId: string,
    noteId: string,
  ): { id: number; note: EventNote } | undefined {
    const store = this.stores.getAgentStore(agentId, 'main')
    for (const id of store.allNodeIds()) {
      const payload = store.get<TdbEventPayload>(id)?.payload
      if (payload?.kind === 'event_note' && payload.id === noteId) return { id, note: payload }
    }
    return undefined
  }

  private async safeVector(text: string): Promise<number[]> {
    try {
      const vector = await this.embeddings.embedOne(text)
      return vector.length === this.stores.getDimension()
        ? vector
        : new Array(this.stores.getDimension()).fill(0)
    } catch (error) {
      throw new AutomaticRagStageError('embedding', error)
    }
  }
}
