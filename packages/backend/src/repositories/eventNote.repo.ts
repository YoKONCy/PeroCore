import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type {
  ConversationCoverage,
  EventNote,
  EventNoteRelation,
  EventNoteRelationView,
} from '@infos/shared'
import type { DrizzleDb } from '../database'
import {
  eventMemoryCoverageClaims,
  eventMemoryDailyNoteTasks,
  eventMemoryOperations,
  eventMemoryQueryAudits,
  eventMemoryReflectionTasks,
  eventMemoryRelations,
  eventMemoryTimers,
  eventNoteCoverages,
  eventNotes,
} from '../database/schema'

const parse = <T>(value: string): T => JSON.parse(value) as T

type EventNoteRow = typeof eventNotes.$inferSelect

function toEventNote(row: EventNoteRow): EventNote {
  return {
    id: row.id,
    agentId: row.agentId,
    narrative: row.narrative,
    eventAt: row.eventAt,
    createdAt: row.createdAt,
    importance: row.importance,
    affect: parse(row.affectJson),
    participants: parse(row.participantsJson),
    places: parse(row.placesJson),
    objects: parse(row.objectsJson),
    topics: parse(row.topicsJson),
    origin: parse(row.originJson),
    status: row.status as EventNote['status'],
  }
}

export interface StoredEventNote extends EventNote {
  tdbId: number
  replacedBy?: string
}

export class EventNoteRepository {
  constructor(private db: DrizzleDb) {}

