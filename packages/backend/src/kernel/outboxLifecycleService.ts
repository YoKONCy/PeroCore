import type { KernelOutboxPublisher } from './kernelOutboxPublisher'
import type { KernelOutboxRepository, KernelOutboxRow } from './kernelOutboxRepository'

/** Durable Event 的保留、死信和人工重放入口。 */
export class OutboxLifecycleService {
  constructor(
    private readonly outbox: KernelOutboxRepository,
    private readonly publisher: KernelOutboxPublisher,
    private readonly retentionDays = 30,
  ) {}

  async maintain(now = new Date()): Promise<{ outboxDeleted: number }> {
    const retainSince = new Date(now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000)
    const outboxDeleted = await this.outbox.cleanupPublished(retainSince)
    return { outboxDeleted }
  }

  async deadLetters(limit = 100): Promise<{ kernel: KernelOutboxRow[] }> {
    return { kernel: await this.outbox.listDeadLetters(limit) }
  }

  async replayKernel(eventId: string): Promise<boolean> {
    const replayed = await this.outbox.replay(eventId)
    if (replayed) this.publisher.wake()
    return replayed
  }

  async diagnostics(): Promise<{ kernel: Record<string, number> }> {
    return { kernel: await this.outbox.countByStatus() }
  }
}
