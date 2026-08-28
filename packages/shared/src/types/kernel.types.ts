/**
 * infOS 逻辑微内核共享协议。
 *
 * 这些类型只描述跨边界身份与约束，不拥有任何领域数据。
 */

import type {
  KernelNodeId,
  KernelNodePlacement,
  KernelNodeRoute,
  KernelPlacementRequirement,
} from './node.types'

/** 跨边界不可混用的品牌化标识。 */
export type KernelId<Brand extends string> = string & { readonly __kernelBrand: Brand }

export type KernelObjectId = KernelId<'KernelObjectId'>
export type KernelExecutionId = KernelId<'KernelExecutionId'>
export type KernelProcessId = KernelId<'KernelProcessId'>
export type KernelEventId = KernelId<'KernelEventId'>
export type KernelCapabilityId = KernelId<'KernelCapabilityId'>

/** 可寻址资源的稳定引用；generation 防止旧句柄操作新实例。 */
export interface KernelObjectRef {
  objectType: string
  objectId: KernelObjectId
  generation: number
  ownerPrincipalId: string
  /** 对象写入与 Generation 的权威 Node；迁移期允许旧单机对象省略。 */
  authorityNodeId?: KernelNodeId
  authorityEpoch?: number
  replicaNodeIds?: readonly KernelNodeId[]
}

export type KernelExecutionClass =
  | 'interactive'
  | 'foreground'
  | 'background'
  | 'resident'
  | 'maintenance'
  | 'realtime'

export type KernelExecutionState =
  | 'created'
  | 'queued'
  | 'running'
  | 'waiting_io'
  | 'waiting_approval'
  | 'suspended'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'

export type KernelExecutionWaitReason =
  | 'scheduler_capacity'
  | 'class_capacity'
  | 'resource_locked'
  | 'backpressure'
  | 'io'
  | 'approval'
  | 'paused'

export interface KernelExecutionUsage {
  llmCalls: number
  inputTokens: number
  outputTokens: number
  toolCalls: number
  concurrentIo: number
}

export interface KernelExecutionSnapshot {
  descriptor: KernelExecutionDescriptor
  state: KernelExecutionState
  waitReason?: KernelExecutionWaitReason
  usage: KernelExecutionUsage
  queuedAt: string
  startedAt?: string
  completedAt?: string
}

export interface KernelExecutionBudget {
  maxDurationMs?: number
  maxLlmCalls?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  maxToolCalls?: number
  maxConcurrentIo?: number
}

/** 一次具体运行的身份与资源约束。 */
export interface KernelExecutionDescriptor {
  executionId: KernelExecutionId
  processId: KernelProcessId
  principalId: string
  taskId?: string
  parentExecutionId?: KernelExecutionId
  threadId?: string
  channel?: string
  class: KernelExecutionClass
  priority: number
  deadline?: string
  budget: KernelExecutionBudget
}

export interface KernelExitStatus {
  state: Extract<KernelExecutionState, 'completed' | 'failed' | 'cancelled' | 'timed_out'>
  code: string
  message?: string
  completedAt: string
}

export type KernelCapabilityRisk = 'read' | 'interact' | 'elevated' | 'root'

export interface KernelCapabilityOperationDefinition {
  inputSchema?: Readonly<Record<string, unknown>>
  outputSchema?: Readonly<Record<string, unknown>>
  risk: KernelCapabilityRisk
  idempotency: 'safe' | 'keyed' | 'unsafe'
}

export interface KernelCapabilityDefinition {
  capabilityType: string
  contractVersion: string
  operations: Readonly<Record<string, KernelCapabilityOperationDefinition>>
}

export interface KernelCapabilityOffer {
  offerId: string
  provider: KernelObjectRef
  capabilityType: string
  contractVersion: string
  operations: readonly string[]
  resourceKinds: readonly string[]
  health: 'starting' | 'available' | 'degraded' | 'unavailable'
  placement?: KernelNodePlacement
  constraints?: Readonly<Record<string, unknown>>
  /** Offer 租约到期时间；远程 Provider 必须通过心跳续租。 */
  leaseExpiresAt?: string
}

export interface KernelCapabilityRequirement {
  requirementId: string
  capabilityType: string
  contractVersion: string
  operations: readonly string[]
  required: boolean
  binding: 'eager' | 'lazy'
  cardinality: 'one' | 'many'
  placement?: KernelPlacementRequirement
  constraints?: Readonly<Record<string, unknown>>
}

/** 对一个资源对象的可收窄、可撤销访问权。 */
export interface KernelCapabilityHandle {
  handleId: KernelCapabilityId
  subjectId: string
  issuerNodeId?: KernelNodeId
  subjectNodeId?: KernelNodeId
  providerNodeId?: KernelNodeId
  revocationEpoch?: number
  resource: KernelObjectRef
  operations: readonly string[]
  scope?: Readonly<Record<string, unknown>>
  parentHandleId?: KernelCapabilityId
  issuedAt: string
  expiresAt?: string
  revocable: boolean
}

