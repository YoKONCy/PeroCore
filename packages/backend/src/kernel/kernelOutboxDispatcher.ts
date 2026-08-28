import type { KernelEventEnvelope } from '@infos/shared'
import type { KernelOutboxRepository, KernelOutboxRow } from './kernelOutboxRepository'

export type KernelEventHandler = (
  event: KernelEventEnvelope<string, unknown>,
) => void | Promise<void>

/** Outbox 发布器；传输实现通过 Handler 注入，不把 WebSocket/SSE 固化进内核。 */
export class KernelOutboxDispatcher {
  constructor(
    private readonly outbox: KernelOutboxRepository,
    private readonly handler: KernelEventHandler,
    private readonly maxAttempts = 8,
  ) {}

  async dispatchPending(
    limit = 100,
  ): Promise<{ published: number; failed: number; deadLettered: number }> {
    const rows = await this.outbox.listPending(limit)
    let published = 0
    let failed = 0
    let deadLettered = 0
    for (const row of rows) {
      try {
        await this.handler(this.fromRow(row))
        await this.outbox.markPublished(row.eventId)
        published += 1
      } catch (error) {
        const delayMs = Math.min(60_000, 1000 * 2 ** Math.min(row.attempts, 6))
        const status = await this.outbox.markFailed(
          row.eventId,
          error,
          new Date(Date.now() + delayMs),
          this.maxAttempts,
        )
        failed += 1
        if (status === 'dead_letter') {
          deadLettered += 1
          continue
        }
        // Durable Event保持提交顺序；可重试失败时不越过该事件发布后继事实。
        break
      }
    }
    return { published, failed, deadLettered }
  }

  private fromRow(row: KernelOutboxRow): KernelEventEnvelope<string, unknown> {
    return {
      protocolVersion: 1,
      eventId: row.eventId as KernelEventEnvelope['eventId'],
      type: row.eventType,
      durability: row.durability as KernelEventEnvelope['durability'],
      principalId: row.principalId,
      processId: (row.processId ?? undefined) as KernelEventEnvelope['processId'],
      executionId: (row.executionId ?? undefined) as KernelEventEnvelope['executionId'],
      correlationId: row.correlationId ?? undefined,
      causationId: (row.causationId ?? undefined) as KernelEventEnvelope['causationId'],
      object:
        row.objectType && row.objectId && row.objectGeneration !== null
          ? {
              objectType: row.objectType,
              objectId: row.objectId as NonNullable<KernelEventEnvelope['object']>['objectId'],
              generation: row.objectGeneration,
              ownerPrincipalId: row.principalId,
            }
          : undefined,
      occurredAt: row.occurredAt,
      payload: JSON.parse(row.payloadJson) as unknown,
    }
  }
}
