/**
 * kernelProtocol — 跨包共享协议层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
export const KERNEL_PROTOCOL_VERSIONS = [1] as const
export type KernelProtocolVersion = (typeof KERNEL_PROTOCOL_VERSIONS)[number]

export interface KernelProtocolHello {
  type: 'protocol.hello'
  supportedVersions: number[]
  preferredVersion: number
  features?: string[]
}

export interface KernelProtocolAgreement {
  type: 'protocol.agreement'
  version: KernelProtocolVersion
  features: string[]
}

export function negotiateKernelProtocol(
  remoteVersions: readonly number[],
  localVersions: readonly KernelProtocolVersion[] = KERNEL_PROTOCOL_VERSIONS,
): KernelProtocolVersion {
  const common = localVersions.filter((version) => remoteVersions.includes(version))
  const selected = common.sort((left, right) => right - left)[0]
  if (!selected) throw new Error('KERNEL_PROTOCOL_VERSION_UNSUPPORTED')
  return selected
}

export function validateKernelEnvelope(
  value: unknown,
): asserts value is import('./types').KernelEnvelope {
  const envelope = object(value, 'KERNEL_ENVELOPE_INVALID')
  if (!KERNEL_PROTOCOL_VERSIONS.includes(envelope.protocolVersion as KernelProtocolVersion)) {
    throw new Error('KERNEL_PROTOCOL_VERSION_UNSUPPORTED')
  }
  requiredString(envelope.messageId, 'messageId')
  requiredString(envelope.principalId, 'principalId')
  requiredString(envelope.operation, 'operation')
  requiredString(envelope.emittedAt, 'emittedAt')
  if (Number.isNaN(Date.parse(String(envelope.emittedAt))))
    throw new Error('KERNEL_ENVELOPE_TIME_INVALID')
  if (!['ephemeral', 'durable'].includes(String(envelope.durability))) {
    throw new Error('KERNEL_ENVELOPE_DURABILITY_INVALID')
  }
  assertPayloadSize(envelope.payload)
}

export function validateKernelEventEnvelope(
  value: unknown,
): asserts value is import('./types').KernelEventEnvelope {
  const event = object(value, 'KERNEL_EVENT_INVALID')
  if (!KERNEL_PROTOCOL_VERSIONS.includes(event.protocolVersion as KernelProtocolVersion)) {
    throw new Error('KERNEL_PROTOCOL_VERSION_UNSUPPORTED')
  }
  requiredString(event.eventId, 'eventId')
  requiredString(event.type, 'type')
  requiredString(event.principalId, 'principalId')
  requiredString(event.occurredAt, 'occurredAt')
  if (Number.isNaN(Date.parse(String(event.occurredAt))))
    throw new Error('KERNEL_EVENT_TIME_INVALID')
  if (!['ephemeral', 'durable'].includes(String(event.durability))) {
    throw new Error('KERNEL_EVENT_DURABILITY_INVALID')
  }
  assertPayloadSize(event.payload)
}

export function validateSurfaceFrame(
  value: unknown,
): asserts value is import('./types').SurfaceFrame {
  const frame = object(value, 'SURFACE_FRAME_INVALID')
  if (!KERNEL_PROTOCOL_VERSIONS.includes(frame.protocolVersion as KernelProtocolVersion)) {
    throw new Error('KERNEL_PROTOCOL_VERSION_UNSUPPORTED')
  }
  requiredString(frame.surfaceId, 'surfaceId')
  requiredString(frame.generation, 'generation')
  requiredString(frame.operationId, 'operationId')
  if (!Number.isInteger(frame.revision) || Number(frame.revision) < 0) {
    throw new Error('SURFACE_FRAME_REVISION_INVALID')
  }
  if (!Number.isInteger(frame.sequence) || Number(frame.sequence) < 0) {
    throw new Error('SURFACE_FRAME_SEQUENCE_INVALID')
  }
  const operation = object(frame.operation, 'SURFACE_OPERATION_INVALID')
  requiredString(operation.type, 'operation.type')
  if (!String(operation.type).startsWith('surface.')) throw new Error('SURFACE_OPERATION_INVALID')
  assertPayloadSize(frame.operation)
}

export function validateVersionedMessage(value: unknown): {
  protocolVersion: KernelProtocolVersion
} {
  const message = object(value, 'PROTOCOL_MESSAGE_INVALID')
  if (!KERNEL_PROTOCOL_VERSIONS.includes(message.protocolVersion as KernelProtocolVersion)) {
    throw new Error('KERNEL_PROTOCOL_VERSION_UNSUPPORTED')
  }
  return message as unknown as { protocolVersion: KernelProtocolVersion }
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): void {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`PROTOCOL_FIELD_INVALID: ${field}`)
}

function assertPayloadSize(value: unknown): void {
  const bytes = new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength
  if (bytes > 8 * 1024 * 1024) throw new Error('PROTOCOL_PAYLOAD_TOO_LARGE')
}