export type KernelEventDurability = 'durable' | 'ephemeral'
export type KernelCarrier = 'memory' | 'http' | 'sse' | 'websocket' | 'electron-ipc' | 'mcp'

/** 业务消息必须声明的投递受众，禁止用 Transport 连接集合表达业务范围。 */
export type DeliveryAudience =
  | { type: 'active_input_seat'; principalId: string }
  | { type: 'all_principal_clients'; principalId: string }
  | { type: 'specific_node'; nodeId: KernelNodeId }
  | { type: 'thread_subscribers'; threadId: string }
  | { type: 'execution_subscribers'; executionId: KernelExecutionId }

/** Durable Stream 的消费位置；sequence 表示已成功应用的最后事件。 */
export interface DurableStreamCursor {
  streamId: string
  consumerId: string
  sequence: number
  updatedAt: string
}

/** Cursor 落后于保留底线时用于恢复 Projection 的快照。 */
export interface DurableStreamSnapshot {
  streamId: string
  snapshotId: string
  sequence: number
  revision: number
  createdAt: string
  payload: unknown
}

export interface DurableStreamDescriptor {
  streamId: string
  retentionFloor: number
  latestSequence: number
  snapshot?: Omit<DurableStreamSnapshot, 'payload'>
}

/** 跨 Transport 共用的调用上下文。 */
export interface KernelCallContext {
  principalId: string
  processId?: KernelProcessId
  executionId?: KernelExecutionId
  capabilityHandleId?: KernelCapabilityId
  sourceNodeId?: KernelNodeId
  targetNodeId?: KernelNodeId
  correlationId: string
  causationId?: string
  deadline?: string
  idempotencyKey?: string
}

/** 跨边界统一结构化错误。 */
export interface KernelError {
  code: string
  message: string
  retryable: boolean
  details?: Readonly<Record<string, unknown>>
}

/** Carrier 只负责运输；高层调用统一使用此信封。 */
export interface KernelEnvelope<TPayload = unknown> {
  protocolVersion: 1
  messageId: string
  correlationId?: string
  causationId?: string
  principalId: string
  processId?: KernelProcessId
  executionId?: KernelExecutionId
  object?: KernelObjectRef
  operation: string
  capabilityHandleId?: KernelCapabilityId
  sourceNodeId?: KernelNodeId
  targetNodeId?: KernelNodeId
  route?: KernelNodeRoute
  deadline?: string
  idempotencyKey?: string
  emittedAt: string
  durability: KernelEventDurability
  /** 业务投递必须显式声明；仅握手、心跳和点对点响应可省略。 */
  audience?: DeliveryAudience
  /** Durable Stream 内严格递增；Ephemeral 消息不得依赖该字段恢复。 */
  sequence?: number
  carrier?: KernelCarrier
  payload: TPayload
}

/** 所有领域事件共享的因果信封；payload 必须由具体领域类型约束。 */
export interface KernelEventEnvelope<TType extends string = string, TPayload = unknown> {
  protocolVersion: 1
  eventId: KernelEventId
  type: TType
  durability: KernelEventDurability
  principalId: string
  processId?: KernelProcessId
  executionId?: KernelExecutionId
  correlationId?: string
  causationId?: KernelEventId
  object?: KernelObjectRef
  occurredAt: string
  payload: TPayload
}

export type KernelExecutionEvent = KernelEventEnvelope<
  | 'kernel.execution.created'
  | 'kernel.execution.started'
  | 'kernel.execution.completed'
  | 'kernel.execution.failed'
  | 'kernel.execution.cancelled'
  | 'kernel.execution.timed_out'
  | 'kernel.execution.state_changed',
  {
    descriptor?: KernelExecutionDescriptor
    state: KernelExecutionState
    waitReason?: KernelExecutionWaitReason
    usage?: KernelExecutionUsage
    exitStatus?: KernelExitStatus
  }
>

export type ConversationKernelEvent = KernelEventEnvelope<
  'conversation.message.committed',
  {
    threadId: string
    messageId: number
    pairId?: string
    role: 'user' | 'assistant' | 'system' | 'tool'
    status: string
  }
>

export type KernelEvent = KernelExecutionEvent | ConversationKernelEvent

/** 与领域写入同事务追加到 Outbox 的事件输入。 */
export type KernelOutboxEventInput = Omit<
  KernelEventEnvelope<string, unknown>,
  'eventId' | 'occurredAt'
> & {
  eventId?: KernelEventId
  occurredAt?: string
}
