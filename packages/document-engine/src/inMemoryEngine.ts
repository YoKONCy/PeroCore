import { randomUUID } from 'node:crypto'
import type { KernelNodeId } from '@infos/shared'
import { assertJsonValue, cloneValue, contentHash, documentRootHash } from './canonical'
import { failDocument } from './errors'
import type {
  ChangeSetId,
  CollaborationBatch,
  CollaborationBatchId,
  CollaborationMergeResult,
  CommentId,
  CommitChangeSetInput,
  CreateCommentInput,
  CreateDocumentInput,
  DocumentAgentScene,
  DocumentChangeSet,
  DocumentCommitReceipt,
  DocumentComment,
  DocumentEngine,
  DocumentEngineCheckpoint,
  DocumentId,
  DocumentJournalEntry,
  DocumentNode,
  DocumentNodeId,
  DocumentObservedEffect,
  DocumentOperation,
  DocumentProjection,
  DocumentReview,
  DocumentRevision,
  DocumentSemanticDiff,
  DocumentSnapshot,
  DocumentTransactionRequest,
  HumanTextEditInput,
  OperationId,
  OutlineNode,
  PresentationProjection,
  ProposeChangeSetInput,
  ReceiptId,
  ReviewChangeSetInput,
  ReviewId,
  RevisionId,
  SemanticDocument,
  SnapshotId,
} from './types'

interface AuthorityState {
  document: SemanticDocument
  nodes: Map<DocumentNodeId, DocumentNode>
  revisions: Map<RevisionId, DocumentRevision>
  journal: DocumentJournalEntry[]
  operationIds: Set<OperationId>
  idempotency: Map<string, { fingerprint: string; receipt: DocumentCommitReceipt }>
}

interface SimulatedState {
  document: SemanticDocument
  nodes: Map<DocumentNodeId, DocumentNode>
  effects: DocumentObservedEffect[]
}

const TEXT_NODE_TYPES = new Set([
  'heading',
  'paragraph',
  'quote',
  'code-block',
  'table-cell',
  'citation',
])

export class InMemoryDocumentEngine implements DocumentEngine {
  private readonly documents = new Map<DocumentId, AuthorityState>()
  private readonly revisionIndex = new Map<RevisionId, DocumentRevision>()
  private readonly changeSets = new Map<ChangeSetId, DocumentChangeSet>()
  private readonly reviews = new Map<ChangeSetId, DocumentReview>()
  private readonly semanticDiffs = new Map<ChangeSetId, DocumentSemanticDiff>()
  private readonly comments = new Map<CommentId, DocumentComment>()
  private readonly collaborationBatches = new Map<
    CollaborationBatchId,
    { batch: CollaborationBatch; result: CollaborationMergeResult }
  >()
  private clock = 0

  createDocument(input: CreateDocumentInput): DocumentSnapshot {
    assertJsonValue(input.metadata ?? {}, 'metadata')
    const documentId = input.documentId ?? (randomUUID() as DocumentId)
    if (this.documents.has(documentId)) {
      failDocument('DOCUMENT_NODE_EXISTS', `文档已存在: ${documentId}`)
    }
    const rootNodeId = input.rootNodeId ?? (randomUUID() as DocumentNodeId)
    const createdAt = this.now()
    const initialRevisionId = randomUUID() as RevisionId
    const document: SemanticDocument = {
      documentId,
      generation: 1,
      authorityNodeId: input.authorityNodeId,
      authorityEpoch: input.authorityEpoch ?? 1,
      ownerPrincipalId: input.ownerPrincipalId,
      title: this.nonEmpty(input.title, '文档标题不能为空'),
      language: input.language ?? 'zh-CN',
      kind: 'article',
      rootNodeId,
      headRevisionId: initialRevisionId,
      status: 'active',
      metadata: cloneValue(input.metadata ?? {}),
      createdAt,
      updatedAt: createdAt,
    }
    const root: DocumentNode = {
      nodeId: rootNodeId,
      documentId,
      type: 'document-root',
      parentId: null,
      orderKey: 'root',
      generation: 1,
      attributes: {},
      createdAt,
      updatedAt: createdAt,
    }
    const nodes = new Map([[rootNodeId, root]])
    const rootHash = documentRootHash(document, nodes.values())
    const revision: DocumentRevision = {
      revisionId: initialRevisionId,
      documentId,
      sequence: 0,
      parentRevisionIds: [],
      operationIds: [],
      actorPrincipalId: input.ownerPrincipalId,
      intent: '创建文档',
      rootHash,
      committedAt: createdAt,
    }
    const state: AuthorityState = {
      document,
      nodes,
      revisions: new Map([[initialRevisionId, revision]]),
      journal: [],
      operationIds: new Set(),
      idempotency: new Map(),
    }
    this.documents.set(documentId, state)
    this.revisionIndex.set(initialRevisionId, revision)
    return this.snapshot(state)
  }

  inspect(documentId: DocumentId): DocumentSnapshot {
    return this.snapshot(this.requireDocument(documentId))
  }

