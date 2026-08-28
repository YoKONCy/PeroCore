import type { KernelError, KernelNodeId } from '@infos/shared'

export type DocumentId = string & { readonly __documentBrand: 'DocumentId' }
export type DocumentNodeId = string & { readonly __documentBrand: 'DocumentNodeId' }
export type OperationId = string & { readonly __documentBrand: 'OperationId' }
export type RevisionId = string & { readonly __documentBrand: 'RevisionId' }
export type ChangeSetId = string & { readonly __documentBrand: 'ChangeSetId' }
export type ReviewId = string & { readonly __documentBrand: 'ReviewId' }
export type ReceiptId = string & { readonly __documentBrand: 'ReceiptId' }
export type SnapshotId = string & { readonly __documentBrand: 'SnapshotId' }
export type CommentId = string & { readonly __documentBrand: 'CommentId' }
export type CollaborationBatchId = string & { readonly __documentBrand: 'CollaborationBatchId' }

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type DocumentNodeType =
  | 'document-root'
  | 'section'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'list-item'
  | 'quote'
  | 'code-block'
  | 'asset'
  | 'table'
  | 'table-row'
  | 'table-cell'
  | 'citation'
  | 'programmable-island'

export interface SemanticDocument {
  documentId: DocumentId
  generation: number
  authorityNodeId: KernelNodeId
  authorityEpoch: number
  ownerPrincipalId: string
  title: string
  language: string
  kind: 'article'
  rootNodeId: DocumentNodeId
  headRevisionId: RevisionId
  status: 'active' | 'archived' | 'deleted'
  metadata: Record<string, JsonValue>
  createdAt: string
  updatedAt: string
}

export interface DocumentSourcePosition {
  offset: number
  line: number
  column: number
}

export interface DocumentSourceRange {
  start: DocumentSourcePosition
  end: DocumentSourcePosition
}

export type InlineNode =
  | { type: 'text'; value: string; sourceRange?: DocumentSourceRange }
  | {
      type: 'emphasis' | 'strong' | 'delete'
      children: InlineNode[]
      sourceRange?: DocumentSourceRange
    }
  | { type: 'code'; value: string; sourceRange?: DocumentSourceRange }
  | {
      type: 'link'
      href: string
      title?: string
      children: InlineNode[]
      sourceRange?: DocumentSourceRange
    }
  | {
      type: 'citation'
      sourceId: string
      locator?: string
      label: string
      sourceRange?: DocumentSourceRange
    }
  | { type: 'line-break'; sourceRange?: DocumentSourceRange }

export interface ProgrammableIslandDescriptor {
  runtime: 'worker' | 'iframe' | 'wasm'
  sourceBlobId: string
  sourceHash: string
  entrypoint: string
  permissions: readonly ('render' | 'input' | 'storage')[]
  network: 'none'
  status: 'declared' | 'blocked' | 'ready'
}

export interface DocumentNode {
  nodeId: DocumentNodeId
  documentId: DocumentId
  type: DocumentNodeType
  parentId: DocumentNodeId | null
  orderKey: string
  generation: number
  text?: string
  attributes: Record<string, JsonValue>
  createdAt: string
  updatedAt: string
}

export interface NewDocumentNode {
  nodeId: DocumentNodeId
  type: Exclude<DocumentNodeType, 'document-root'>
  parentId: DocumentNodeId
  orderKey: string
  text?: string
  attributes?: Record<string, JsonValue>
}

export interface DocumentOperationBase {
  operationId: OperationId
  documentId: DocumentId
  actorPrincipalId: string
  baseRevisionId: RevisionId
  timestamp: string
  causationId?: string
  correlationId?: string
}

export type DocumentOperation =
  | (DocumentOperationBase & {
      type: 'node.insert'
      node: NewDocumentNode
      parentGeneration: number
    })
  | (DocumentOperationBase & {
      type: 'node.delete'
      nodeId: DocumentNodeId
      expectedGeneration: number
      recursive: boolean
    })
  | (DocumentOperationBase & {
      type: 'node.move'
      nodeId: DocumentNodeId
      expectedGeneration: number
      newParentId: DocumentNodeId
      newOrderKey: string
      newParentGeneration: number
    })
  | (DocumentOperationBase & {
      type: 'text.replace'
      nodeId: DocumentNodeId
      expectedGeneration: number
      value: string
    })
  | (DocumentOperationBase & {
      type: 'attribute.set'
      nodeId: DocumentNodeId
      expectedGeneration: number
      key: string
      value?: JsonValue
    })
  | (DocumentOperationBase & {
      type: 'document.rename'
      value: string
    })

export interface DocumentTransactionRequest {
  transactionId: string
  documentId: DocumentId
  actorPrincipalId: string
  baseRevisionId: RevisionId
  operations: DocumentOperation[]
  intent: string
  idempotencyKey: string
  expectedEffects?: string[]
}

