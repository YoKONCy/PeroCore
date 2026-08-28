/**
 * node.types — 跨包共享协议层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type { KernelObjectRef } from './kernel.types'

export type KernelNodeId = string & { readonly __kernelBrand: 'KernelNodeId' }
export type KernelNodeSessionId = string & { readonly __kernelBrand: 'KernelNodeSessionId' }
export type KernelInputSeatId = string & { readonly __kernelBrand: 'KernelInputSeatId' }

export type KernelNodeFacet =
  | 'application'
  | 'server'
  | 'client'
  | 'capability'
  | 'storage'
  | 'compute'
  | 'gateway'
  | 'device'
  | 'scheduler'

export type KernelNodeTrust = 'local' | 'paired' | 'managed' | 'untrusted'
export type KernelNodeHealth = 'joining' | 'online' | 'degraded' | 'offline'
export type KernelExecutionPlacement =
  | 'server-local'
  | 'client-local'
  | 'node-local'
  | 'remote-capability-node'
  | 'any-trusted-node'

export type KernelDataResidency =
  | 'node-only'
  | 'device-only'
  | 'trusted-nodes'
  | 'server-authority'
  | 'unrestricted'

export interface KernelNodePlatform {
  os: 'windows' | 'linux' | 'macos' | 'android' | 'ios' | 'web' | 'unknown'
  arch?: string
  runtime: 'node' | 'bun' | 'electron' | 'tauri' | 'browser' | 'native' | 'unknown'
  version?: string
}

/** 稳定 Node 身份与静态能力描述；不表示当前连接。 */
export interface KernelNodeDescriptor {
  nodeId: KernelNodeId
  displayName: string
  facets: readonly KernelNodeFacet[]
  trust: KernelNodeTrust
  platform: KernelNodePlatform
  protocolVersion: 1
  publicKeyFingerprint?: string
  labels?: Readonly<Record<string, string>>
  registeredAt: string
}

/** 一次 Transport 连接；Session 与稳定 Node Identity 分离。 */
export interface KernelNodeSession {
  sessionId: KernelNodeSessionId
  nodeId: KernelNodeId
  /** Transport 层连接标识，不得作为稳定 Node Identity。 */
  connectionId: string
  /** 同一 Node 重连时严格递增，用于拒绝旧连接和旧租约。 */
  generation: number
  /** @deprecated 使用 generation。 */
  connectionGeneration: number
  carrier: 'memory' | 'websocket' | 'http' | 'electron-ipc' | 'mcp'
  connectedAt: string
  lastSeenAt: string
  leaseExpiresAt: string
  health: KernelNodeHealth
}

/** 对外统一命名；保留 Kernel 前缀类型作为现有运行时的规范实现。 */
export type NodeDescriptor = KernelNodeDescriptor
export type NodeSession = KernelNodeSession

export interface KernelNodePlacement {
  providerNodeId: KernelNodeId
  providerFacet: KernelNodeFacet
  executionLocation: KernelExecutionPlacement
  resourceAuthorityNodeId?: KernelNodeId
  requiresClientPresence?: boolean
  requiresInputSeat?: boolean
  supportsHeadless?: boolean
  dataResidency?: KernelDataResidency
  networkZone?: string
  platforms?: readonly KernelNodePlatform['os'][]
  latencyClass?: 'local' | 'lan' | 'wan' | 'batch'
  costClass?: 'free' | 'metered' | 'expensive'
  leaseExpiresAt?: string
}

export interface KernelPlacementRequirement {
  executionLocations?: readonly KernelExecutionPlacement[]
  providerFacets?: readonly KernelNodeFacet[]
  preferredNodeId?: KernelNodeId
  authorityNodeId?: KernelNodeId
  requiresClientPresence?: boolean
  requiresInputSeat?: boolean
  supportsHeadless?: boolean
  dataResidency?: KernelDataResidency
  networkZone?: string
  platforms?: readonly KernelNodePlatform['os'][]
  maxLatencyClass?: KernelNodePlacement['latencyClass']
  maxCostClass?: KernelNodePlacement['costClass']
  minimumTrust?: KernelNodeTrust
}

/** 当前可接收用户输入、审批与客户端 Surface 的租约。 */
export interface KernelInputSeat {
  seatId: KernelInputSeatId
  nodeId: KernelNodeId
  principalId: string
  sessionId: KernelNodeSessionId
  windowId: string
  epoch: number
  issuedAt: string
  leaseExpiresAt: string
  capabilities: readonly ('surface' | 'approval' | 'file-picker' | 'input' | 'audio-output')[]
}

/** 跨节点投递使用的最小 Input Seat 租约契约。 */
export interface InputSeatLease {
  seatId: KernelInputSeatId
  principalId: string
  nodeId: KernelNodeId
  sessionGeneration: number
  acquiredAt: string
  lastActiveAt: string
  leaseUntil: string
}

/** 对象权威位置；Replica 只用于路由提示，不授予写权限。 */
export interface KernelResourceAuthority {
  object: KernelObjectRef
  authorityNodeId: KernelNodeId
  authorityEpoch: number
  writable: boolean
  replicaNodeIds?: readonly KernelNodeId[]
  leaseExpiresAt?: string
  updatedAt: string
}

export interface KernelNodeRoute {
  sourceNodeId: KernelNodeId
  targetNodeId: KernelNodeId
  viaNodeIds?: readonly KernelNodeId[]
  hopLimit: number
}
