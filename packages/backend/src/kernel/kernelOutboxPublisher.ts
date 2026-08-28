import type { KernelEventEnvelope } from '@infos/shared'
import { createLogger } from '../lib/logger'
import type { KernelOutboxDispatcher } from './kernelOutboxDispatcher'
import type { LifecycleScope } from './lifecycleScope'

const logger = createLogger('KernelOutboxPublisher')

/** 进程内 Durable Event 订阅总线；消费者必须自行保证幂等。 */
export class KernelEventBus {
  private readonly handlers = new Set<
    (event: KernelEventEnvelope<string, unknown>) => void | Promise<void>
  >()

  subscribe(handler: (event: KernelEventEnvelope<string, unknown>) => void | Promise<void>) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  async publish(event: KernelEventEnvelope<string, unknown>): Promise<void> {
    for (const handler of this.handlers) await handler(event)
  }
}

/** 常驻 Outbox 发布循环；启动时立即恢复 pending，空闲时低频轮询。 */
export class KernelOutboxPublisher {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private stopped = true

  constructor(
    private readonly dispatcher: KernelOutboxDispatcher,
    private readonly options: { idlePollMs?: number; busyPollMs?: number; batchSize?: number } = {},
  ) {}

  start(scope: LifecycleScope): void {
    if (!this.stopped) return
    this.stopped = false
    scope.defer(() => this.stop())
    this.schedule(0)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 5))
  }

  /** 领域提交后可主动唤醒，避免等待下一次空闲轮询。 */
  wake(): void {
    if (this.stopped || this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.schedule(0)
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => void this.tick(), delayMs)
    this.timer.unref?.()
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) return
    this.running = true
    this.timer = null
    try {
      const result = await this.dispatcher.dispatchPending(this.options.batchSize ?? 100)
      this.schedule(
        result.published > 0 ? (this.options.busyPollMs ?? 10) : (this.options.idlePollMs ?? 500),
      )
    } catch (error) {
      logger.error(`Outbox 发布循环失败: ${error}`)
      this.schedule(this.options.idlePollMs ?? 500)
    } finally {
      this.running = false
    }
  }
}