export interface DocumentRevision {
  revisionId: RevisionId
  documentId: DocumentId
  sequence: number
  parentRevisionIds: RevisionId[]
  operationIds: OperationId[]
  actorPrincipalId: string
  intent: string
  rootHash: string
  committedAt: string
}

export type DocumentObservedEffect =
  | { type: 'node-created'; nodeId: DocumentNodeId; parentId: DocumentNodeId }
  | { type: 'node-deleted'; nodeId: DocumentNodeId; parentId: DocumentNodeId | null }
  | {
      type: 'node-moved'
      nodeId: DocumentNodeId
      previousParentId: DocumentNodeId
      parentId: DocumentNodeId
    }
  | { type: 'text-changed'; nodeId: DocumentNodeId }
  | { type: 'attribute-changed'; nodeId: DocumentNodeId; key: string }
  | { type: 'document-renamed'; previousTitle: string; title: string }

export interface DocumentCommitReceipt {
  receiptId: ReceiptId
  transactionId: string
  documentId: DocumentId
  previousRevisionId: RevisionId
  revisionId: RevisionId
  operationIds: OperationId[]
  actorPrincipalId: string
  status: 'committed' | 'rejected' | 'conflicted' | 'failed'
  observedEffects: DocumentObservedEffect[]
  rootHash?: string
  committedAt?: string
  error?: KernelError
}

export interface DocumentJournalEntry {
  sequence: number
  revision: DocumentRevision
  operations: DocumentOperation[]
  receipt: DocumentCommitReceipt
}

export type DocumentChangeSetStatus =
  | 'draft'
  | 'proposed'
  | 'validated'
  | 'approved'
  | 'committed'
  | 'rejected'
  | 'conflicted'
  | 'superseded'
  | 'failed'

export interface DocumentChangeSet {
  changeSetId: ChangeSetId
  documentId: DocumentId
  baseRevisionId: RevisionId
  actorPrincipalId: string
  actorKind: 'human' | 'agent' | 'importer' | 'formatter' | 'migration'
  intent: string
  explanation: string
  operations: DocumentOperation[]
  expectedEffects: string[]
  risk: 'low' | 'medium' | 'high' | 'executable'
  status: DocumentChangeSetStatus
  createdAt: string
  updatedAt: string
}

export interface DocumentReview {
  reviewId: ReviewId
  changeSetId: ChangeSetId
  reviewerPrincipalId: string
  decision: 'approve' | 'reject' | 'request_changes'
  message: string
  automatic: boolean
  policyId?: string
  reviewedAt: string
}

export interface DocumentSnapshot {
  snapshotId: SnapshotId
  documentId: DocumentId
  revisionId: RevisionId
  rootHash: string
  document: SemanticDocument
  nodes: DocumentNode[]
  journalSequence: number
  createdAt: string
}

export interface OutlineNode {
  nodeId: DocumentNodeId
  type: 'section' | 'heading'
  text: string
  level: number
  children: OutlineNode[]
}

export interface DocumentProjection<T> {
  projectionId: string
  documentId: DocumentId
  revisionId: RevisionId
  format: 'outline' | 'plain-text' | 'markdown' | 'html' | 'presentation'
  content: T
  contentHash: string
  diagnostics: Array<{ code: string; message: string }>
  createdAt: string
}

export interface DocumentEngineCheckpoint {
  protocolVersion: 1
  clock: number
  authorities: Array<{
    document: SemanticDocument
    nodes: DocumentNode[]
    revisions: DocumentRevision[]
    journal: DocumentJournalEntry[]
    operationIds: OperationId[]
    idempotency: Array<{
      key: string
      fingerprint: string
      receipt: DocumentCommitReceipt
    }>
  }>
  changeSets: DocumentChangeSet[]
  reviews: Array<{
    changeSetId: ChangeSetId
    review: DocumentReview
  }>
  semanticDiffs?: Array<{
    changeSetId: ChangeSetId
    diff: DocumentSemanticDiff
  }>
  comments?: DocumentComment[]
  collaborationBatches?: Array<{
    batch: CollaborationBatch
    result: CollaborationMergeResult
  }>
}

export interface DocumentComment {
  commentId: CommentId
  documentId: DocumentId
  nodeId: DocumentNodeId
  revisionId: RevisionId
  authorPrincipalId: string
  body: string
  status: 'open' | 'resolved'
  createdAt: string
  updatedAt: string
  resolvedBy?: string
}

export interface CreateCommentInput {
  commentId?: CommentId
  documentId: DocumentId
  nodeId: DocumentNodeId
  revisionId: RevisionId
  authorPrincipalId: string
  body: string
}

export interface PresentationSlide {
  slideId: string
  sourceNodeId: DocumentNodeId
  title: string
  blocks: Array<{
    nodeId: DocumentNodeId
    type: DocumentNodeType
    text?: string
    attributes: Record<string, JsonValue>
  }>
}

export interface PresentationProjection extends DocumentProjection<PresentationSlide[]> {
  format: 'presentation'
  theme: { name: string; aspectRatio: '16:9' | '4:3' }
}