  async maxTdbId(): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`coalesce(max(${eventNotes.tdbId}), 0)` })
      .from(eventNotes)
    return Number(row?.value ?? 0)
  }

  async prepareCreate(operationId: string, note: EventNote, tdbId: number): Promise<boolean> {
    return this.db.transaction((tx) => {
      const operation = tx
        .insert(eventMemoryOperations)
        .values({
          operationId,
          agentId: note.agentId,
          operation: 'create',
          payloadJson: JSON.stringify({ note, tdbId }),
          status: 'pending',
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing()
        .returning({ id: eventMemoryOperations.operationId })
        .get()
      if (!operation) return false
      tx.insert(eventNotes)
        .values({
          id: note.id,
          tdbId,
          agentId: note.agentId,
          narrative: note.narrative,
          eventAt: note.eventAt,
          createdAt: note.createdAt,
          importance: note.importance,
          affectJson: JSON.stringify(note.affect),
          participantsJson: JSON.stringify(note.participants),
          placesJson: JSON.stringify(note.places),
          objectsJson: JSON.stringify(note.objects),
          topicsJson: JSON.stringify(note.topics),
          originJson: JSON.stringify(note.origin),
          status: note.status,
        })
        .run()
      return true
    })
  }

  async prepareRevise(
    operationId: string,
    target: StoredEventNote,
    replacement: EventNote,
    newTdbId: number,
    relations: EventNoteRelationView[],
  ): Promise<boolean> {
    return this.db.transaction((tx) => {
      const operation = tx
        .insert(eventMemoryOperations)
        .values({
          operationId,
          agentId: target.agentId,
          operation: 'revise',
          payloadJson: JSON.stringify({ target, replacement, newTdbId, relations }),
          status: 'pending',
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing()
        .returning({ id: eventMemoryOperations.operationId })
        .get()
      if (!operation) return false
      tx.insert(eventNotes)
        .values({
          id: replacement.id,
          tdbId: newTdbId,
          agentId: replacement.agentId,
          narrative: replacement.narrative,
          eventAt: replacement.eventAt,
          createdAt: replacement.createdAt,
          importance: replacement.importance,
          affectJson: JSON.stringify(replacement.affect),
          participantsJson: JSON.stringify(replacement.participants),
          placesJson: JSON.stringify(replacement.places),
          objectsJson: JSON.stringify(replacement.objects),
          topicsJson: JSON.stringify(replacement.topics),
          originJson: JSON.stringify(replacement.origin),
          status: replacement.status,
        })
        .run()
      tx.update(eventNotes)
        .set({ replacedBy: replacement.id })
        .where(eq(eventNotes.id, target.id))
        .run()
      return true
    })
  }

  async create(note: EventNote, tdbId: number): Promise<void> {
    await this.db.insert(eventNotes).values({
      id: note.id,
      tdbId,
      agentId: note.agentId,
      narrative: note.narrative,
      eventAt: note.eventAt,
      createdAt: note.createdAt,
      importance: note.importance,
      affectJson: JSON.stringify(note.affect),
      participantsJson: JSON.stringify(note.participants),
      placesJson: JSON.stringify(note.places),
      objectsJson: JSON.stringify(note.objects),
      topicsJson: JSON.stringify(note.topics),
      originJson: JSON.stringify(note.origin),
      status: note.status,
    })
  }

  async findById(id: string): Promise<StoredEventNote | undefined> {
    const [row] = await this.db.select().from(eventNotes).where(eq(eventNotes.id, id)).limit(1)
    return row
      ? { ...toEventNote(row), tdbId: row.tdbId, replacedBy: row.replacedBy ?? undefined }
      : undefined
  }

  async findByTdbId(tdbId: number): Promise<StoredEventNote | undefined> {
    const [row] = await this.db
      .select()
      .from(eventNotes)
      .where(eq(eventNotes.tdbId, tdbId))
      .limit(1)
    return row
      ? { ...toEventNote(row), tdbId: row.tdbId, replacedBy: row.replacedBy ?? undefined }
      : undefined
  }

  async list(
    agentId: string,
    options: { includeArchived?: boolean; limit?: number; ascending?: boolean } = {},
  ): Promise<StoredEventNote[]> {
    const conditions = [eq(eventNotes.agentId, agentId), isNull(eventNotes.replacedBy)]
    if (!options.includeArchived) conditions.push(eq(eventNotes.status, 'active'))
    const rows = await this.db
      .select()
      .from(eventNotes)
      .where(and(...conditions))
      .orderBy(
        options.ascending === false ? desc(eventNotes.eventAt) : asc(eventNotes.eventAt),
        asc(eventNotes.id),
      )
      .limit(options.limit ?? 500)
    return rows.map((row) => ({ ...toEventNote(row), tdbId: row.tdbId }))
  }

  async listAllCurrent(): Promise<StoredEventNote[]> {
    const rows = await this.db.select().from(eventNotes).where(isNull(eventNotes.replacedBy))
    return rows.map((row) => ({ ...toEventNote(row), tdbId: row.tdbId }))
  }

  async markReplaced(id: string, replacementId: string): Promise<void> {
    await this.db.update(eventNotes).set({ replacedBy: replacementId }).where(eq(eventNotes.id, id))
  }

  async archive(id: string): Promise<void> {
    await this.db.update(eventNotes).set({ status: 'archived' }).where(eq(eventNotes.id, id))
  }

  async deleteBackup(id: string): Promise<void> {
    await this.db.delete(eventNotes).where(eq(eventNotes.id, id))
  }

  async saveCoverage(coverage: ConversationCoverage): Promise<void> {
    this.validateCoverage(coverage)
    await this.db.insert(eventNoteCoverages).values(this.coverageValues(coverage))
  }

  async reviewedNoEventCoverages(agentId: string): Promise<
    Array<{
      threadId: string
      pairIds: string[]
      coveredAt: string
    }>
  > {
    const rows = await this.db
      .select()
      .from(eventNoteCoverages)
      .where(
        and(
          eq(eventNoteCoverages.agentId, agentId),
          eq(eventNoteCoverages.outcome, 'reviewed_no_event'),
          isNull(eventNoteCoverages.invalidatedAt),
        ),
      )
    return rows.map((row) => ({
      threadId: row.threadId,
      pairIds: parse<string[]>(row.pairIdsJson),
      coveredAt: row.coveredAt,
    }))
  }

  async claimCoverageRange(input: {
    agentId: string
    threadId: string
    pairIds: string[]
    ownerId: string
    staleBefore?: string
  }): Promise<boolean> {
    const pairIds = [...new Set(input.pairIds)]
    if (!pairIds.length) return false
    try {
      return this.db.transaction((tx) => {
        if (input.staleBefore) {
          tx.delete(eventMemoryCoverageClaims)
            .where(sql`${eventMemoryCoverageClaims.claimedAt} < ${input.staleBefore}`)
            .run()
        }
        const coverages = tx
          .select({ pairIdsJson: eventNoteCoverages.pairIdsJson })
          .from(eventNoteCoverages)
          .where(
            and(
              eq(eventNoteCoverages.agentId, input.agentId),
              eq(eventNoteCoverages.threadId, input.threadId),
              isNull(eventNoteCoverages.invalidatedAt),
            ),
          )
          .all()
        const covered = new Set(coverages.flatMap((row) => parse<string[]>(row.pairIdsJson)))
        if (pairIds.some((pairId) => covered.has(pairId))) return false

        const existing = tx
          .select({
            pairId: eventMemoryCoverageClaims.pairId,
            ownerId: eventMemoryCoverageClaims.ownerId,
          })
          .from(eventMemoryCoverageClaims)
          .where(
            and(
              eq(eventMemoryCoverageClaims.agentId, input.agentId),
              eq(eventMemoryCoverageClaims.threadId, input.threadId),
              inArray(eventMemoryCoverageClaims.pairId, pairIds),
            ),
          )
          .all()
        if (existing.some((claim) => claim.ownerId !== input.ownerId)) return false

        const claimedAt = new Date().toISOString()
        for (const pairId of pairIds) {
          tx.insert(eventMemoryCoverageClaims)
            .values({
              agentId: input.agentId,
              threadId: input.threadId,
              pairId,
              ownerId: input.ownerId,
              claimedAt,
            })
            .onConflictDoNothing()
            .run()
        }
        return true
      })
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) return false
      throw error
    }
  }

  async releaseCoverageClaim(ownerId: string): Promise<void> {
    await this.db
      .delete(eventMemoryCoverageClaims)
      .where(eq(eventMemoryCoverageClaims.ownerId, ownerId))
  }

  async commitCoverageUnderClaim(coverage: ConversationCoverage, ownerId: string): Promise<void> {
    this.validateCoverage(coverage)
    const pairIds = [...new Set(coverage.pairIds)]
    await this.db.transaction((tx) => {
      const claims = tx
        .select({ pairId: eventMemoryCoverageClaims.pairId })
        .from(eventMemoryCoverageClaims)
        .where(
          and(
            eq(eventMemoryCoverageClaims.agentId, coverage.agentId),
            eq(eventMemoryCoverageClaims.threadId, coverage.threadId),
            eq(eventMemoryCoverageClaims.ownerId, ownerId),
            inArray(eventMemoryCoverageClaims.pairId, pairIds),
          ),
        )
        .all()
      if (new Set(claims.map((claim) => claim.pairId)).size !== pairIds.length) {
        throw new Error('Coverage Claim已失效或不完整')
      }
      tx.insert(eventNoteCoverages).values(this.coverageValues(coverage)).run()
      tx.delete(eventMemoryCoverageClaims)
        .where(eq(eventMemoryCoverageClaims.ownerId, ownerId))
        .run()
    })
  }

  async clearExpiredCoverageClaims(staleBefore: string): Promise<void> {
    await this.db
      .delete(eventMemoryCoverageClaims)
      .where(sql`${eventMemoryCoverageClaims.claimedAt} < ${staleBefore}`)
  }

  async coveredPairIds(agentId: string, threadId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ pairIdsJson: eventNoteCoverages.pairIdsJson })
      .from(eventNoteCoverages)
      .where(
        and(
          eq(eventNoteCoverages.agentId, agentId),
          eq(eventNoteCoverages.threadId, threadId),
          isNull(eventNoteCoverages.invalidatedAt),
        ),
      )
    return new Set(rows.flatMap((row) => parse<string[]>(row.pairIdsJson)))
  }

  async invalidateCoverageByPairIds(threadId: string, pairIds: string[]): Promise<void> {
    const targets = new Set(pairIds)
    if (!targets.size) return
    await this.db.transaction((tx) => {
      const rows = tx
        .select({ id: eventNoteCoverages.id, pairIdsJson: eventNoteCoverages.pairIdsJson })
        .from(eventNoteCoverages)
        .where(
          and(eq(eventNoteCoverages.threadId, threadId), isNull(eventNoteCoverages.invalidatedAt)),
        )
        .all()
      const invalidatedAt = new Date().toISOString()
      for (const row of rows) {
        if (parse<string[]>(row.pairIdsJson).some((pairId) => targets.has(pairId))) {
          tx.update(eventNoteCoverages)
            .set({ invalidatedAt })
            .where(eq(eventNoteCoverages.id, row.id))
            .run()
        }
      }
      tx.delete(eventMemoryCoverageClaims)
        .where(
          and(
            eq(eventMemoryCoverageClaims.threadId, threadId),
            inArray(eventMemoryCoverageClaims.pairId, [...targets]),
          ),
        )
        .run()
    })
  }

  async invalidateThreadCoverage(threadId: string): Promise<void> {
    await this.db.transaction((tx) => {
      tx.update(eventNoteCoverages)
        .set({ invalidatedAt: new Date().toISOString() })
        .where(
          and(eq(eventNoteCoverages.threadId, threadId), isNull(eventNoteCoverages.invalidatedAt)),
        )
        .run()
      tx.delete(eventMemoryCoverageClaims)
        .where(eq(eventMemoryCoverageClaims.threadId, threadId))
        .run()
    })
  }

  async addRelation(input: EventNoteRelationView): Promise<void> {
    await this.db
      .insert(eventMemoryRelations)
      .values({
        id: `${input.sourceId}:${input.relation}:${input.targetId}`,
        agentId: (await this.findById(input.sourceId))?.agentId ?? '',
        sourceId: input.sourceId,
        targetId: input.targetId,
        relation: input.relation,
        weight: input.weight,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [
          eventMemoryRelations.sourceId,
          eventMemoryRelations.targetId,
          eventMemoryRelations.relation,
        ],
        set: { weight: input.weight },
      })
  }

  async removeRelation(
    sourceId: string,
    targetId: string,
    relation: EventNoteRelation,
  ): Promise<void> {
    await this.db
      .delete(eventMemoryRelations)
      .where(
        and(
          eq(eventMemoryRelations.sourceId, sourceId),
          eq(eventMemoryRelations.targetId, targetId),
          eq(eventMemoryRelations.relation, relation),
        ),
      )
  }

  async listRelations(noteId: string): Promise<EventNoteRelationView[]> {
    const rows = await this.db
      .select()
      .from(eventMemoryRelations)
      .where(
        or(eq(eventMemoryRelations.sourceId, noteId), eq(eventMemoryRelations.targetId, noteId)),
      )
    return rows.map((row) => ({
      sourceId: row.sourceId,
      targetId: row.targetId,
      relation: row.relation as EventNoteRelation,
      weight: row.weight,
    }))
  }

  async ensureDailyNoteTask(input: {
    id: string
    agentId: string
    date: string
    sourceIncomplete: boolean
  }): Promise<void> {
    const now = new Date().toISOString()
    await this.db
      .insert(eventMemoryDailyNoteTasks)
      .values({
        ...input,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
  }

  async dailyNoteTask(
    agentId: string,
    date: string,
  ): Promise<
    | {
        id: string
        status: string
        attempts: number
        nextAttemptAt: string | null
        sourceIncomplete: boolean
        writtenFiles: string[]
      }
    | undefined
  > {
    const [row] = await this.db
      .select()
      .from(eventMemoryDailyNoteTasks)
      .where(
        and(
          eq(eventMemoryDailyNoteTasks.agentId, agentId),
          eq(eventMemoryDailyNoteTasks.date, date),
        ),
      )
      .limit(1)
    return row
      ? {
          id: row.id,
          status: row.status,
          attempts: row.attempts,
          nextAttemptAt: row.nextAttemptAt,
          sourceIncomplete: row.sourceIncomplete,
          writtenFiles: parse<string[]>(row.writtenFilesJson),
        }
      : undefined
  }

  async completeDailyNoteTask(id: string, writtenFiles: string[]): Promise<void> {
    await this.db
      .update(eventMemoryDailyNoteTasks)
      .set({
        status: 'completed',
        writtenFilesJson: JSON.stringify(writtenFiles),
        nextAttemptAt: null,
        lastError: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(eventMemoryDailyNoteTasks.id, id))
  }

  async failDailyNoteTask(id: string, error: string, nextAttemptAt: string | null): Promise<void> {
    await this.db
      .update(eventMemoryDailyNoteTasks)
      .set({
        status: nextAttemptAt ? 'failed' : 'exhausted',
        attempts: sql`${eventMemoryDailyNoteTasks.attempts} + 1`,
        nextAttemptAt,
        lastError: error,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(eventMemoryDailyNoteTasks.id, id))
  }

  async enqueueReflectionTask(input: {
    id: string
    agentId: string
    eventId: string
  }): Promise<void> {
    const now = new Date().toISOString()
    await this.db
      .insert(eventMemoryReflectionTasks)
      .values({
        ...input,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [eventMemoryReflectionTasks.agentId, eventMemoryReflectionTasks.eventId],
        set: { status: 'pending', lastError: null, updatedAt: now },
      })
  }

  async pendingReflectionTasks(limit = 100): Promise<
    Array<{
      id: string
      agentId: string
      eventId: string
    }>
  > {
    return this.db
      .select({
        id: eventMemoryReflectionTasks.id,
        agentId: eventMemoryReflectionTasks.agentId,
        eventId: eventMemoryReflectionTasks.eventId,
      })
      .from(eventMemoryReflectionTasks)
      .where(inArray(eventMemoryReflectionTasks.status, ['pending', 'failed']))
      .orderBy(asc(eventMemoryReflectionTasks.updatedAt))
      .limit(limit)
  }

  async completeReflectionTask(id: string): Promise<void> {
    await this.db
      .update(eventMemoryReflectionTasks)
      .set({
        status: 'completed',
        lastError: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(eventMemoryReflectionTasks.id, id))
  }

  async failReflectionTask(id: string, error: string): Promise<void> {
    await this.db
      .update(eventMemoryReflectionTasks)
      .set({
        status: 'failed',
        attempts: sql`${eventMemoryReflectionTasks.attempts} + 1`,
        lastError: error,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(eventMemoryReflectionTasks.id, id))
  }

  async enqueueMissingReflectionTasks(): Promise<number> {
    const notes = await this.listAllCurrent()
    let count = 0
    for (const note of notes) {
      const id = `reflection:${note.agentId}:${note.id}`
      const result = await this.db
        .insert(eventMemoryReflectionTasks)
        .values({
          id,
          agentId: note.agentId,
          eventId: note.id,
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoNothing()
        .returning({ id: eventMemoryReflectionTasks.id })
      count += result.length
    }
    return count
  }

  async recordQueryAudit(input: {
    id: string
    agentId: string
    mode: string
    query: unknown
    resultCount: number
    returnedTokens: number
    truncated: boolean
    queriedAt: string
  }): Promise<void> {
    await this.db.insert(eventMemoryQueryAudits).values({
      id: input.id,
      agentId: input.agentId,
      mode: input.mode,
      queryJson: JSON.stringify(input.query),
      resultCount: input.resultCount,
      returnedTokens: input.returnedTokens,
      truncated: input.truncated,
      queriedAt: input.queriedAt,
    })
  }

  async checkpointTimer(key: string, elapsedSeconds: number): Promise<void> {
    await this.db
      .insert(eventMemoryTimers)
      .values({
        key,
        elapsedSeconds: Math.max(0, Math.floor(elapsedSeconds)),
        checkpointAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: eventMemoryTimers.key,
        set: {
          elapsedSeconds: Math.max(0, Math.floor(elapsedSeconds)),
          checkpointAt: new Date().toISOString(),
        },
      })
  }

  async readTimer(key: string): Promise<number> {
    const [row] = await this.db
      .select({ elapsedSeconds: eventMemoryTimers.elapsedSeconds })
      .from(eventMemoryTimers)
      .where(eq(eventMemoryTimers.key, key))
      .limit(1)
    return row?.elapsedSeconds ?? 0
  }

  async resetTimer(key: string): Promise<void> {
    await this.checkpointTimer(key, 0)
  }

  async findOperation(
    operationId: string,
  ): Promise<{ operation: string; status: string; payload: unknown } | undefined> {
    const [row] = await this.db
      .select()
      .from(eventMemoryOperations)
      .where(eq(eventMemoryOperations.operationId, operationId))
      .limit(1)
    return row
      ? { operation: row.operation, status: row.status, payload: parse(row.payloadJson) }
      : undefined
  }

  async createOperation(
    operationId: string,
    agentId: string,
    operation: string,
    payload: unknown,
  ): Promise<boolean> {
    const result = await this.db
      .insert(eventMemoryOperations)
      .values({
        operationId,
        agentId,
        operation,
        payloadJson: JSON.stringify(payload),
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .returning({ id: eventMemoryOperations.operationId })
    return result.length > 0
  }

  async markOperationCommitted(operationId: string): Promise<void> {
    await this.db
      .update(eventMemoryOperations)
      .set({
        status: 'committed',
        committedAt: new Date().toISOString(),
        lastError: null,
      })
      .where(eq(eventMemoryOperations.operationId, operationId))
  }

  async markOperationFailed(operationId: string, error: string): Promise<void> {
    await this.db
      .update(eventMemoryOperations)
      .set({
        status: 'failed',
        lastError: error,
        attempts: sql`${eventMemoryOperations.attempts} + 1`,
      })
      .where(eq(eventMemoryOperations.operationId, operationId))
  }

  private validateCoverage(coverage: ConversationCoverage): void {
    if (!coverage.pairIds.length) throw new Error('Coverage必须覆盖至少一个Pair')
    if (coverage.outcome === 'event_recorded' && coverage.eventNoteIds.length === 0) {
      throw new Error('事件覆盖必须关联至少一个EventNote')
    }
    if (coverage.outcome === 'reviewed_no_event' && coverage.eventNoteIds.length > 0) {
      throw new Error('无事件覆盖不能关联EventNote')
    }
  }

  private coverageValues(coverage: ConversationCoverage) {
    return {
      id: coverage.id,
      agentId: coverage.agentId,
      threadId: coverage.threadId,
      pairIdsJson: JSON.stringify([...new Set(coverage.pairIds)]),
      messageIdsJson: JSON.stringify([...new Set(coverage.messageIds)]),
      outcome: coverage.outcome,
      eventNoteIdsJson: JSON.stringify([...new Set(coverage.eventNoteIds)]),
      mode: coverage.mode,
      coveredAt: coverage.coveredAt,
    }
  }

  async pendingOperations(): Promise<
    Array<{ operationId: string; agentId: string; operation: string; payload: unknown }>
  > {
    const rows = await this.db
      .select()
      .from(eventMemoryOperations)
      .where(inArray(eventMemoryOperations.status, ['pending', 'failed']))
    return rows.map((row) => ({
      operationId: row.operationId,
      agentId: row.agentId,
      operation: row.operation,
      payload: parse(row.payloadJson),
    }))
  }
}
