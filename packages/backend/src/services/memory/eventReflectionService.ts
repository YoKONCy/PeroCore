import type { EventNote, EventNoteRelation } from '@infos/shared'
import type { EventMemoryService } from './eventMemoryService'
import type { EventNoteRepository } from '../../repositories/eventNote.repo'
import type { MemoryStoreRegistry } from '../../repositories/storeRegistry'

export interface ReflectionDecision {
  links: Array<{
    targetId: string
    relation: Extract<EventNoteRelation, 'caused_by' | 'same_event' | 'same_topic'>
    weight?: number
  }>
  removeLinks: Array<{
    targetId: string
    relation: Extract<EventNoteRelation, 'caused_by' | 'same_event' | 'same_topic'>
  }>
  archive: boolean
  revision?: Partial<
    Pick<
      EventNote,
      'narrative' | 'importance' | 'affect' | 'participants' | 'places' | 'objects' | 'topics'
    >
  >
  archiveOverlaps?: string[]
}

export interface EventReflectionModel {
  reflect(input: { event: EventNote; candidates: EventNote[] }): Promise<ReflectionDecision>
}

export interface EventReflectionOptions {
  temporalCandidates?: number
  entityTerms?: number
  entityCandidates?: number
  mixedCandidates?: number
  vectorCandidates?: number
  maxCandidates?: number
}

export class EventReflectionService {
  private running = false
  private readonly options: Required<EventReflectionOptions>

  constructor(
    private eventMemory: EventMemoryService,
    private stores: MemoryStoreRegistry,
    private model: EventReflectionModel,
    private repo: EventNoteRepository,
    options: EventReflectionOptions = {},
  ) {
    this.options = {
      temporalCandidates: options.temporalCandidates ?? 3,
      entityTerms: options.entityTerms ?? 10,
      entityCandidates: options.entityCandidates ?? 10,
      mixedCandidates: options.mixedCandidates ?? 10,
      vectorCandidates: options.vectorCandidates ?? 10,
      maxCandidates: options.maxCandidates ?? 24,
    }
  }

  async enqueue(agentId: string, eventId: string): Promise<void> {
    await this.repo.enqueueReflectionTask({
      id: `reflection:${agentId}:${eventId}`,
      agentId,
      eventId,
    })
  }

  async enqueueDailyBackfill(): Promise<number> {
    return this.repo.enqueueMissingReflectionTasks()
  }

  async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const tasks = await this.repo.pendingReflectionTasks()
      for (const task of tasks) {
        try {
          await this.reflect(task.agentId, task.eventId)
          await this.repo.completeReflectionTask(task.id)
        } catch (error) {
          await this.repo.failReflectionTask(task.id, String(error))
        }
      }
    } finally {
      this.running = false
    }
  }

  async reflect(agentId: string, eventId: string): Promise<void> {
    const event = await this.eventMemory.detail(eventId)
    if (!event || event.agentId !== agentId) return
    const candidates = await this.collectCandidates(event)
    const decision = await this.model.reflect({ event, candidates })
    const candidateIds = new Set(candidates.map((candidate) => candidate.id))
    let maintainedEvent: EventNote = event
    if (decision.revision) {
      maintainedEvent = await this.eventMemory.revise(
        event.id,
        {
          narrative: decision.revision.narrative ?? event.narrative,
          importance: decision.revision.importance ?? event.importance,
          affect: decision.revision.affect ?? event.affect,
          participants: decision.revision.participants ?? event.participants,
          places: decision.revision.places ?? event.places,
          objects: decision.revision.objects ?? event.objects,
          topics: decision.revision.topics ?? event.topics,
          agentId: event.agentId,
          eventAt: event.eventAt,
          origin: event.origin,
        },
        `reflection:revise:${event.id}`,
      )
    }
    for (const link of decision.removeLinks) {
      if (candidateIds.has(link.targetId)) {
        await this.eventMemory.removeRelation(
          maintainedEvent.id,
          link.targetId,
          link.relation,
          `reflection:unlink:${maintainedEvent.id}:${link.relation}:${link.targetId}`,
        )
      }
    }
    for (const link of decision.links) {
      if (candidateIds.has(link.targetId) && link.targetId !== maintainedEvent.id) {
        await this.eventMemory.addRelation(
          maintainedEvent.id,
          link.targetId,
          link.relation,
          link.weight ?? 1,
          `reflection:link:${maintainedEvent.id}:${link.relation}:${link.targetId}`,
        )
      }
    }
    for (const targetId of new Set(decision.archiveOverlaps ?? [])) {
      if (!candidateIds.has(targetId)) continue
      await this.eventMemory.addRelation(
        maintainedEvent.id,
        targetId,
        'same_event',
        1,
        `reflection:overlap-link:${maintainedEvent.id}:${targetId}`,
      )
      await this.eventMemory.archive(
        targetId,
        `reflection:overlap-archive:${maintainedEvent.id}:${targetId}`,
      )
    }
    if (decision.archive)
      await this.eventMemory.archive(maintainedEvent.id, `reflection:archive:${maintainedEvent.id}`)
  }

  validateAndRepair(agentId: string): { valid: boolean; repaired: boolean } {
    const store = this.stores.getAgentStore(agentId, 'main')
    const report = store.validateGraph()
    if (report.valid) return { valid: true, repaired: false }
    store.repairGraphIndexes()
    return { valid: store.validateGraph().valid, repaired: true }
  }

  private async collectCandidates(event: EventNote): Promise<EventNote[]> {
    const timeline = await this.eventMemory.query({
      agentId: event.agentId,
      mode: 'recent',
      includeArchived: true,
      limit: 100,
    })
    const ordered = [...timeline].sort(
      (a, b) => a.eventAt.localeCompare(b.eventAt) || a.id.localeCompare(b.id),
    )
    const position = ordered.findIndex((note) => note.id === event.id)
    const temporalCount = this.options.temporalCandidates
    const before = Math.floor(temporalCount / 2)
    const temporal =
      position < 0
        ? []
        : ordered.slice(
            Math.max(0, position - before),
            Math.min(ordered.length, position + 1 + (temporalCount - before)),
          )
    const entityTerms = [...event.participants, ...event.places, ...event.objects, ...event.topics]
    const entityGroups = await Promise.all(
      entityTerms.slice(0, this.options.entityTerms).map((query) =>
        this.eventMemory.query({
          agentId: event.agentId,
          query,
          mode: 'entity',
          includeArchived: true,
          limit: this.options.entityCandidates,
        }),
      ),
    )
    const mixed = await this.eventMemory.query({
      agentId: event.agentId,
      query: event.narrative,
      mode: 'mixed',
      includeArchived: true,
      limit: this.options.mixedCandidates,
    })
    const vector = await this.eventMemory.query({
      agentId: event.agentId,
      query: event.narrative,
      mode: 'semantic',
      includeArchived: true,
      limit: this.options.vectorCandidates,
    })
    const merged = [...temporal, ...entityGroups.flat(), ...mixed, ...vector]
    return [
      ...new Map(
        merged.filter((note) => note.id !== event.id).map((note) => [note.id, note]),
      ).values(),
    ].slice(0, this.options.maxCandidates)
  }
}
