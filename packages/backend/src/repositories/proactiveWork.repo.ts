import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, lte, or, isNull, sql, gte } from 'drizzle-orm'
import type { DrizzleDb } from '../database'
import { proactiveSuggestions, scheduledTasks } from '../database/schema'

export type ScheduledWorkRow = typeof scheduledTasks.$inferSelect
export type SuggestionRow = typeof proactiveSuggestions.$inferSelect

/** 计划领取、结算和建议采纳的原子数据访问层；事务中不执行异步操作。 */
export class ProactiveWorkRepository {
  constructor(private db: DrizzleDb) {}

  createSchedule(values: typeof scheduledTasks.$inferInsert, enforceFollowUpCaps: boolean) {
    return this.db.transaction((tx) => {
      if (enforceFollowUpCaps) {
        const scope = and(
          eq(scheduledTasks.agentId, values.agentId!),
          eq(scheduledTasks.type, 'follow_up'),
        )
        const pending = tx
          .select({ count: sql<number>`count(*)` })
          .from(scheduledTasks)
          .where(and(scope, inArray(scheduledTasks.status, ['pending', 'dispatching'])))
          .get()!.count
        if (pending >= 5) throw new Error('最多保留 5 个待跟进事项，请先取消不再需要的跟进')
        const today = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
        const daily = tx
          .select({ count: sql<number>`count(*)` })
          .from(scheduledTasks)
          .where(and(scope, gte(scheduledTasks.createdAt, today)))
          .get()!.count
        if (daily >= 20) throw new Error('今天已安排 20 次跟进，请明天再安排')
      }
      return tx.insert(scheduledTasks).values(values).returning().get()!
    })
  }

  schedules(agentId?: string) {
    return this.db
      .select()
      .from(scheduledTasks)
      .where(
        and(
          agentId ? eq(scheduledTasks.agentId, agentId) : undefined,
          inArray(scheduledTasks.status, ['pending', 'dispatching', 'failed']),
        ),
      )
      .orderBy(asc(scheduledTasks.time))
      .all()
  }

  claimDue(now: string, agentId?: string) {
    return this.db.transaction((tx) => {
      tx.update(scheduledTasks)
        .set({
          status: 'failed',
          isTriggered: true,
          claimToken: null,
          leaseUntil: null,
          lastError: '派发多次中断，请检查后重试',
          settledAt: now,
        })
        .where(
          and(
            eq(scheduledTasks.status, 'dispatching'),
            lte(scheduledTasks.leaseUntil, now),
            sql`${scheduledTasks.attempts} >= 3`,
          ),
        )
        .run()
      const rows = tx
        .select()
        .from(scheduledTasks)
        .where(
          and(
            agentId ? eq(scheduledTasks.agentId, agentId) : undefined,
            lte(scheduledTasks.time, now),
            sql`${scheduledTasks.attempts} < 3`,
            or(
              and(
                eq(scheduledTasks.status, 'pending'),
                or(isNull(scheduledTasks.nextAttemptAt), lte(scheduledTasks.nextAttemptAt, now)),
              ),
              and(eq(scheduledTasks.status, 'dispatching'), lte(scheduledTasks.leaseUntil, now)),
            ),
          ),
        )
        .orderBy(asc(scheduledTasks.time))
        .limit(20)
        .all()
      return rows.map(
        (row) =>
          tx
            .update(scheduledTasks)
            .set({
              status: 'dispatching',
              claimToken: randomUUID(),
              leaseUntil: new Date(Date.parse(now) + 60_000).toISOString(),
              attempts: row.attempts + 1,
            })
            .where(eq(scheduledTasks.id, row.id))
            .returning()
            .get()!,
      )
    })
  }