  listDocuments(): SemanticDocument[] {
    return cloneValue(
      [...this.documents.values()]
        .map((state) => state.document)
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            String(left.documentId).localeCompare(String(right.documentId)),
        ),
    )
  }

  editText(input: HumanTextEditInput): DocumentCommitReceipt {
    return this.transact({
      transactionId: input.transactionId,
      documentId: input.documentId,
      actorPrincipalId: input.actorPrincipalId,
      baseRevisionId: input.baseRevisionId,
      intent: input.intent ?? '编辑文本节点',
      idempotencyKey: input.idempotencyKey,
      operations: [
        {
          operationId: `${input.transactionId}:text` as OperationId,
          documentId: input.documentId,
          actorPrincipalId: input.actorPrincipalId,
          baseRevisionId: input.baseRevisionId,
          timestamp: new Date().toISOString(),
          type: 'text.replace',
          nodeId: input.nodeId,
          expectedGeneration: input.expectedGeneration,
          value: input.value,
        },
      ],
    })
  }

  transact(request: DocumentTransactionRequest): DocumentCommitReceipt {
    const state = this.requireDocument(request.documentId)
    if (!request.operations.length) {
      failDocument('DOCUMENT_EMPTY_TRANSACTION', '文档事务不能为空')
    }
    this.nonEmpty(request.transactionId, '事务 ID 不能为空')
    this.nonEmpty(request.actorPrincipalId, 'Actor 不能为空')
    this.nonEmpty(request.intent, '事务意图不能为空')
    this.nonEmpty(request.idempotencyKey, '幂等键不能为空')
    const fingerprint = contentHash({
      transactionId: request.transactionId,
      documentId: request.documentId,
      actorPrincipalId: request.actorPrincipalId,
      baseRevisionId: request.baseRevisionId,
      operations: request.operations,
      intent: request.intent,
      expectedEffects: request.expectedEffects ?? [],
    })
    const known = state.idempotency.get(request.idempotencyKey)
    if (known) {
      if (known.fingerprint !== fingerprint) {
        failDocument('DOCUMENT_IDEMPOTENCY_CONFLICT', '同一幂等键对应了不同事务')
      }
      return cloneValue(known.receipt)
    }
    this.assertHead(state, request.baseRevisionId)
    const operationIds = new Set<OperationId>()
    for (const operation of request.operations) {
      if (operation.documentId !== request.documentId) {
        failDocument('DOCUMENT_CROSS_BOUNDARY', '事务包含其他文档的操作')
      }
      if (operation.actorPrincipalId !== request.actorPrincipalId) {
        failDocument('DOCUMENT_CROSS_BOUNDARY', '操作 Actor 与事务 Actor 不一致')
      }
      if (operation.baseRevisionId !== request.baseRevisionId) {
        failDocument('DOCUMENT_REVISION_CONFLICT', '操作基础 Revision 与事务不一致')
      }
      if (
        state.operationIds.has(operation.operationId) ||
        operationIds.has(operation.operationId)
      ) {
        failDocument('DOCUMENT_OPERATION_DUPLICATE', `Operation ID 重复: ${operation.operationId}`)
      }
      operationIds.add(operation.operationId)
    }

    const simulated: SimulatedState = {
      document: cloneValue(state.document),
      nodes: new Map([...state.nodes].map(([id, node]) => [id, cloneValue(node)])),
      effects: [],
    }
    const committedAt = this.now()
    for (const operation of request.operations) this.apply(simulated, operation, committedAt)
    this.validateTree(simulated.document, simulated.nodes)
    simulated.document.generation += 1
    simulated.document.updatedAt = committedAt
    const revisionId = randomUUID() as RevisionId
    simulated.document.headRevisionId = revisionId
    const rootHash = documentRootHash(simulated.document, simulated.nodes.values())
    const revision: DocumentRevision = {
      revisionId,
      documentId: request.documentId,
      sequence: state.journal.length + 1,
      parentRevisionIds: [state.document.headRevisionId],
      operationIds: request.operations.map((operation) => operation.operationId),
      actorPrincipalId: request.actorPrincipalId,
      intent: request.intent,
      rootHash,
      committedAt,
    }
    const receipt: DocumentCommitReceipt = {
      receiptId: randomUUID() as ReceiptId,
      transactionId: request.transactionId,
      documentId: request.documentId,
      previousRevisionId: state.document.headRevisionId,
      revisionId,
      operationIds: [...revision.operationIds],
      actorPrincipalId: request.actorPrincipalId,
      status: 'committed',
      observedEffects: cloneValue(simulated.effects),
      rootHash,
      committedAt,
    }
    state.document = simulated.document
    state.nodes = simulated.nodes
    state.revisions.set(revisionId, revision)
    request.operations.forEach((operation) => state.operationIds.add(operation.operationId))
    const entry: DocumentJournalEntry = {
      sequence: revision.sequence,
      revision: cloneValue(revision),
      operations: cloneValue(request.operations),
      receipt: cloneValue(receipt),
    }
    state.journal.push(entry)
    state.idempotency.set(request.idempotencyKey, {
      fingerprint,
      receipt: cloneValue(receipt),
    })
    this.revisionIndex.set(revisionId, revision)
    return cloneValue(receipt)
  }

  propose(input: ProposeChangeSetInput): DocumentChangeSet {
    const state = this.requireDocument(input.documentId)
    this.assertHead(state, input.baseRevisionId)
    if (!input.operations.length) failDocument('DOCUMENT_EMPTY_TRANSACTION', 'ChangeSet 不能为空')
    this.assertOperationEnvelope(
      input.operations,
      input.documentId,
      input.actorPrincipalId,
      input.baseRevisionId,
    )
    const changeSetId = input.changeSetId ?? (randomUUID() as ChangeSetId)
    if (this.changeSets.has(changeSetId)) {
      failDocument('DOCUMENT_NODE_EXISTS', `ChangeSet 已存在: ${changeSetId}`)
    }
    const now = this.now()
    const changeSet: DocumentChangeSet = {
      changeSetId,
      documentId: input.documentId,
      baseRevisionId: input.baseRevisionId,
      actorPrincipalId: input.actorPrincipalId,
      actorKind: input.actorKind,
      intent: this.nonEmpty(input.intent, 'ChangeSet 意图不能为空'),
      explanation: input.explanation ?? '',
      operations: cloneValue(input.operations),
      expectedEffects: cloneValue(input.expectedEffects ?? []),
      risk: input.risk,
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
    }
    this.changeSets.set(changeSetId, changeSet)
    return cloneValue(changeSet)
  }

  getChangeSet(changeSetId: ChangeSetId): DocumentChangeSet {
    return cloneValue(this.requireChangeSet(changeSetId))
  }

  listChangeSets(documentId: DocumentId): DocumentChangeSet[] {
    this.requireDocument(documentId)
    return cloneValue(
      [...this.changeSets.values()]
        .filter((changeSet) => changeSet.documentId === documentId)
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            String(left.changeSetId).localeCompare(String(right.changeSetId)),
        ),
    )
  }

  diffChangeSet(changeSetId: ChangeSetId): DocumentSemanticDiff {
    const cached = this.semanticDiffs.get(changeSetId)
    if (cached) return cloneValue(cached)
    const changeSet = this.requireChangeSet(changeSetId)
    const state = this.requireDocument(changeSet.documentId)
    const simulated: SimulatedState = {
      document: cloneValue(state.document),
      nodes: new Map([...state.nodes].map(([id, node]) => [id, cloneValue(node)])),
      effects: [],
    }
    const textChanges: DocumentSemanticDiff['textChanges'] = []
    for (const operation of changeSet.operations) {
      if (operation.type === 'text.replace') {
        textChanges.push({
          nodeId: operation.nodeId,
          before: state.nodes.get(operation.nodeId)?.text ?? '',
          after: operation.value,
        })
      }
      this.apply(simulated, operation, state.document.updatedAt)
    }
    this.validateTree(simulated.document, simulated.nodes)
    const summary = {
      insertedNodes: 0,
      deletedNodes: 0,
      movedNodes: 0,
      changedTextNodes: 0,
      changedAttributes: 0,
      renamedDocuments: 0,
    }
    for (const effect of simulated.effects) {
      if (effect.type === 'node-created') summary.insertedNodes += 1
      else if (effect.type === 'node-deleted') summary.deletedNodes += 1
      else if (effect.type === 'node-moved') summary.movedNodes += 1
      else if (effect.type === 'text-changed') summary.changedTextNodes += 1
      else if (effect.type === 'attribute-changed') summary.changedAttributes += 1
      else if (effect.type === 'document-renamed') summary.renamedDocuments += 1
    }
    const diff: DocumentSemanticDiff = {
      documentId: changeSet.documentId,
      changeSetId,
      fromRevisionId: changeSet.baseRevisionId,
      effects: cloneValue(simulated.effects),
      summary,
      textChanges,
      generatedAt: this.now(),
    }
    this.semanticDiffs.set(changeSetId, cloneValue(diff))
    return diff
  }

  projectAgentScene(documentId: DocumentId, currentNodeId?: DocumentNodeId): DocumentAgentScene {
    const state = this.requireDocument(documentId)
    const currentNode = currentNodeId ? state.nodes.get(currentNodeId) : undefined
    if (currentNodeId && !currentNode) {
      failDocument('DOCUMENT_NODE_NOT_FOUND', `当前节点不存在: ${currentNodeId}`)
    }
    return cloneValue({
      documentId,
      revisionId: state.document.headRevisionId,
      title: state.document.title,
      language: state.document.language,
      outline: this.projectOutline(documentId).content,
      ...(currentNode ? { currentNode } : {}),
      pendingChangeSets: this.listChangeSets(documentId)
        .filter((changeSet) => !['committed', 'rejected', 'superseded'].includes(changeSet.status))
        .map((changeSet) => ({
          changeSetId: changeSet.changeSetId,
          actorPrincipalId: changeSet.actorPrincipalId,
          intent: changeSet.intent,
          risk: changeSet.risk,
          status: changeSet.status,
        })),
      affordances: [
        'document.inspect',
        'document.query',
        'document.changeset.propose',
        'document.changeset.validate',
      ],
    })
  }

  createComment(input: CreateCommentInput): DocumentComment {
    const state = this.requireDocument(input.documentId)
    this.assertHead(state, input.revisionId)
    this.requireNode(state.nodes, input.nodeId)
    const commentId = input.commentId ?? (randomUUID() as CommentId)
    if (this.comments.has(commentId))
      failDocument('DOCUMENT_NODE_EXISTS', `评论已存在: ${commentId}`)
    const now = this.now()
    const comment: DocumentComment = {
      commentId,
      documentId: input.documentId,
      nodeId: input.nodeId,
      revisionId: input.revisionId,
      authorPrincipalId: this.nonEmpty(input.authorPrincipalId, '评论作者不能为空'),
      body: this.nonEmpty(input.body, '评论正文不能为空'),
      status: 'open',
      createdAt: now,
      updatedAt: now,
    }
    this.comments.set(commentId, comment)
    return cloneValue(comment)
  }

  listComments(documentId: DocumentId, nodeId?: DocumentNodeId): DocumentComment[] {
    this.requireDocument(documentId)
    return cloneValue(
      [...this.comments.values()]
        .filter(
          (comment) => comment.documentId === documentId && (!nodeId || comment.nodeId === nodeId),
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            String(left.commentId).localeCompare(String(right.commentId)),
        ),
    )
  }

  resolveComment(commentId: CommentId, resolverPrincipalId: string): DocumentComment {
    const comment = this.comments.get(commentId)
    if (!comment) failDocument('DOCUMENT_NOT_FOUND', `评论不存在: ${commentId}`)
    if (comment.status === 'resolved') return cloneValue(comment)
    comment.status = 'resolved'
    comment.resolvedBy = this.nonEmpty(resolverPrincipalId, '评论解决者不能为空')
    comment.updatedAt = this.now()
    return cloneValue(comment)
  }

  projectPresentation(documentId: DocumentId): PresentationProjection {
    const state = this.requireDocument(documentId)
    const nodes = this.flatten(state.nodes, state.document.rootNodeId)
    const slides: PresentationProjection['content'] = []
    let current: PresentationProjection['content'][number] | undefined
    for (const node of nodes) {
      const isSlideHeading = node.type === 'heading' && Number(node.attributes.level ?? 1) <= 2
      if (isSlideHeading || !current) {
        current = {
          slideId: `${documentId}:${node.nodeId}`,
          sourceNodeId: node.nodeId,
          title: isSlideHeading ? (node.text ?? '') : state.document.title,
          blocks: [],
        }
        slides.push(current)
        if (isSlideHeading) continue
      }
      if (!['section', 'document-root', 'table-row'].includes(node.type)) {
        current.blocks.push({
          nodeId: node.nodeId,
          type: node.type,
          ...(node.text === undefined ? {} : { text: node.text }),
          attributes: cloneValue(node.attributes),
        })
      }
    }
    const content = cloneValue(slides)
    return {
      ...this.projection(state, 'presentation', content),
      format: 'presentation',
      theme: { name: 'arca-default', aspectRatio: '16:9' },
    }
  }

  mergeCollaborationBatch(batch: CollaborationBatch): CollaborationMergeResult {
    const known = this.collaborationBatches.get(batch.batchId)
    if (known) return { ...cloneValue(known.result), status: 'duplicate' }
    const state = this.requireDocument(batch.documentId)
    if (batch.lamport < 1 || !Number.isSafeInteger(batch.lamport)) {
      failDocument('DOCUMENT_INVALID_ATTRIBUTE', 'Lamport 必须是正安全整数')
    }
    const sorted = [...batch.operations].sort((left, right) =>
      String(left.operationId).localeCompare(String(right.operationId)),
    )
    if (state.document.headRevisionId !== batch.baseRevisionId) {
      const result: CollaborationMergeResult = {
        batchId: batch.batchId,
        status: 'conflicted',
        conflict: {
          code: 'base_revision_conflict',
          currentRevisionId: state.document.headRevisionId,
          message: '离线 Batch 的基础 Revision 已过期',
        },
      }
      this.collaborationBatches.set(batch.batchId, {
        batch: cloneValue(batch),
        result: cloneValue(result),
      })
      return result
    }
    try {
      const receipt = this.transact({
        transactionId: `collaboration:${batch.actorId}:${batch.lamport}:${batch.batchId}`,
        documentId: batch.documentId,
        actorPrincipalId: batch.actorId,
        baseRevisionId: batch.baseRevisionId,
        operations: sorted,
        intent: '合并离线协作批次',
        idempotencyKey: `collaboration:${batch.batchId}`,
      })
      const result: CollaborationMergeResult = {
        batchId: batch.batchId,
        status: 'committed',
        receipt,
      }
      this.collaborationBatches.set(batch.batchId, {
        batch: cloneValue(batch),
        result: cloneValue(result),
      })
      return result
    } catch (error) {
      const result: CollaborationMergeResult = {
        batchId: batch.batchId,
        status: 'conflicted',
        conflict: {
          code: 'generation_conflict',
          currentRevisionId: state.document.headRevisionId,
          message: error instanceof Error ? error.message : String(error),
        },
      }
      this.collaborationBatches.set(batch.batchId, {
        batch: cloneValue(batch),
        result: cloneValue(result),
      })
      return result
    }
  }

  mergeCollaborationBatches(batches: CollaborationBatch[]): CollaborationMergeResult[] {
    return [...batches]
      .sort(
        (left, right) =>
          left.lamport - right.lamport ||
          left.actorId.localeCompare(right.actorId) ||
          String(left.batchId).localeCompare(String(right.batchId)),
      )
      .map((batch) => this.mergeCollaborationBatch(batch))
  }

  validate(changeSetId: ChangeSetId): DocumentChangeSet {
    const changeSet = this.requireChangeSet(changeSetId)
    if (changeSet.status !== 'proposed') {
      failDocument('CHANGESET_STATE_INVALID', '只有 proposed ChangeSet 可以验证')
    }
    const state = this.requireDocument(changeSet.documentId)
    if (state.document.headRevisionId !== changeSet.baseRevisionId) {
      changeSet.status = 'conflicted'
      changeSet.updatedAt = this.now()
      return cloneValue(changeSet)
    }
    const simulated: SimulatedState = {
      document: cloneValue(state.document),
      nodes: new Map([...state.nodes].map(([id, node]) => [id, cloneValue(node)])),
      effects: [],
    }
    const simulationTime = state.document.updatedAt
    for (const operation of changeSet.operations) this.apply(simulated, operation, simulationTime)
    this.validateTree(simulated.document, simulated.nodes)
    changeSet.status = 'validated'
    changeSet.updatedAt = this.now()
    return cloneValue(changeSet)
  }

  review(input: ReviewChangeSetInput) {
    const changeSet = this.requireChangeSet(input.changeSetId)
    if (!['validated', 'approved'].includes(changeSet.status)) {
      failDocument('CHANGESET_STATE_INVALID', '只有 validated ChangeSet 可以审阅')
    }
    const reviewedAt = this.now()
    if (input.decision === 'approve') changeSet.status = 'approved'
    else if (input.decision === 'reject') changeSet.status = 'rejected'
    else changeSet.status = 'proposed'
    changeSet.updatedAt = reviewedAt
    const reviewId = randomUUID() as ReviewId
    const review: DocumentReview = {
      reviewId,
      changeSetId: input.changeSetId,
      reviewerPrincipalId: input.reviewerPrincipalId,
      decision: input.decision,
      message: input.message ?? '',
      automatic: input.automatic ?? false,
      ...(input.policyId ? { policyId: input.policyId } : {}),
      reviewedAt,
    }
    this.reviews.set(input.changeSetId, review)
    return cloneValue(review)
  }

  commitChangeSet(changeSetId: ChangeSetId, input: CommitChangeSetInput): DocumentCommitReceipt {
    const changeSet = this.requireChangeSet(changeSetId)
    if (changeSet.status === 'rejected') {
      failDocument('CHANGESET_REJECTED', 'ChangeSet 已被拒绝')
    }
    if (changeSet.status !== 'approved') {
      failDocument('CHANGESET_REVIEW_REQUIRED', 'ChangeSet 尚未批准')
    }
    const approvedReview = this.reviews.get(changeSetId)
    if (
      approvedReview?.decision !== 'approve' ||
      approvedReview.reviewerPrincipalId !== input.reviewerPrincipalId
    ) {
      failDocument('CHANGESET_REVIEW_REQUIRED', '提交者与批准 Review 不一致')
    }
    const state = this.requireDocument(changeSet.documentId)
    if (state.document.headRevisionId !== changeSet.baseRevisionId) {
      changeSet.status = 'conflicted'
      changeSet.updatedAt = this.now()
      failDocument('DOCUMENT_REVISION_CONFLICT', 'ChangeSet 基础 Revision 已过期', {
        expected: changeSet.baseRevisionId,
        actual: state.document.headRevisionId,
      })
    }
    try {
      const diff = this.diffChangeSet(changeSetId)
      const receipt = this.transact({
        transactionId: `changeset:${changeSetId}`,
        documentId: changeSet.documentId,
        actorPrincipalId: changeSet.actorPrincipalId,
        baseRevisionId: changeSet.baseRevisionId,
        operations: changeSet.operations,
        intent: changeSet.intent,
        idempotencyKey: input.idempotencyKey,
        expectedEffects: changeSet.expectedEffects,
      })
      changeSet.status = 'committed'
      changeSet.updatedAt = this.now()
      this.semanticDiffs.set(changeSetId, { ...diff, toRevisionId: receipt.revisionId })
      return receipt
    } catch (error) {
      changeSet.status = 'failed'
      changeSet.updatedAt = this.now()
      throw error
    }
  }

  getRevision(revisionId: RevisionId): DocumentRevision {
    const revision = this.revisionIndex.get(revisionId)
    if (!revision) failDocument('DOCUMENT_NOT_FOUND', `Revision 不存在: ${revisionId}`)
    return cloneValue(revision)
  }

  listJournal(documentId: DocumentId): DocumentJournalEntry[] {
    return cloneValue(this.requireDocument(documentId).journal)
  }

  projectOutline(documentId: DocumentId): DocumentProjection<OutlineNode[]> {
    const state = this.requireDocument(documentId)
    const build = (parentId: DocumentNodeId, level: number): OutlineNode[] =>
      this.children(state.nodes, parentId).flatMap((node) => {
        const descendants = build(node.nodeId, level + (node.type === 'heading' ? 1 : 0))
        if (node.type !== 'section' && node.type !== 'heading') return descendants
        return [
          {
            nodeId: node.nodeId,
            type: node.type,
            text: node.text ?? '',
            level,
            children: descendants,
          },
        ]
      })
    const content = build(state.document.rootNodeId, 1)
    return this.projection(state, 'outline', content)
  }

  projectPlainText(documentId: DocumentId): DocumentProjection<string> {
    const state = this.requireDocument(documentId)
    const lines: string[] = []
    const walk = (parentId: DocumentNodeId): void => {
      for (const node of this.children(state.nodes, parentId)) {
        if (node.text) lines.push(node.text)
        walk(node.nodeId)
      }
    }
    walk(state.document.rootNodeId)
    return this.projection(state, 'plain-text', lines.join('\n\n'))
  }

  exportCheckpoint(): DocumentEngineCheckpoint {
    return cloneValue({
      protocolVersion: 1,
      clock: this.clock,
      authorities: [...this.documents.values()].map((state) => ({
        document: state.document,
        nodes: [...state.nodes.values()],
        revisions: [...state.revisions.values()],
        journal: state.journal,
        operationIds: [...state.operationIds],
        idempotency: [...state.idempotency].map(([key, record]) => ({ key, ...record })),
      })),
      changeSets: [...this.changeSets.values()],
      reviews: [...this.reviews].map(([changeSetId, review]) => ({
        changeSetId,
        review,
      })),
      semanticDiffs: [...this.semanticDiffs].map(([changeSetId, diff]) => ({
        changeSetId,
        diff,
      })),
      comments: [...this.comments.values()],
      collaborationBatches: [...this.collaborationBatches.values()],
    })
  }

  restoreCheckpoint(checkpoint: DocumentEngineCheckpoint): void {
    if (checkpoint.protocolVersion !== 1) {
      failDocument('DOCUMENT_CHECKPOINT_VERSION_UNSUPPORTED', '不支持的 Engine Checkpoint 版本')
    }
    const restoredDocuments = new Map<DocumentId, AuthorityState>()
    const restoredRevisionIndex = new Map<RevisionId, DocumentRevision>()
    for (const authority of checkpoint.authorities) {
      const nodes = new Map(authority.nodes.map((node) => [node.nodeId, cloneValue(node)]))
      this.validateTree(authority.document, nodes)
      const rootHash = documentRootHash(authority.document, nodes.values())
      const head = authority.revisions.find(
        (revision) => revision.revisionId === authority.document.headRevisionId,
      )
      if (!head || head.rootHash !== rootHash) {
        failDocument('DOCUMENT_CHECKPOINT_CORRUPT', 'Checkpoint Head 或 Root Hash 无效')
      }
      const revisions = new Map(
        authority.revisions.map((revision) => [revision.revisionId, cloneValue(revision)]),
      )
      for (const revision of revisions.values())
        restoredRevisionIndex.set(revision.revisionId, revision)
      restoredDocuments.set(authority.document.documentId, {
        document: cloneValue(authority.document),
        nodes,
        revisions,
        journal: cloneValue(authority.journal),
        operationIds: new Set(authority.operationIds),
        idempotency: new Map(
          authority.idempotency.map((record) => [
            record.key,
            { fingerprint: record.fingerprint, receipt: cloneValue(record.receipt) },
          ]),
        ),
      })
    }
    this.documents.clear()
    this.revisionIndex.clear()
    this.changeSets.clear()
    this.reviews.clear()
    this.semanticDiffs.clear()
    this.comments.clear()
    this.collaborationBatches.clear()
    restoredDocuments.forEach((state, id) => this.documents.set(id, state))
    restoredRevisionIndex.forEach((revision, id) => this.revisionIndex.set(id, revision))
    checkpoint.changeSets.forEach((changeSet) =>
      this.changeSets.set(changeSet.changeSetId, cloneValue(changeSet)),
    )
    checkpoint.reviews.forEach((review) =>
      this.reviews.set(review.changeSetId, cloneValue(review.review)),
    )
    ;(checkpoint.semanticDiffs ?? []).forEach((entry) =>
      this.semanticDiffs.set(entry.changeSetId, cloneValue(entry.diff)),
    )
    ;(checkpoint.comments ?? []).forEach((comment) =>
      this.comments.set(comment.commentId, cloneValue(comment)),
    )
    ;(checkpoint.collaborationBatches ?? []).forEach((entry) =>
      this.collaborationBatches.set(entry.batch.batchId, cloneValue(entry)),
    )
    this.clock = checkpoint.clock
  }

  private apply(state: SimulatedState, operation: DocumentOperation, authorityTime: string): void {
    switch (operation.type) {
      case 'node.insert': {
        if (state.nodes.has(operation.node.nodeId)) {
          failDocument('DOCUMENT_NODE_EXISTS', `节点已存在: ${operation.node.nodeId}`)
        }
        const parent = this.requireNode(state.nodes, operation.node.parentId)
        this.assertGeneration(parent, operation.parentGeneration)
        this.assertParentAllows(parent, operation.node.type)
        this.assertOrderKeyAvailable(state.nodes, parent.nodeId, operation.node.orderKey)
        assertJsonValue(operation.node.attributes ?? {}, 'node.attributes')
        const now = authorityTime
        state.nodes.set(operation.node.nodeId, {
          ...cloneValue(operation.node),
          documentId: state.document.documentId,
          generation: 1,
          attributes: cloneValue(operation.node.attributes ?? {}),
          createdAt: now,
          updatedAt: now,
        })
        parent.generation += 1
        parent.updatedAt = now
        state.effects.push({
          type: 'node-created',
          nodeId: operation.node.nodeId,
          parentId: parent.nodeId,
        })
        return
      }
      case 'node.delete': {
        if (operation.nodeId === state.document.rootNodeId) {
          failDocument('DOCUMENT_ROOT_IMMUTABLE', '不能删除 Document Root')
        }
        const node = this.requireNode(state.nodes, operation.nodeId)
        this.assertGeneration(node, operation.expectedGeneration)
        const descendants = this.descendantIds(state.nodes, node.nodeId)
        if (descendants.length && !operation.recursive) {
          failDocument('DOCUMENT_INVALID_PARENT', '删除含子节点的节点必须声明 recursive')
        }
        const ids = [node.nodeId, ...descendants]
        for (const id of ids.reverse()) {
          const target = this.requireNode(state.nodes, id)
          state.effects.push({
            type: 'node-deleted',
            nodeId: id,
            parentId: target.parentId,
          })
          state.nodes.delete(id)
        }
        if (node.parentId) {
          const parent = this.requireNode(state.nodes, node.parentId)
          parent.generation += 1
          parent.updatedAt = authorityTime
        }
        return
      }
      case 'node.move': {
        if (operation.nodeId === state.document.rootNodeId) {
          failDocument('DOCUMENT_ROOT_IMMUTABLE', '不能移动 Document Root')
        }
        const node = this.requireNode(state.nodes, operation.nodeId)
        const parent = this.requireNode(state.nodes, operation.newParentId)
        this.assertGeneration(node, operation.expectedGeneration)
        this.assertGeneration(parent, operation.newParentGeneration)
        if (this.descendantIds(state.nodes, node.nodeId).includes(parent.nodeId)) {
          failDocument('DOCUMENT_TREE_CYCLE', '不能把节点移动到其后代')
        }
        this.assertParentAllows(parent, node.type)
        this.assertOrderKeyAvailable(state.nodes, parent.nodeId, operation.newOrderKey, node.nodeId)
        const previousParentId = node.parentId
        if (!previousParentId) failDocument('DOCUMENT_ROOT_IMMUTABLE', 'Root 不可移动')
        node.parentId = parent.nodeId
        node.orderKey = this.nonEmpty(operation.newOrderKey, 'orderKey 不能为空')
        node.generation += 1
        node.updatedAt = authorityTime
        parent.generation += 1
        parent.updatedAt = authorityTime
        if (previousParentId !== parent.nodeId) {
          const previousParent = this.requireNode(state.nodes, previousParentId)
          previousParent.generation += 1
          previousParent.updatedAt = authorityTime
        }
        state.effects.push({
          type: 'node-moved',
          nodeId: node.nodeId,
          previousParentId,
          parentId: parent.nodeId,
        })
        return
      }
      case 'text.replace': {
        const node = this.requireNode(state.nodes, operation.nodeId)
        this.assertGeneration(node, operation.expectedGeneration)
        if (!TEXT_NODE_TYPES.has(node.type)) {
          failDocument('DOCUMENT_INVALID_NODE_TYPE', `节点类型不支持文本: ${node.type}`)
        }
        node.text = operation.value
        node.generation += 1
        node.updatedAt = authorityTime
        state.effects.push({ type: 'text-changed', nodeId: node.nodeId })
        return
      }
      case 'attribute.set': {
        const node = this.requireNode(state.nodes, operation.nodeId)
        this.assertGeneration(node, operation.expectedGeneration)
        this.nonEmpty(operation.key, '属性 Key 不能为空')
        if (operation.value === undefined) delete node.attributes[operation.key]
        else {
          assertJsonValue(operation.value, `attributes.${operation.key}`)
          node.attributes[operation.key] = cloneValue(operation.value)
        }
        node.generation += 1
        node.updatedAt = authorityTime
        state.effects.push({
          type: 'attribute-changed',
          nodeId: node.nodeId,
          key: operation.key,
        })
        return
      }
      case 'document.rename': {
        const previousTitle = state.document.title
        state.document.title = this.nonEmpty(operation.value, '文档标题不能为空')
        state.effects.push({
          type: 'document-renamed',
          previousTitle,
          title: state.document.title,
        })
      }
    }
  }

  private validateTree(document: SemanticDocument, nodes: Map<DocumentNodeId, DocumentNode>): void {
    const root = nodes.get(document.rootNodeId)
    if (!root || root.type !== 'document-root' || root.parentId !== null) {
      failDocument('DOCUMENT_ROOT_IMMUTABLE', '文档 Root 无效')
    }
    const visited = new Set<DocumentNodeId>()
    const visiting = new Set<DocumentNodeId>()
    const visit = (nodeId: DocumentNodeId): void => {
      if (visiting.has(nodeId)) failDocument('DOCUMENT_TREE_CYCLE', '文档树存在环')
      if (visited.has(nodeId)) return
      visiting.add(nodeId)
      const parent = this.requireNode(nodes, nodeId)
      if (parent.type === 'citation') {
        const sourceId = parent.attributes.sourceId
        if (typeof sourceId !== 'string' || !sourceId.trim()) {
          failDocument('DOCUMENT_INVALID_ATTRIBUTE', 'citation 必须包含 sourceId')
        }
      }
      if (parent.type === 'programmable-island') {
        const runtime = parent.attributes.runtime
        const sourceBlobId = parent.attributes.sourceBlobId
        const sourceHash = parent.attributes.sourceHash
        const network = parent.attributes.network
        if (!['worker', 'iframe', 'wasm'].includes(String(runtime))) {
          failDocument('DOCUMENT_INVALID_ATTRIBUTE', '可编程岛runtime无效')
        }
        if (
          typeof sourceBlobId !== 'string' ||
          !sourceBlobId.startsWith('sha256:') ||
          typeof sourceHash !== 'string' ||
          !/^[a-f0-9]{64}$/i.test(sourceHash) ||
          network !== 'none'
        ) {
          failDocument('DOCUMENT_INVALID_ATTRIBUTE', '可编程岛必须使用内容寻址资源且禁止网络')
        }
      }
      for (const child of this.children(nodes, nodeId)) {
        this.assertParentAllows(parent, child.type)
        visit(child.nodeId)
      }
      visiting.delete(nodeId)
      visited.add(nodeId)
    }
    visit(root.nodeId)
    if (visited.size !== nodes.size) {
      failDocument('DOCUMENT_PARENT_NOT_FOUND', '文档存在不可达节点')
    }
  }

  private assertParentAllows(parent: DocumentNode, childType: DocumentNode['type']): void {
    if (childType === 'document-root') failDocument('DOCUMENT_INVALID_NODE_TYPE', '不能插入 Root')
    if (childType === 'list-item' && parent.type !== 'list') {
      failDocument('DOCUMENT_INVALID_PARENT', 'list-item 必须位于 list 下')
    }
    if (parent.type === 'list' && childType !== 'list-item') {
      failDocument('DOCUMENT_INVALID_PARENT', 'list 只能包含 list-item')
    }
    if (childType === 'table-row' && parent.type !== 'table') {
      failDocument('DOCUMENT_INVALID_PARENT', 'table-row 必须位于 table 下')
    }
    if (parent.type === 'table' && childType !== 'table-row') {
      failDocument('DOCUMENT_INVALID_PARENT', 'table 只能包含 table-row')
    }
    if (childType === 'table-cell' && parent.type !== 'table-row') {
      failDocument('DOCUMENT_INVALID_PARENT', 'table-cell 必须位于 table-row 下')
    }
    if (parent.type === 'table-row' && childType !== 'table-cell') {
      failDocument('DOCUMENT_INVALID_PARENT', 'table-row 只能包含 table-cell')
    }
    if (
      TEXT_NODE_TYPES.has(parent.type) ||
      parent.type === 'asset' ||
      parent.type === 'programmable-island'
    ) {
      failDocument('DOCUMENT_INVALID_PARENT', `${parent.type} 不能包含子节点`)
    }
  }

  private assertOrderKeyAvailable(
    nodes: Map<DocumentNodeId, DocumentNode>,
    parentId: DocumentNodeId,
    orderKey: string,
    excluding?: DocumentNodeId,
  ): void {
    this.nonEmpty(orderKey, 'orderKey 不能为空')
    const duplicate = [...nodes.values()].find(
      (node) =>
        node.parentId === parentId && node.orderKey === orderKey && node.nodeId !== excluding,
    )
    if (duplicate) failDocument('DOCUMENT_INVALID_PARENT', '同一 Parent 下 orderKey 必须唯一')
  }

  private assertOperationEnvelope(
    operations: DocumentOperation[],
    documentId: DocumentId,
    actorPrincipalId: string,
    baseRevisionId: RevisionId,
  ): void {
    const operationIds = new Set<OperationId>()
    for (const operation of operations) {
      if (operation.documentId !== documentId) {
        failDocument('DOCUMENT_CROSS_BOUNDARY', '操作属于其他文档')
      }
      if (operation.actorPrincipalId !== actorPrincipalId) {
        failDocument('DOCUMENT_CROSS_BOUNDARY', '操作 Actor 与请求 Actor 不一致')
      }
      if (operation.baseRevisionId !== baseRevisionId) {
        failDocument('DOCUMENT_REVISION_CONFLICT', '操作基础 Revision 与请求不一致')
      }
      if (operationIds.has(operation.operationId)) {
        failDocument('DOCUMENT_OPERATION_DUPLICATE', `Operation ID 重复: ${operation.operationId}`)
      }
      operationIds.add(operation.operationId)
    }
  }

  private assertGeneration(node: DocumentNode, expected: number): void {
    if (node.generation !== expected) {
      failDocument('DOCUMENT_GENERATION_CONFLICT', '节点 Generation 不一致', {
        nodeId: node.nodeId,
        expected,
        actual: node.generation,
      })
    }
  }

  private assertHead(state: AuthorityState, expected: RevisionId): void {
    if (state.document.headRevisionId !== expected) {
      failDocument('DOCUMENT_REVISION_CONFLICT', 'Document Head Revision 不一致', {
        expected,
        actual: state.document.headRevisionId,
      })
    }
  }

  private requireDocument(documentId: DocumentId): AuthorityState {
    const state = this.documents.get(documentId)
    if (!state) failDocument('DOCUMENT_NOT_FOUND', `文档不存在: ${documentId}`)
    return state
  }

  private requireNode(
    nodes: Map<DocumentNodeId, DocumentNode>,
    nodeId: DocumentNodeId,
  ): DocumentNode {
    const node = nodes.get(nodeId)
    if (!node) failDocument('DOCUMENT_NODE_NOT_FOUND', `节点不存在: ${nodeId}`)
    return node
  }

  private requireChangeSet(changeSetId: ChangeSetId): DocumentChangeSet {
    const changeSet = this.changeSets.get(changeSetId)
    if (!changeSet) failDocument('CHANGESET_NOT_FOUND', `ChangeSet 不存在: ${changeSetId}`)
    return changeSet
  }

  private children(
    nodes: Map<DocumentNodeId, DocumentNode>,
    parentId: DocumentNodeId,
  ): DocumentNode[] {
    return [...nodes.values()]
      .filter((node) => node.parentId === parentId)
      .sort(
        (left, right) =>
          left.orderKey.localeCompare(right.orderKey) ||
          String(left.nodeId).localeCompare(String(right.nodeId)),
      )
  }

  private flatten(
    nodes: Map<DocumentNodeId, DocumentNode>,
    parentId: DocumentNodeId,
  ): DocumentNode[] {
    return this.children(nodes, parentId).flatMap((child) => [
      child,
      ...this.flatten(nodes, child.nodeId),
    ])
  }

  private descendantIds(
    nodes: Map<DocumentNodeId, DocumentNode>,
    parentId: DocumentNodeId,
  ): DocumentNodeId[] {
    return this.children(nodes, parentId).flatMap((child) => [
      child.nodeId,
      ...this.descendantIds(nodes, child.nodeId),
    ])
  }

  private snapshot(state: AuthorityState): DocumentSnapshot {
    const rootHash = documentRootHash(state.document, state.nodes.values())
    return {
      snapshotId: randomUUID() as SnapshotId,
      documentId: state.document.documentId,
      revisionId: state.document.headRevisionId,
      rootHash,
      document: cloneValue(state.document),
      nodes: cloneValue(
        [...state.nodes.values()].sort((left, right) =>
          String(left.nodeId).localeCompare(String(right.nodeId)),
        ),
      ),
      journalSequence: state.journal.length,
      createdAt: this.now(),
    }
  }

  private projection<T>(
    state: AuthorityState,
    format: DocumentProjection<T>['format'],
    content: T,
  ): DocumentProjection<T> {
    return {
      projectionId: `${state.document.documentId}:${state.document.headRevisionId}:${format}`,
      documentId: state.document.documentId,
      revisionId: state.document.headRevisionId,
      format,
      content: cloneValue(content),
      contentHash: contentHash(content),
      diagnostics: [],
      createdAt: this.now(),
    }
  }

  private nonEmpty(value: string, message: string): string {
    const normalized = value.trim()
    if (!normalized) failDocument('DOCUMENT_INVALID_ATTRIBUTE', message)
    return normalized
  }

  private now(): string {
    this.clock += 1
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, this.clock)).toISOString()
  }
}

export function asKernelNodeId(value: string): KernelNodeId {
  return value as KernelNodeId
}
