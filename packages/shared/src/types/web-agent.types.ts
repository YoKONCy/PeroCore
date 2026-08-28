/**
 * web-agent.types — 跨包共享协议层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type { KernelObjectRef } from './kernel.types'

export type WebEvidenceKind = 'dom' | 'accessibility' | 'layout' | 'network' | 'vision'
export type WebTrustLevel =
  | 'trusted-user'
  | 'site-content'
  | 'third-party'
  | 'untrusted-instruction'
export type WebSideEffectClass =
  | 'read'
  | 'local-change'
  | 'external-change'
  | 'commit'
  | 'irreversible'

export interface WebInteractionHandle {
  handleId: string
  runtimeRef: KernelObjectRef
  pageRef: KernelObjectRef
  targetId?: string
  frameId?: string
  backendNodeId?: number
  documentGeneration: number
  snapshotId: string
  semanticFingerprint: string
  geometryFingerprint?: string
  accessibleFingerprint?: string
  selectorHint?: string
}

export interface WebSceneEvidence {
  kind: WebEvidenceKind
  ref?: string
  confidence: number
}

export interface WebSceneAffordance {
  operation: 'click' | 'type' | 'select' | 'check' | 'upload' | 'submit' | 'expand' | 'navigate'
  enabled: boolean
  risk: WebSideEffectClass
  preconditions: string[]
  expectedEffects: string[]
}

export interface WebSceneObject {
  objectId: string
  kind:
    | 'region'
    | 'form'
    | 'field'
    | 'button'
    | 'link'
    | 'list'
    | 'item'
    | 'dialog'
    | 'card'
    | 'table'
    | 'unknown'
  role: string
  name: string
  value?: string
  state: Readonly<Record<string, boolean | string | number | undefined>>
  trust: WebTrustLevel
  handle?: WebInteractionHandle
  parentObjectId?: string
  relatedObjectIds: string[]
  affordances: WebSceneAffordance[]
  evidence: WebSceneEvidence[]
  confidence: number
}

export interface WebInjectionFinding {
  findingId: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  category:
    | 'instruction-override'
    | 'secret-request'
    | 'unsafe-action'
    | 'hidden-content'
    | 'cross-origin'
  text: string
  sourceObjectId?: string
  trust: WebTrustLevel
}

export interface WebInteractionScene {
  sceneId: string
  pageRef: KernelObjectRef
  snapshotId: string
  url: string
  title: string
  intent?: string
  objects: WebSceneObject[]
  injectionFindings: WebInjectionFinding[]
  blockers: string[]
  createdAt: string
}

export interface WebExpectedEffect {
  kind: 'url' | 'content' | 'structure' | 'network' | 'dialog' | 'download' | 'object-state'
  matcher?: string
  required: boolean
}

export interface WebObservedEffect {
  kind: WebExpectedEffect['kind']
  summary: string
  evidenceRef?: string
  matched: boolean
}

export interface WebActionIntent {
  summary: string
  targetObjectId?: string
  origin: string
  sideEffect: WebSideEffectClass
  resourceSummary?: string
  reversible: boolean
  expectedEffects: WebExpectedEffect[]
}

export interface WebActionReceipt {
  receiptId: string
  actionId: string
  intent: WebActionIntent
  targetHandle?: WebInteractionHandle
  preSnapshotId: string
  postSnapshotId: string
  dispatchedInput: Readonly<Record<string, unknown>>
  observedEffects: WebObservedEffect[]
  verificationStatus: 'verified' | 'partially_verified' | 'unverified' | 'failed'
  evidenceRefs: string[]
  createdAt: string
  rollbackHint?: string
}

export interface WebSiteModel {
  modelId: string
  origin: string
  version: number
  pageKinds: string[]
  objectFingerprints: Record<string, string>
  successPatterns: string[]
  blockerPatterns: string[]
  updatedAt: string
}

export interface WebTaskCheckpoint {
  checkpointId: string
  origin: string
  intent: string
  sceneId: string
  completedObjectIds: string[]
  pendingObjectIds: string[]
  receiptIds: string[]
  createdAt: string
}