  settle(row: ScheduledWorkRow, taskId?: string, error?: string) {
    const now = new Date().toISOString()
    return this.db
      .update(scheduledTasks)
      .set({
        status: error
          ? row.attempts >= 3
            ? 'failed'
            : 'pending'
          : taskId
            ? 'dispatched'
            : 'completed',
        isTriggered: !error || row.attempts >= 3,
        taskId: taskId ?? null,
        lastError: error?.slice(0, 1000) ?? null,
        nextAttemptAt: error
          ? new Date(Date.now() + 30_000 * 2 ** (row.attempts - 1)).toISOString()
          : null,
        claimToken: null,
        leaseUntil: null,
        settledAt: error && row.attempts < 3 ? null : now,
      })
      .where(
        and(
          eq(scheduledTasks.id, row.id),
          eq(scheduledTasks.status, 'dispatching'),
          eq(scheduledTasks.claimToken, row.claimToken!),
        ),
      )
      .returning()
      .get()
  }

  cancel(id: number, agentId: string) {
    return !!this.db
      .update(scheduledTasks)
      .set({ status: 'cancelled', isTriggered: true, settledAt: new Date().toISOString() })
      .where(
        and(
          eq(scheduledTasks.id, id),
          eq(scheduledTasks.agentId, agentId),
          inArray(scheduledTasks.status, ['pending', 'failed']),
        ),
      )
      .returning()
      .get()
  }

  retry(id: number, agentId: string) {
    return !!this.db
      .update(scheduledTasks)
      .set({
        status: 'pending',
        isTriggered: false,
        attempts: 0,
        lastError: null,
        nextAttemptAt: null,
        settledAt: null,
      })
      .where(
        and(
          eq(scheduledTasks.id, id),
          eq(scheduledTasks.agentId, agentId),
          eq(scheduledTasks.status, 'failed'),
        ),
      )
      .returning()
      .get()
  }

  createSuggestion(values: typeof proactiveSuggestions.$inferInsert) {
    return this.db.transaction((tx) => {
      const open = tx
        .select()
        .from(proactiveSuggestions)
        .where(
          and(
            eq(proactiveSuggestions.agentId, values.agentId),
            inArray(proactiveSuggestions.status, ['open', 'accepting']),
          ),
        )
        .all()
      const existing = open.find(
        (row) => row.threadId === values.threadId && row.instruction === values.instruction,
      )
      if (existing) return existing
      if (open.length >= 10) throw new Error('已有 10 条待处理建议，请先处理现有建议')
      if (values.sourceExecutionId) {
        const count = tx
          .select({ count: sql<number>`count(*)` })
          .from(proactiveSuggestions)
          .where(eq(proactiveSuggestions.sourceExecutionId, values.sourceExecutionId))
          .get()!.count
        if (count >= 5) throw new Error('本轮最多提出 5 条建议')
      }
      return tx.insert(proactiveSuggestions).values(values).returning().get()!
    })
  }

  suggestions(agentId?: string, status?: string) {
    return this.db
      .select()
      .from(proactiveSuggestions)
      .where(
        and(
          agentId ? eq(proactiveSuggestions.agentId, agentId) : undefined,
          status
            ? eq(proactiveSuggestions.status, status)
            : inArray(proactiveSuggestions.status, ['open', 'accepting']),
        ),
      )
      .orderBy(asc(proactiveSuggestions.createdAt))
      .all()
  }

  suggestion(id: string, agentId: string) {
    return this.db
      .select()
      .from(proactiveSuggestions)
      .where(and(eq(proactiveSuggestions.id, id), eq(proactiveSuggestions.agentId, agentId)))
      .get()
  }

  transitionSuggestion(
    id: string,
    agentId: string,
    from: string[],
    status: string,
    taskId?: string,
  ) {
    return this.db
      .update(proactiveSuggestions)
      .set({
        status,
        ...(taskId ? { taskId } : {}),
        resolvedAt: ['accepted', 'dismissed'].includes(status) ? new Date().toISOString() : null,
      })
      .where(
        and(
          eq(proactiveSuggestions.id, id),
          eq(proactiveSuggestions.agentId, agentId),
          inArray(proactiveSuggestions.status, from),
        ),
      )
      .returning()
      .get()
  }
}
