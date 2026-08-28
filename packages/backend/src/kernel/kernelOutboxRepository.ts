import { randomUUID } from 'node:crypto'
import type { KernelEventEnvelope, KernelEventId, KernelOutboxEventInput } from '@infos/shared'
import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { DrizzleDb } from '../database'
import { kernelOutboxEvents } from '../database/schema'

export type KernelOutboxRow = typeof kernelOutboxEvents.$inferSelect

/** 将领域事务中产生的 Durable Event 持久化到 SQLite Outbox。 */
export class KernelOutboxRepository {
  constructor(private readonly db: DrizzleDb) {}

  createEvent(input: KernelOutboxEventInput): KernelEventEnvelope<string, unknown> {
    return {
      ...input,
      eventId: input.eventId ?? (randomUUID() as KernelEventId),
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    }
  }

  async enqueue(input: KernelOutboxEventInput): Promise<KernelEventEnvelope<string, unknown>> {
    const event = this.createEvent(input)
    await this.db.insert(kernelOutboxEvents).values(this.toRow(event))
    return event
  }

  async listPending(limit = 100, now = new Date()): Promise<KernelOutboxRow[]> {
    return this.db
      .select()
      .from(kernelOutboxEvents)
      .where(
        and(
          eq(kernelOutboxEvents.status, 'pending'),
          or(
            isNull(kernelOutboxEvents.nextAttemptAt),
            lte(kernelOutboxEvents.nextAttemptAt, now.toISOString()),
          ),
        ),
      )
      .orderBy(sql`rowid`)
      .limit(Math.max(1, Math.min(1000, limit)))
  }

  async markPublished(eventId: string): Promise<void> {
    await this.db
      .update(kernelOutboxEvents)
      .set({
        status: 'published',
        publishedAt: new Date().toISOString(),
        lastError: null,
        nextAttemptAt: null,
      })
      .where(eq(kernelOutboxEvents.eventId, eventId))
  }

  async markFailed(
    eventId: string,
    error: unknown,
    nextAttemptAt: Date,
    maxAttempts = 8,
  ): Promise<'pending' | 'dead_letter'> {
    const current = await this.db
      .select({ attempts: kernelOutboxEvents.attempts })
      .from(kernelOutboxEvents)
      .where(eq(kernelOutboxEvents.eventId, eventId))
      .limit(1)
    const attempts = (current[0]?.attempts ?? 0) + 1
    const status = attempts >= maxAttempts ? 'dead_letter' : 'pending'
    await this.db
      .update(kernelOutboxEvents)
      .set({
        status,
        attempts,
        lastError: error instanceof Error ? error.message : String(error),
        nextAttemptAt: status === 'dead_letter' ? null : nextAttemptAt.toISOString(),
      })
      .where(eq(kernelOutboxEvents.eventId, eventId))
    return status
  }

  async listDeadLetters(limit = 100): Promise<KernelOutboxRow[]> {
    return this.db
      .select()
      .from(kernelOutboxEvents)
      .where(eq(kernelOutboxEvents.status, 'dead_letter'))
      .orderBy(sql`rowid`)
      .limit(Math.max(1, Math.min(1000, limit)))
  }

  async replay(eventId: string): Promise<boolean> {
    const result = await this.db
      .update(kernelOutboxEvents)
      .set({ status: 'pending', attempts: 0, lastError: null, nextAttemptAt: null })
      .where(
        and(eq(kernelOutboxEvents.eventId, eventId), eq(kernelOutboxEvents.status, 'dead_letter')),
      )
      .returning({ eventId: kernelOutboxEvents.eventId })
    return result.length > 0
  }

  async replayAllDeadLetters(limit = 100): Promise<number> {
    const rows = await this.listDeadLetters(limit)
    let replayed = 0
    for (const row of rows) if (await this.replay(row.eventId)) replayed += 1
    return replayed
  }

  async cleanupPublished(retainSince: Date): Promise<number> {
    const result = await this.db
      .delete(kernelOutboxEvents)
      .where(
        and(
          eq(kernelOutboxEvents.status, 'published'),
          lt(kernelOutboxEvents.publishedAt, retainSince.toISOString()),
        ),
      )
      .returning({ eventId: kernelOutboxEvents.eventId })
    return result.length
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: kernelOutboxEvents.status, count: sql<number>`count(*)` })
      .from(kernelOutboxEvents)
      .groupBy(kernelOutboxEvents.status)
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]))
  }

  toRow(event: KernelEventEnvelope<string, unknown>): typeof kernelOutboxEvents.$inferInsert {
    return {
      eventId: event.eventId,
      eventType: event.type,
      durability: event.durability,
      principalId: event.principalId,
      processId: event.processId ?? null,
      executionId: event.executionId ?? null,
      correlationId: event.correlationId ?? null,
      causationId: event.causationId ?? null,
      objectType: event.object?.objectType ?? null,
      objectId: event.object?.objectId ?? null,
      objectGeneration: event.object?.generation ?? null,
      payloadJson: JSON.stringify(event.payload),
      occurredAt: event.occurredAt,
      status: 'pending',
    }
  }
}