export interface CollaborationBatch {
  batchId: CollaborationBatchId
  documentId: DocumentId
  actorId: string
  lamport: number
  baseRevisionId: RevisionId
  operations: DocumentOperation[]
  createdAt: string
}

export interface CollaborationMergeResult {
  batchId: CollaborationBatchId
  status: 'committed' | 'duplicate' | 'conflicted'
  receipt?: DocumentCommitReceipt
  conflict?: {
    code: 'base_revision_conflict' | 'generation_conflict' | 'operation_conflict'
    currentRevisionId: RevisionId
    message: string
  }
}

export interface HumanTextEditInput {
  documentId: DocumentId
  nodeId: DocumentNodeId
  expectedGeneration: number
  baseRevisionId: RevisionId
  actorPrincipalId: string
  value: string
  intent?: string
  transactionId: string
  idempotencyKey: string
}

export interface DocumentSemanticDiffSummary {
  insertedNodes: number
  deletedNodes: number
  movedNodes: number
  changedTextNodes: number
  changedAttributes: number
  renamedDocuments: number
}

export interface DocumentSemanticDiff {
  documentId: DocumentId
  changeSetId: ChangeSetId
  fromRevisionId: RevisionId
  toRevisionId?: RevisionId
  effects: DocumentObservedEffect[]
  summary: DocumentSemanticDiffSummary
  textChanges: Array<{
    nodeId: DocumentNodeId
    before: string
    after: string
  }>
  generatedAt: string
}

export interface DocumentAgentScene {
  documentId: DocumentId
  revisionId: RevisionId
  title: string
  language: string
  outline: OutlineNode[]
  currentNode?: DocumentNode
  pendingChangeSets: Array<{
    changeSetId: ChangeSetId
    actorPrincipalId: string
    intent: string
    risk: DocumentChangeSet['risk']
    status: DocumentChangeSetStatus
  }>
  affordances: string[]
}

export interface CreateDocumentInput {
  documentId?: DocumentId
  rootNodeId?: DocumentNodeId
  authorityNodeId: KernelNodeId
  authorityEpoch?: number
  ownerPrincipalId: string
  title: string
  language?: string
  metadata?: Record<string, JsonValue>
}

export interface ProposeChangeSetInput {
  changeSetId?: ChangeSetId
  documentId: DocumentId
  baseRevisionId: RevisionId
  actorPrincipalId: string
  actorKind: DocumentChangeSet['actorKind']
  intent: string
  explanation?: string
  operations: DocumentOperation[]
  expectedEffects?: string[]
  risk: DocumentChangeSet['risk']
}

export interface ReviewChangeSetInput {
  changeSetId: ChangeSetId
  reviewerPrincipalId: string
  decision: DocumentReview['decision']
  message?: string
  automatic?: boolean
  policyId?: string
}

export interface CommitChangeSetInput {
  reviewerPrincipalId: string
  idempotencyKey: string
}

export interface DocumentEngine {
  createDocument(input: CreateDocumentInput): DocumentSnapshot
  inspect(documentId: DocumentId): DocumentSnapshot
  listDocuments(): SemanticDocument[]
  editText(input: HumanTextEditInput): DocumentCommitReceipt
  transact(request: DocumentTransactionRequest): DocumentCommitReceipt
  propose(input: ProposeChangeSetInput): DocumentChangeSet
  getChangeSet(changeSetId: ChangeSetId): DocumentChangeSet
  listChangeSets(documentId: DocumentId): DocumentChangeSet[]
  diffChangeSet(changeSetId: ChangeSetId): DocumentSemanticDiff
  projectAgentScene(documentId: DocumentId, currentNodeId?: DocumentNodeId): DocumentAgentScene
  createComment(input: CreateCommentInput): DocumentComment
  listComments(documentId: DocumentId, nodeId?: DocumentNodeId): DocumentComment[]
  resolveComment(commentId: CommentId, resolverPrincipalId: string): DocumentComment
  projectPresentation(documentId: DocumentId): PresentationProjection
  mergeCollaborationBatch(batch: CollaborationBatch): CollaborationMergeResult
  mergeCollaborationBatches(batches: CollaborationBatch[]): CollaborationMergeResult[]
  validate(changeSetId: ChangeSetId): DocumentChangeSet
  review(input: ReviewChangeSetInput): DocumentReview
  commitChangeSet(changeSetId: ChangeSetId, input: CommitChangeSetInput): DocumentCommitReceipt
  getRevision(revisionId: RevisionId): DocumentRevision
  listJournal(documentId: DocumentId): DocumentJournalEntry[]
  projectOutline(documentId: DocumentId): DocumentProjection<OutlineNode[]>
  projectPlainText(documentId: DocumentId): DocumentProjection<string>
  exportCheckpoint(): DocumentEngineCheckpoint
  restoreCheckpoint(checkpoint: DocumentEngineCheckpoint): void
}
