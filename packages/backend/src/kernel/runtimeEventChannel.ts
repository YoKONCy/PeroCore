/**
 * runtimeEventChannel — 内核基础设施
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type { KernelObjectRef, KernelRuntimeEvent } from '@infos/shared'
import type { LifecycleScope } from './lifecycleScope'

export interface PublishRuntimeEventInput<TPayload> {
  runtimeRef: KernelObjectRef
  objectRef?: KernelObjectRef
  eventType: string
  executionId?: KernelRuntimeEvent['executionId']
  processId?: KernelRuntimeEvent['processId']
  correlationId?: string
  payload: TPayload
}

type RuntimeEventHandler = (event: KernelRuntimeEvent) => void | Promise<void>

interface RuntimeCursor {
  generation: number
  revision: number
  sequence: number
}

/** Runtime Object 的有界进程内事件通道。 */
export class RuntimeEventChannel {
  private readonly subscribers = new Set<RuntimeEventHandler>()
  private readonly cursors = new Map<string, RuntimeCursor>()

  subscribe(handler: RuntimeEventHandler, scope?: LifecycleScope): () => void {
    this.subscribers.add(handler)
    const dispose = () => {
      this.subscribers.delete(handler)
    }
    scope?.defer(dispose)
    return dispose
  }

  async publish<TPayload>(
    input: PublishRuntimeEventInput<TPayload>,
  ): Promise<KernelRuntimeEvent<TPayload>> {
    const key = `${input.runtimeRef.objectType}:${input.runtimeRef.objectId}`
    const previous = this.cursors.get(key)
    const generation = input.runtimeRef.generation
    const cursor: RuntimeCursor =
      !previous || previous.generation !== generation
        ? { generation, revision: 1, sequence: 1 }
        : {
            generation,
            revision: previous.revision + 1,
            sequence: previous.sequence + 1,
          }
    this.cursors.set(key, cursor)
    const event: KernelRuntimeEvent<TPayload> = Object.freeze({
      protocolVersion: 1,
      runtimeRef: { ...input.runtimeRef },
      objectRef: input.objectRef ? { ...input.objectRef } : undefined,
      eventType: input.eventType,
      generation,
      revision: cursor.revision,
      sequence: cursor.sequence,
      processId: input.processId,
      executionId: input.executionId,
      correlationId: input.correlationId,
      occurredAt: new Date().toISOString(),
      payload: structuredClone(input.payload),
    })
    await Promise.all([...this.subscribers].map((handler) => handler(event)))
    return event
  }

  get subscriberCount(): number {
    return this.subscribers.size
  }
}
