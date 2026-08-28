import { randomUUID } from 'node:crypto'
import type {
  KernelCallContext,
  KernelCarrier,
  KernelEnvelope,
  KernelEventEnvelope,
} from '@infos/shared'

/** 从统一调用上下文创建跨 Carrier 信封。 */
export function createKernelEnvelope<T>(input: {
  context: KernelCallContext
  operation: string
  payload: T
  carrier?: KernelCarrier
  durability?: 'durable' | 'ephemeral'
  object?: import('@infos/shared').KernelObjectRef
}): KernelEnvelope<T> {
  return {
    protocolVersion: 1,
    messageId: randomUUID(),
    correlationId: input.context.correlationId,
    causationId: input.context.causationId,
    principalId: input.context.principalId,
    processId: input.context.processId,
    executionId: input.context.executionId,
    object: input.object,
    operation: input.operation,
    capabilityHandleId: input.context.capabilityHandleId,
    sourceNodeId: input.context.sourceNodeId,
    targetNodeId: input.context.targetNodeId,
    route:
      input.context.sourceNodeId && input.context.targetNodeId
        ? {
            sourceNodeId: input.context.sourceNodeId,
            targetNodeId: input.context.targetNodeId,
            hopLimit: 8,
          }
        : undefined,
    deadline: input.context.deadline,
    idempotencyKey: input.context.idempotencyKey,
    emittedAt: new Date().toISOString(),
    durability: input.durability ?? 'ephemeral',
    carrier: input.carrier,
    payload: input.payload,
  }
}

/** 将 Durable/Ephemeral Event 适配为统一信封，不改变事件事实。 */
export function eventToKernelEnvelope<TType extends string, TPayload>(
  event: KernelEventEnvelope<TType, TPayload>,
  carrier: KernelCarrier = 'memory',
): KernelEnvelope<{ type: TType; eventId: string; payload: TPayload }> {
  return {
    protocolVersion: 1,
    messageId: event.eventId,
    correlationId: event.correlationId,
    causationId: event.causationId,
    principalId: event.principalId,
    processId: event.processId,
    executionId: event.executionId,
    object: event.object,
    operation: event.type,
    emittedAt: event.occurredAt,
    durability: event.durability,
    carrier,
    payload: { type: event.type, eventId: event.eventId, payload: event.payload },
  }
}

/** 在跨边界调用前统一执行 Deadline 检查。 */
export function assertKernelDeadline(context: KernelCallContext, now = Date.now()): void {
  if (context.deadline && Date.parse(context.deadline) <= now) {
    throw new Error('KERNEL_DEADLINE_EXCEEDED: 调用已超过截止时间')
  }
}
