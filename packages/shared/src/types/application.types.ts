/**
 * application.types — 跨包共享协议层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type { KernelExecutionId } from './kernel.types'
import type { KernelNodeId } from './node.types'
import type { ToolDisplayMeta } from './package.types'

export type ApplicationEndpointKind =
  | 'command'
  | 'query'
  | 'task'
  | 'event'
  | 'resource'
  | 'session'
  | 'agent'
  | 'surface'

export type ApplicationLifecycleState =
  | 'starting'
  | 'ready'
  | 'disconnected_from_kernel'
  | 'suspended'
  | 'stopping'
  | 'stopped'
  | 'failed'

export interface ApplicationAddress {
  nodeId: KernelNodeId
  appId: string
  instanceId: string
  endpoint?: string
  sessionId?: string
}

export interface ApplicationEndpointDescriptor {
  endpointId: string
  kind: ApplicationEndpointKind
  operations: readonly string[]
  version: string
}

export interface ApplicationIntegrationDescriptor {
  protocolVersion: 1
  appId: string
  instanceId: string
  name: string
  appVersion: string
  adapterVersion: string
  state: ApplicationLifecycleState
  endpoints: readonly ApplicationEndpointDescriptor[]
}

export interface ApplicationEnvelope<T = unknown> {
  protocolVersion: 1
  messageId: string
  correlationId: string
  causationId?: string
  source: ApplicationAddress
  target: ApplicationAddress
  operation: string
  mode: 'request' | 'response' | 'event' | 'stream'
  payload: T
  capabilityHandleId?: string
  deadline?: string
  idempotencyKey?: string
  trace?: { executionId?: KernelExecutionId; taskId?: string }
}

export type ApplicationTaskState =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface ApplicationTaskAccepted {
  accepted: true
  taskId: string
  acceptedAt: string
}

export interface ApplicationTaskSnapshot<TResult = unknown> {
  taskId: string
  appId: string
  instanceId: string
  operation: string
  state: ApplicationTaskState
  progress?: number
  stage?: string
  executionId?: KernelExecutionId
  result?: TResult
  error?: { code: string; message: string; retryable: boolean }
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface ApplicationDiscoveryRecord {
  protocolVersion: 1
  applicationProtocolVersion: 1
  application: ApplicationIntegrationDescriptor
  nodeId: KernelNodeId
  pid: number
  generation: number
  carrier: 'websocket'
  endpoint: string
  startedAt: string
}

export interface ApplicationCapabilityRequirement {
  capabilityType: string
  contractVersion: string
  operations: readonly string[]
  required: boolean
  reason: string
}

/** Application 对主应用、其他 Application 或 Kernel 发布的版本化能力。 */
export interface ApplicationCapabilityOffer {
  capabilityType: string
  contractVersion: string
  endpointId: string
  operations: readonly string[]
  description?: string
}

/** 将在线 Application Operation 投影为主 Agent 可调用工具。 */
export interface ApplicationToolProjection {
  name: string
  endpointId: string
  operation: string
  audience: 'host_agent'
  availability: 'while_ready'
  invocation: 'invoke' | 'submit_task' | 'open_session'
  description: string
  parameters: Record<string, unknown>
  display?: ToolDisplayMeta
  requiresApproval?: boolean
}

export interface ApplicationAdapterManifest {
  manifestVersion: 1
  id: string
  name: string
  description: string
  adapterVersion: string
  protocolVersion: 1
  application: {
    versions: string
    transports: readonly ('websocket' | 'stdio' | 'http' | 'mcp')[]
  }
  backend?: { entry: string }
  frontend?: {
    entry: string
    surfaces: readonly ApplicationSurfaceDeclaration[]
  }
  endpoints: readonly ApplicationEndpointDescriptor[]
  /** Application 向外发布的能力；必须绑定到已声明 Endpoint。 */
  offeredCapabilities: readonly ApplicationCapabilityOffer[]
  /** 仅显式列出的在线 Operation 会成为主 Agent Tool。 */
  toolProjections?: readonly ApplicationToolProjection[]
  /** Application 向 Kernel 请求的反向能力。 */
  requestedCapabilities: readonly ApplicationCapabilityRequirement[]
}

export type ApplicationSurfaceSlot = 'main.tab' | 'side.panel' | 'task.detail' | 'settings'

export interface ApplicationSurfaceDeclaration {
  surfaceId: string
  title: string
  slot: ApplicationSurfaceSlot
  icon?: string
}

export interface PersonaProjection {
  agentId: string
  version: string
  displayName: string
  persona: string
  ownerAppellation: string
  channelPatch?: string
  traits?: readonly string[]
}

export interface ApplicationKnowledgeHit {
  resourceId: string
  content: string
  summary: string
  score: number
  type: string
  provenance?: unknown
}

export interface ApplicationModelRequest {
  messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[]
  temperature?: number
  maxTokens?: number
}

export interface ApplicationModelResult {
  content: string
  finishReason?: string | null
  usage?: { inputTokens?: number; outputTokens?: number }
}
