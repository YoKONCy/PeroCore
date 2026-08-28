import type { KernelEventEnvelope } from '@infos/shared'
import type { KernelEventBus } from '../kernel/kernelOutboxPublisher'
import { createLogger } from '../lib/logger'
import type { AgentStateMeasurement, AgentStateRepository } from './agentStateRepository'

const logger = createLogger('ObserverService')

/** Durable Event异步观察器；只产生测量，不修改事件和Agent生成链。 */
export class ObserverService {
  private readonly queue: KernelEventEnvelope<string, unknown>[] = []
  private processing = false
  private unsubscribe?: () => void
  private idleResolvers: Array<() => void> = []

  constructor(
    private readonly repository: AgentStateRepository,
    private readonly analyzer: ObserverAnalyzer = new DeterministicObserverAnalyzer(),
  ) {}

  start(bus: KernelEventBus): void {
    if (this.unsubscribe) return
    this.unsubscribe = bus.subscribe((event) => {
      this.queue.push(structuredClone(event))
      this.schedule()
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  async waitForIdle(): Promise<void> {
    if (!this.processing && this.queue.length === 0) return
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve))
  }

  private schedule(): void {
    if (this.processing) return
    this.processing = true
    setTimeout(() => void this.drain(), 0).unref?.()
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const event = this.queue.shift()!
      try {
        const policy = await this.repository.getPolicy(event.principalId)
        if (!policy.enabled) continue
        const measurements = await this.analyzer.measure(event)
        await this.repository.commitEvent(event, measurements)
      } catch (error) {
        logger.warn(`Observer处理事件失败: event=${event.eventId}, error=${error}`)
      }
    }
    this.processing = false
    this.idleResolvers.splice(0).forEach((resolve) => resolve())
  }
}

export interface ObserverAnalyzer {
  measure(
    event: KernelEventEnvelope<string, unknown>,
  ): Promise<ObserverMeasurementInput[]> | ObserverMeasurementInput[]
}

type ObserverMeasurementInput = Omit<
  AgentStateMeasurement,
  'id' | 'sourceEventId' | 'sourceEventType' | 'observedAt'
>

/** 不调用LLM的确定性基础测量器，避免Observer反向占用生成资源。 */
export class DeterministicObserverAnalyzer implements ObserverAnalyzer {
  measure(event: KernelEventEnvelope<string, unknown>): ObserverMeasurementInput[] {
    const payload = event.payload as Record<string, unknown>
    const measurements: ObserverMeasurementInput[] = []
    if (event.type.startsWith('kernel.execution.')) {
      const state = String(payload.state ?? '')
      if (['completed', 'failed', 'cancelled', 'timed_out'].includes(state)) {
        measurements.push({
          agentId: event.principalId,
          metric: 'execution_reliability',
          value: state === 'completed' ? 1 : 0,
          confidence: 1,
          explanation: `Execution终态: ${state}`,
        })
      }
      const usage = payload.usage as Record<string, unknown> | undefined
      if (usage && typeof usage.llmCalls === 'number') {
        measurements.push({
          agentId: event.principalId,
          metric: 'llm_workload',
          value: Math.min(1, usage.llmCalls / 10),
          confidence: 0.8,
          explanation: `LLM调用次数: ${usage.llmCalls}`,
        })
      }
    } else if (event.type === 'conversation.message.committed') {
      measurements.push({
        agentId: event.principalId,
        metric: 'conversation_engagement',
        value: 1,
        confidence: 0.7,
        explanation: `提交${String(payload.role ?? 'unknown')}消息`,
      })
    } else if (event.type === 'social.message.committed') {
      measurements.push({
        agentId: event.principalId,
        metric: 'social_engagement',
        value: 1,
        confidence: 0.7,
        explanation: '提交Social消息',
      })
    }
    return measurements
  }
}
