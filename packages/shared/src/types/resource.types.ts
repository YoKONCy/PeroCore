/**
 * resource.types — 跨包共享协议层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type {
  KernelExecutionId,
  KernelObjectId,
  KernelObjectRef,
  KernelProcessId,
} from './kernel.types'

export type KernelAssetId = string & { readonly __kernelBrand: 'KernelAssetId' }
export type KernelFileHandleId = string & { readonly __kernelBrand: 'KernelFileHandleId' }
export type KernelTransferId = string & { readonly __kernelBrand: 'KernelTransferId' }
export type KernelCredentialId = string & { readonly __kernelBrand: 'KernelCredentialId' }
export type KernelCredentialHandleId = string & {
  readonly __kernelBrand: 'KernelCredentialHandleId'
}

export interface KernelAssetObject {
  assetId: KernelAssetId
  ref: KernelObjectRef
  kind: string
  mimeType: string
  sizeBytes: number
  sha256: string
  source: 'user' | 'runtime' | 'package' | 'remote' | 'generated'
  createdAt: string
  retention: 'temporary' | 'session' | 'persistent'
}

export type KernelFileOperation = 'read' | 'upload' | 'export'

export interface KernelFileHandle {
  handleId: KernelFileHandleId
  subjectId: string
  assetRef: KernelObjectRef
  operations: readonly KernelFileOperation[]
  issuedAt: string
  expiresAt?: string
  maxUses?: number
  remainingUses?: number
  mimeScope?: readonly string[]
  sizeLimit?: number
  executionId?: KernelExecutionId
  revokedAt?: string
}

export type KernelTransferDirection = 'upload' | 'download' | 'copy' | 'import' | 'export'
export type KernelTransferState =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface KernelTransferObject {
  transferId: KernelTransferId
  ref: KernelObjectRef
  direction: KernelTransferDirection
  sourceRef?: KernelObjectRef
  destinationRef?: KernelObjectRef
  state: KernelTransferState
  bytesTotal?: number
  bytesTransferred: number
  checksum?: string
  resultAssetRef?: KernelObjectRef
  principalId: string
  processId?: KernelProcessId
  executionId?: KernelExecutionId
  correlationId: string
  error?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
}

export interface KernelRuntimeEvent<TPayload = unknown> {
  protocolVersion: 1
  runtimeRef: KernelObjectRef
  objectRef?: KernelObjectRef
  eventType: string
  generation: number
  revision: number
  sequence: number
  processId?: KernelProcessId
  executionId?: KernelExecutionId
  correlationId?: string
  occurredAt: string
  payload: TPayload
}

export interface KernelCredentialObject {
  credentialId: KernelCredentialId
  ref: KernelObjectRef
  kind: string
  originScope?: readonly string[]
  audience?: readonly string[]
  operations: readonly string[]
  createdAt: string
  expiresAt?: string
  revokedAt?: string
}

export interface KernelCredentialHandle {
  handleId: KernelCredentialHandleId
  credentialRef: KernelObjectRef
  subjectId: string
  operations: readonly string[]
  originScope?: readonly string[]
  audience?: readonly string[]
  issuedAt: string
  expiresAt?: string
  maxUses?: number
  remainingUses?: number
  executionId?: KernelExecutionId
  revokedAt?: string
}

export function createResourceObjectRef(
  objectType: string,
  objectId: string,
  ownerPrincipalId: string,
  generation = 1,
): KernelObjectRef {
  return {
    objectType,
    objectId: objectId as KernelObjectId,
    ownerPrincipalId,
    generation,
  }
}
