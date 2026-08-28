import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import type { DrizzleDb } from '../database'
import { flowStateRevisions, flowStates, workContextEntries } from '../database/schema'

export type FlowStateRow = typeof flowStates.$inferSelect

/** 心流持久化：当前状态与修订历史保持独立，避免污染 Thread 消息。 */
export class FlowStateRepository {
  constructor(private readonly db: DrizzleDb) {}

  async get(threadId: string, agentId: string): Promise<FlowStateRow | null> {
    const rows = await this.db
      .select()
      .from(flowStates)
      .where(and(eq(flowStates.threadId, threadId), eq(flowStates.agentId, agentId)))
      .limit(1)
    return rows[0] ?? null
  }

  async listByThread(threadId: string): Promise<FlowStateRow[]> {
    return this.db.select().from(flowStates).where(eq(flowStates.threadId, threadId))
  }

  async save(input: {
    threadId: string
    agentId: string
    currentGoal: string
    privateFacts: string
    workContext?: string
    workContextUpdatedAtPairCount?: number
    pairId?: string | null
  }): Promise<FlowStateRow> {
    const before = await this.get(input.threadId, input.agentId)
    await this.db.insert(flowStateRevisions).values({
      threadId: input.threadId,
      agentId: input.agentId,
      pairId: input.pairId ?? null,
      beforeCurrentGoal: before?.currentGoal ?? '',
      beforePrivateFacts: before?.privateFacts ?? '',
      afterCurrentGoal: input.currentGoal,
      afterPrivateFacts: input.privateFacts,
      beforeWorkContext: before?.workContext ?? '',
      beforeWorkContextUpdatedAtPairCount: before?.workContextUpdatedAtPairCount ?? 0,
      afterWorkContext: input.workContext ?? before?.workContext ?? '',
      afterWorkContextUpdatedAtPairCount:
        input.workContextUpdatedAtPairCount ?? before?.workContextUpdatedAtPairCount ?? 0,
    })
    const rows = await this.db
      .insert(flowStates)
      .values({
        threadId: input.threadId,
        agentId: input.agentId,
        currentGoal: input.currentGoal,
        privateFacts: input.privateFacts,
        workContext: input.workContext ?? before?.workContext ?? '',
        workContextUpdatedAtPairCount:
          input.workContextUpdatedAtPairCount ?? before?.workContextUpdatedAtPairCount ?? 0,
        revision: (before?.revision ?? 0) + 1,
        updatedByPairId: input.pairId ?? null,
      })
      .onConflictDoUpdate({
        target: [flowStates.threadId, flowStates.agentId],
        set: {
          currentGoal: input.currentGoal,
          privateFacts: input.privateFacts,
          workContext: input.workContext ?? before?.workContext ?? '',
          workContextUpdatedAtPairCount:
            input.workContextUpdatedAtPairCount ?? before?.workContextUpdatedAtPairCount ?? 0,
          revision: (before?.revision ?? 0) + 1,
          updatedByPairId: input.pairId ?? null,
          updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        },
      })
      .returning()
    return rows[0]!
  }

  async appendWorkContextEntry(input: {
    threadId: string
    agentId: string
    pairId: string
    pairCount: number
    content: string
  }): Promise<void> {
    await this.db
      .insert(workContextEntries)
      .values(input)
      .onConflictDoUpdate({
        target: [
          workContextEntries.threadId,
          workContextEntries.agentId,
          workContextEntries.pairId,
        ],
        set: { pairCount: input.pairCount, content: input.content },
      })
  }

  async listWorkContextEntries(
    threadId: string,
    agentId: string,
    minimumPairCount: number,
  ): Promise<Array<typeof workContextEntries.$inferSelect>> {
    return this.db
      .select()
      .from(workContextEntries)
      .where(
        and(
          eq(workContextEntries.threadId, threadId),
          eq(workContextEntries.agentId, agentId),
          gte(workContextEntries.pairCount, minimumPairCount),
        ),
      )
      .orderBy(asc(workContextEntries.pairCount), asc(workContextEntries.id))
  }

  async deleteExpiredWorkContextEntries(
    threadId: string,
    agentId: string,
    minimumPairCount: number,
  ): Promise<void> {
    await this.db
      .delete(workContextEntries)
      .where(
        and(
          eq(workContextEntries.threadId, threadId),
          eq(workContextEntries.agentId, agentId),
          lt(workContextEntries.pairCount, minimumPairCount),
        ),
      )
  }

  async clearWorkContextEntries(threadId: string, agentId: string): Promise<void> {
    await this.db
      .delete(workContextEntries)
      .where(
        and(eq(workContextEntries.threadId, threadId), eq(workContextEntries.agentId, agentId)),
      )
  }

  async clear(threadId: string, agentId: string, pairId?: string | null): Promise<FlowStateRow> {
    return this.save({ threadId, agentId, currentGoal: '', privateFacts: '', pairId })
  }

  async rollbackPairs(threadId: string, pairIds: string[]): Promise<void> {
    if (!pairIds.length) return
    await this.db
      .delete(workContextEntries)
      .where(
        and(eq(workContextEntries.threadId, threadId), inArray(workContextEntries.pairId, pairIds)),
      )
    const revisions = await this.db
      .select()
      .from(flowStateRevisions)
      .where(
        and(eq(flowStateRevisions.threadId, threadId), inArray(flowStateRevisions.pairId, pairIds)),
      )
      .orderBy(asc(flowStateRevisions.id))
    const earliest = new Map<string, (typeof revisions)[number]>()
    for (const revision of revisions)
      if (!earliest.has(revision.agentId)) earliest.set(revision.agentId, revision)
    for (const revision of earliest.values()) {
      await this.db
        .insert(flowStates)
        .values({
          threadId,
          agentId: revision.agentId,
          currentGoal: revision.beforeCurrentGoal,
          privateFacts: revision.beforePrivateFacts,
          workContext: revision.beforeWorkContext,
          workContextUpdatedAtPairCount: revision.beforeWorkContextUpdatedAtPairCount,
          revision: 1,
        })
        .onConflictDoUpdate({
          target: [flowStates.threadId, flowStates.agentId],
          set: {
            currentGoal: revision.beforeCurrentGoal,
            privateFacts: revision.beforePrivateFacts,
            workContext: revision.beforeWorkContext,
            workContextUpdatedAtPairCount: revision.beforeWorkContextUpdatedAtPairCount,
            updatedByPairId: null,
            updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          },
        })
    }
    await this.db
      .delete(flowStateRevisions)
      .where(
        and(eq(flowStateRevisions.threadId, threadId), inArray(flowStateRevisions.pairId, pairIds)),
      )
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.db.delete(workContextEntries).where(eq(workContextEntries.threadId, threadId))
    await this.db.delete(flowStateRevisions).where(eq(flowStateRevisions.threadId, threadId))
    await this.db.delete(flowStates).where(eq(flowStates.threadId, threadId))
  }
}
