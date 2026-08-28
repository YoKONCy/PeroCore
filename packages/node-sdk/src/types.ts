import type {
  ApplicationIntegrationDescriptor,
  KernelCapabilityDefinition,
  KernelCapabilityOffer,
  KernelEnvelope,
  KernelNodeDescriptor,
  KernelNodeId,
} from '@infos/shared'

export type NodeInvocationState =
  | 'accepted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'

export interface NodeProviderManifest {
  manifestVersion: 1
  providerId: string
  name: string
  version: string
  definition: KernelCapabilityDefinition
  offer: Omit<KernelCapabilityOffer, 'provider' | 'placement' | 'health'>
  configurationSchema?: Readonly<Record<string, unknown>>
}

export interface NodeProviderContext {
  node: KernelNodeDescriptor
  signal: AbortSignal
  deadline?: string
  idempotencyKey?: string
  invocationId: string
}

export interface NodeProviderReceipt {
  invocationId: string
  providerId: string
  state: Extract<NodeInvocationState, 'completed' | 'failed' | 'cancelled' | 'timed_out'>
  acceptedAt: string
  startedAt: string
  completedAt: string
  output?: unknown
  error?: { code: string; message: string; retryable: boolean }
  evidence?: Readonly<Record<string, unknown>>
}

export interface NodeProvider {
  readonly manifest: NodeProviderManifest
  start?(context: { node: KernelNodeDescriptor }): Promise<void> | void
  health?():
    | Promise<'available' | 'degraded' | 'unavailable'>
    | 'available'
    | 'degraded'
    | 'unavailable'
  invoke(
    envelope: KernelEnvelope<{ operation: string; input: unknown }>,
    context: NodeProviderContext,
  ): Promise<unknown>
  cancel?(invocationId: string): Promise<void> | void
  stop?(): Promise<void> | void
}

export interface NodeInvokeRequest {
  protocolVersion: 1
  type: 'invoke'
  messageId: string
  invocationId: string
  sourceNodeId: KernelNodeId
  targetNodeId: KernelNodeId
  providerId: string
  envelope: KernelEnvelope<{ operation: string; input: unknown }>
}

export interface NodeCancelRequest {
  protocolVersion: 1
  type: 'cancel'
  messageId: string
  invocationId: string
  sourceNodeId: KernelNodeId
  targetNodeId: KernelNodeId
  reason?: string
}

export interface NodeHelloMessage {
  protocolVersion: 1
  type: 'hello'
  messageId: string
  supportedVersions?: number[]
  agreedVersion?: 1
  descriptor: KernelNodeDescriptor
  certificate?: NodeCertificate
  offers: KernelCapabilityOffer[]
  application?: ApplicationIntegrationDescriptor
}

export interface NodeReceiptMessage {
  protocolVersion: 1
  type: 'receipt'
  messageId: string
  invocationId: string
  sourceNodeId: KernelNodeId
  targetNodeId: KernelNodeId
  receipt: NodeProviderReceipt
}

export interface NodeErrorMessage {
  protocolVersion: 1
  type: 'error'
  messageId: string
  sourceNodeId?: KernelNodeId
  targetNodeId?: KernelNodeId
  invocationId?: string
  code: string
  message: string
}

export interface NodeTransferBeginMessage {
  protocolVersion: 1
  type: 'transfer.begin'
  messageId: string
  sourceNodeId: KernelNodeId
  targetNodeId: KernelNodeId
  manifest: {
    transferId: string
    byteLength: number
    chunkSize: number
    totalChunks: number
    sha256: string
  }
}

export interface NodeTransferChunkMessage {
  protocolVersion: 1
  type: 'transfer.chunk'
  messageId: string
  sourceNodeId: KernelNodeId
  targetNodeId: KernelNodeId
  chunk: { transferId: string; index: number; offset: number; base64: string; sha256: string }
}

export interface NodeTransferCompleteMessage {
  protocolVersion: 1
  type: 'transfer.complete'
  messageId: string
  sourceNodeId: KernelNodeId
  targetNodeId: KernelNodeId
  transferId: string
}

export interface NodeTransferReceiptMessage {
  protocolVersion: 1
  type: 'transfer.receipt'
  messageId: string
  sourceNodeId: KernelNodeId
  targetNodeId: KernelNodeId
  transferId: string
  nextMissingIndex: number
  completed: boolean
}

export type NodeTransportMessage =
  | NodeInvokeRequest
  | NodeCancelRequest
  | NodeHelloMessage
  | NodeReceiptMessage
  | NodeErrorMessage
  | NodeTransferBeginMessage
  | NodeTransferChunkMessage
  | NodeTransferCompleteMessage
  | NodeTransferReceiptMessage

export interface NodeTransport {
  readonly localNodeId: KernelNodeId
  request(message: NodeInvokeRequest, signal?: AbortSignal): Promise<NodeProviderReceipt>
  cancel(message: NodeCancelRequest): Promise<void>
  close(): Promise<void>
}

export interface NodePairingChallenge {
  challengeId: string
  codeHash: string
  expiresAt: string
  usedAt?: string
}

export interface NodePairingRequest {
  challengeId: string
  pairingCode: string
  descriptor: KernelNodeDescriptor
  publicKeyPem: string
  proof: string
}

export interface NodeCertificate {
  certificateId: string
  nodeId: KernelNodeId
  publicKeyFingerprint: string
  issuerNodeId: KernelNodeId
  trustEpoch: number
  issuedAt: string
  expiresAt: string
  signature: string
}

export interface NodeIdentityRecord {
  descriptor: KernelNodeDescriptor
  publicKeyPem: string
  privateKeyPem: string
  certificate?: NodeCertificate
}

export interface NodeAssetPayload {
  assetId: string
  mimeType: string
  byteLength: number
  sha256: string
  base64: string
}

export interface NodeAssetReceipt {
  assetId: string
  byteLength: number
  sha256: string
  verified: boolean
}
