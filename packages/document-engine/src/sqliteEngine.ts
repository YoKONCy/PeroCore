import { importMarkdown, type MarkdownImportInput } from './markdown'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import type { KernelObjectId, KernelObjectRef } from '@infos/shared'
import { cloneValue, contentHash } from './canonical'
import { DocumentEngineError, failDocument } from './errors'
import { InMemoryDocumentEngine } from './inMemoryEngine'
import {
  DOCUMENT_AUTHORITY_SCHEMA,
  DOCUMENT_AUTHORITY_SCHEMA_VERSION,
  type DocumentOutboxEvent,
  type PendingDocumentOutboxEvent,
} from './sqliteSchema'
import type {
  ChangeSetId,
  CollaborationBatch,
  CommentId,
  CommitChangeSetInput,
  CreateCommentInput,
  CreateDocumentInput,
  DocumentChangeSet,
  DocumentCommitReceipt,
  DocumentEngine,
  DocumentEngineCheckpoint,
  DocumentId,
  DocumentJournalEntry,
  DocumentProjection,
  DocumentRevision,
  DocumentSnapshot,
  DocumentTransactionRequest,
  HumanTextEditInput,
  OutlineNode,
  ProposeChangeSetInput,
  ReviewChangeSetInput,
} from './types'

interface StoredStateRow {
  protocol_version: number
  checkpoint_json: string
}

interface OutboxRow {
  event_sequence: number
  event_id: string
  event_type: string
  object_ref_json: string
  authority_epoch: number
  occurred_at: string
  payload_json: string
  status: 'pending' | 'published'
  published_at: string | null
}

export interface SqliteDocumentEngineOptions {
  readonly?: boolean
  busyTimeoutMs?: number
}

export class SqliteDocumentEngine implements DocumentEngine {
  private readonly sqlite: Database.Database
  private readonly engine = new InMemoryDocumentEngine()
  private closed = false

  constructor(databasePath: string, options: SqliteDocumentEngineOptions = {}) {
    this.sqlite = new Database(databasePath, { readonly: options.readonly ?? false })
    try {
      this.sqlite.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5_000}`)
      this.sqlite.pragma('foreign_keys = ON')
      if (!(options.readonly ?? false)) {
        this.sqlite.pragma('journal_mode = WAL')
        this.sqlite.pragma('synchronous = FULL')
        this.migrate()
      }
      this.restore()
    } catch (error) {
      this.sqlite.close()
      this.closed = true
      throw error
    }
  }

  createDocument(input: CreateDocumentInput): DocumentSnapshot {
    return this.mutate(
      () => this.engine.createDocument(input),
      (snapshot) => [
        this.outbox('document.created', snapshot, snapshot.document.createdAt, {
          documentId: snapshot.documentId,
          revisionId: snapshot.revisionId,
          rootHash: snapshot.rootHash,
        }),
      ],
    )
  }

  importMarkdown(input: MarkdownImportInput): DocumentSnapshot {
    return this.mutate(
      () => importMarkdown(this.engine, input),
      (snapshot) => [
        this.outbox(
          'document.imported',
          snapshot,
          snapshot.document.updatedAt,
          {
            documentId: snapshot.documentId,
            revisionId: snapshot.revisionId,
            rootHash: snapshot.rootHash,
            format: 'markdown',
          },
          `markdown-import:${snapshot.documentId}:${snapshot.revisionId}`,
        ),
      ],
    )
  }

  inspect(documentId: DocumentId): DocumentSnapshot {
    this.assertOpen()
    return this.engine.inspect(documentId)
  }

  listDocuments() {
    this.assertOpen()
    return this.engine.listDocuments()
  }

  editText(input: HumanTextEditInput): DocumentCommitReceipt {
    return this.mutate(
      () => this.engine.editText(input),
      (receipt) => [this.outboxFromReceipt('document.revision.committed', receipt)],
    )
  }

  transact(request: DocumentTransactionRequest): DocumentCommitReceipt {
    return this.mutate(
      () => this.engine.transact(request),
      (receipt) => [this.outboxFromReceipt('document.revision.committed', receipt)],
    )
  }

  propose(input: ProposeChangeSetInput): DocumentChangeSet {
    return this.mutate(
      () => this.engine.propose(input),
      (changeSet) => [
        this.outboxForDocument(
          'document.changeset.proposed',
          changeSet.documentId,
          changeSet.updatedAt,
          {
            changeSetId: changeSet.changeSetId,
            documentId: changeSet.documentId,
            baseRevisionId: changeSet.baseRevisionId,
            actorKind: changeSet.actorKind,
            risk: changeSet.risk,
          },
        ),
      ],
    )
  }

  getChangeSet(changeSetId: ChangeSetId) {
    this.assertOpen()
    return this.engine.getChangeSet(changeSetId)
  }

  listChangeSets(documentId: DocumentId) {
    this.assertOpen()
    return this.engine.listChangeSets(documentId)
  }

  diffChangeSet(changeSetId: ChangeSetId) {
    this.assertOpen()
    return this.engine.diffChangeSet(changeSetId)
  }

  projectAgentScene(
    documentId: DocumentId,
    currentNodeId?: Parameters<DocumentEngine['projectAgentScene']>[1],
  ) {
    this.assertOpen()
    return this.engine.projectAgentScene(documentId, currentNodeId)
  }

  createComment(input: CreateCommentInput) {
    return this.mutate(
      () => this.engine.createComment(input),
      (comment) => [
        this.outboxForDocument('document.comment.created', comment.documentId, comment.createdAt, {
          commentId: comment.commentId,
          nodeId: comment.nodeId,
          revisionId: comment.revisionId,
        }),
      ],
    )
  }

  listComments(documentId: DocumentId, nodeId?: Parameters<DocumentEngine['listComments']>[1]) {
    this.assertOpen()
    return this.engine.listComments(documentId, nodeId)
  }

  resolveComment(commentId: CommentId, resolverPrincipalId: string) {
    return this.mutate(
      () => this.engine.resolveComment(commentId, resolverPrincipalId),
      (comment) => [
        this.outboxForDocument('document.comment.resolved', comment.documentId, comment.updatedAt, {
          commentId: comment.commentId,
          resolvedBy: comment.resolvedBy ?? '',
        }),
      ],
    )
  }

  projectPresentation(documentId: DocumentId) {
    this.assertOpen()
    return this.engine.projectPresentation(documentId)
  }

  mergeCollaborationBatch(batch: CollaborationBatch) {
    return this.mutate(
      () => this.engine.mergeCollaborationBatch(batch),
      (result) =>
        result.receipt
          ? [this.outboxFromReceipt('document.collaboration.committed', result.receipt)]
          : [],
    )
  }

  mergeCollaborationBatches(batches: CollaborationBatch[]) {
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
    return this.mutate(
      () => this.engine.validate(changeSetId),
      (changeSet) => [
        this.outboxForDocument(
          'document.changeset.validated',
          changeSet.documentId,
          changeSet.updatedAt,
          {
            changeSetId: changeSet.changeSetId,
            status: changeSet.status,
          },
        ),
      ],
    )
  }

  review(input: ReviewChangeSetInput) {
    return this.mutate(
      () => this.engine.review(input),
      (review) => {
        const checkpoint = this.engine.exportCheckpoint()
        const changeSet = checkpoint.changeSets.find(
          (candidate) => candidate.changeSetId === review.changeSetId,
        )
        if (!changeSet) failDocument('CHANGESET_NOT_FOUND', 'Review 对应的 ChangeSet 不存在')
        return [
          this.outboxForDocument(
            'document.changeset.reviewed',
            changeSet.documentId,
            review.reviewedAt,
            {
              changeSetId: review.changeSetId,
              reviewId: review.reviewId,
              decision: review.decision,
              automatic: review.automatic,
            },
          ),
        ]
      },
    )
  }

  commitChangeSet(changeSetId: ChangeSetId, input: CommitChangeSetInput): DocumentCommitReceipt {
    return this.mutate(
      () => this.engine.commitChangeSet(changeSetId, input),
      (receipt) => [this.outboxFromReceipt('document.changeset.committed', receipt)],
    )
  }

  getRevision(revisionId: Parameters<DocumentEngine['getRevision']>[0]): DocumentRevision {
    this.assertOpen()
    return this.engine.getRevision(revisionId)
  }

  listJournal(documentId: DocumentId): DocumentJournalEntry[] {
    this.assertOpen()
    return this.engine.listJournal(documentId)
  }

  projectOutline(documentId: DocumentId): DocumentProjection<OutlineNode[]> {
    this.assertOpen()
    return this.engine.projectOutline(documentId)
  }

  projectPlainText(documentId: DocumentId): DocumentProjection<string> {
    this.assertOpen()
    return this.engine.projectPlainText(documentId)
  }

  exportCheckpoint(): DocumentEngineCheckpoint {
    this.assertOpen()
    return this.engine.exportCheckpoint()
  }

  restoreCheckpoint(checkpoint: DocumentEngineCheckpoint): void {
    this.mutate(
      () => {
        this.engine.restoreCheckpoint(checkpoint)
      },
      () => [],
    )
  }

  listPendingOutbox(limit = 100): DocumentOutboxEvent[] {
    this.assertOpen()
    const rows = this.sqlite
      .prepare(
        `SELECT event_sequence, event_id, event_type, object_ref_json, authority_epoch,
                occurred_at, payload_json, status, published_at
           FROM document_application_outbox
          WHERE status = 'pending'
          ORDER BY event_sequence ASC
          LIMIT ?`,
      )
      .all(Math.max(1, limit)) as OutboxRow[]
    return rows.map((row) => this.fromOutboxRow(row))
  }

  markOutboxPublished(eventId: string, publishedAt = new Date().toISOString()): boolean {
    this.assertOpen()
    const result = this.sqlite
      .prepare(
        `UPDATE document_application_outbox
            SET status = 'published', published_at = ?
          WHERE event_id = ? AND status = 'pending'`,
      )
      .run(publishedAt, eventId)
    return result.changes === 1
  }

  replayOutbox(eventId: string): boolean {
    this.assertOpen()
    const result = this.sqlite
      .prepare(
        `UPDATE document_application_outbox
            SET status = 'pending', published_at = NULL
          WHERE event_id = ? AND status = 'published'`,
      )
      .run(eventId)
    return result.changes === 1
  }

  cleanupPublishedOutbox(retainSince: Date): number {
    this.assertOpen()
    const result = this.sqlite
      .prepare(
        `DELETE FROM document_application_outbox
          WHERE status = 'published' AND published_at < ?`,
      )
      .run(retainSince.toISOString())
    return result.changes
  }

  close(): void {
    if (this.closed) return
    this.sqlite.close()
    this.closed = true
  }

  private mutate<T>(action: () => T, events: (result: T) => PendingDocumentOutboxEvent[]): T {
    this.assertOpen()
    const before = this.engine.exportCheckpoint()
    try {
      const result = action()
      const checkpoint = this.engine.exportCheckpoint()
      this.sqlite.transaction(() => {
        this.persist(checkpoint)
        for (const event of events(result)) this.insertOutbox(event)
      })()
      return cloneValue(result)
    } catch (error) {
      this.engine.restoreCheckpoint(before)
      if (error instanceof DocumentEngineError) throw error
      failDocument(
        'DOCUMENT_STORE_WRITE_FAILED',
        'Document Authority 持久化失败',
        { cause: error instanceof Error ? error.message : String(error) },
        true,
      )
    }
  }

  private persist(checkpoint: DocumentEngineCheckpoint): void {
    const updatedAt = this.latestTimestamp(checkpoint)
    this.sqlite
      .prepare(
        `INSERT INTO document_authority_state
          (singleton, protocol_version, checkpoint_json, updated_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           protocol_version = excluded.protocol_version,
           checkpoint_json = excluded.checkpoint_json,
           updated_at = excluded.updated_at`,
      )
      .run(checkpoint.protocolVersion, JSON.stringify(checkpoint), updatedAt)

    const upsertDocument = this.sqlite.prepare(
      `INSERT INTO documents
        (document_id, authority_node_id, authority_epoch, head_revision_id,
         generation, status, document_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(document_id) DO UPDATE SET
         authority_node_id = excluded.authority_node_id,
         authority_epoch = excluded.authority_epoch,
         head_revision_id = excluded.head_revision_id,
         generation = excluded.generation,
         status = excluded.status,
         document_json = excluded.document_json`,
    )
    const upsertNode = this.sqlite.prepare(
      `INSERT INTO document_nodes
        (document_id, node_id, parent_id, node_type, order_key, generation, node_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(document_id, node_id) DO UPDATE SET
         parent_id = excluded.parent_id,
         node_type = excluded.node_type,
         order_key = excluded.order_key,
         generation = excluded.generation,
         node_json = excluded.node_json`,
    )
    const deleteNodes = this.sqlite.prepare(
      `DELETE FROM document_nodes
        WHERE document_id = ? AND node_id NOT IN (SELECT value FROM json_each(?))`,
    )
    const insertRevision = this.sqlite.prepare(
      `INSERT OR IGNORE INTO document_revisions
        (revision_id, document_id, sequence, root_hash, committed_at, revision_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const insertOperation = this.sqlite.prepare(
      `INSERT OR IGNORE INTO document_operations
        (operation_id, document_id, revision_id, operation_index, operation_type, operation_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const insertReceipt = this.sqlite.prepare(
      `INSERT OR IGNORE INTO document_receipts
        (receipt_id, transaction_id, document_id, revision_id, status, receipt_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const insertIdempotency = this.sqlite.prepare(
      `INSERT OR IGNORE INTO document_idempotency_records
        (document_id, idempotency_key, fingerprint, receipt_id)
       VALUES (?, ?, ?, ?)`,
    )

    for (const authority of checkpoint.authorities) {
      const document = authority.document
      upsertDocument.run(
        document.documentId,
        document.authorityNodeId,
        document.authorityEpoch,
        document.headRevisionId,
        document.generation,
        document.status,
        JSON.stringify(document),
      )
      for (const node of authority.nodes) {
        upsertNode.run(
          node.documentId,
          node.nodeId,
          node.parentId,
          node.type,
          node.orderKey,
          node.generation,
          JSON.stringify(node),
        )
      }
      deleteNodes.run(
        document.documentId,
        JSON.stringify(authority.nodes.map((node) => node.nodeId)),
      )
      for (const revision of authority.revisions) {
        insertRevision.run(
          revision.revisionId,
          revision.documentId,
          revision.sequence,
          revision.rootHash,
          revision.committedAt,
          JSON.stringify(revision),
        )
      }
      for (const entry of authority.journal) {
        entry.operations.forEach((operation, index) =>
          insertOperation.run(
            operation.operationId,
            operation.documentId,
            entry.revision.revisionId,
            index,
            operation.type,
            JSON.stringify(operation),
          ),
        )
        insertReceipt.run(
          entry.receipt.receiptId,
          entry.receipt.transactionId,
          entry.receipt.documentId,
          entry.receipt.revisionId,
          entry.receipt.status,
          JSON.stringify(entry.receipt),
        )
      }
      for (const record of authority.idempotency) {
        insertIdempotency.run(
          document.documentId,
          record.key,
          record.fingerprint,
          record.receipt.receiptId,
        )
      }
    }

    const authorityIds = checkpoint.authorities.map((authority) => authority.document.documentId)
    const authorityIdsJson = JSON.stringify(authorityIds)
    const documentFilter = authorityIds.length
      ? 'document_id NOT IN (SELECT value FROM json_each(?))'
      : '1 = 1'
    const cleanupParams = authorityIds.length ? [authorityIdsJson] : []
    this.sqlite
      .prepare(
        `DELETE FROM document_reviews
          WHERE change_set_id IN (
            SELECT change_set_id FROM document_changesets WHERE ${documentFilter}
          )`,
      )
      .run(...cleanupParams)
    this.sqlite
      .prepare(`DELETE FROM document_changesets WHERE ${documentFilter}`)
      .run(...cleanupParams)
    this.sqlite
      .prepare(`DELETE FROM document_idempotency_records WHERE ${documentFilter}`)
      .run(...cleanupParams)
    this.sqlite
      .prepare(`DELETE FROM document_receipts WHERE ${documentFilter}`)
      .run(...cleanupParams)
    this.sqlite
      .prepare(`DELETE FROM document_operations WHERE ${documentFilter}`)
      .run(...cleanupParams)
    this.sqlite
      .prepare(`DELETE FROM document_revisions WHERE ${documentFilter}`)
      .run(...cleanupParams)
    this.sqlite.prepare(`DELETE FROM document_nodes WHERE ${documentFilter}`).run(...cleanupParams)
    this.sqlite.prepare(`DELETE FROM documents WHERE ${documentFilter}`).run(...cleanupParams)

    const upsertChangeSet = this.sqlite.prepare(
      `INSERT INTO document_changesets
        (change_set_id, document_id, base_revision_id, status, updated_at, change_set_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(change_set_id) DO UPDATE SET
         status = excluded.status,
         updated_at = excluded.updated_at,
         change_set_json = excluded.change_set_json`,
    )
    for (const changeSet of checkpoint.changeSets) {
      upsertChangeSet.run(
        changeSet.changeSetId,
        changeSet.documentId,
        changeSet.baseRevisionId,
        changeSet.status,
        changeSet.updatedAt,
        JSON.stringify(changeSet),
      )
    }
    const insertReview = this.sqlite.prepare(
      `INSERT OR IGNORE INTO document_reviews
        (review_id, change_set_id, decision, reviewed_at, review_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    for (const item of checkpoint.reviews) {
      insertReview.run(
        item.review.reviewId,
        item.changeSetId,
        item.review.decision,
        item.review.reviewedAt,
        JSON.stringify(item.review),
      )
    }
  }

  private restore(): void {
    this.assertOpen()
    const table = this.sqlite
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = 'document_authority_state'`,
      )
      .get() as { name: string } | undefined
    if (!table) return
    const row = this.sqlite
      .prepare(
        `SELECT protocol_version, checkpoint_json
           FROM document_authority_state WHERE singleton = 1`,
      )
      .get() as StoredStateRow | undefined
    if (!row) return
    if (row.protocol_version !== 1) {
      failDocument('DOCUMENT_CHECKPOINT_VERSION_UNSUPPORTED', '数据库 Checkpoint 版本不受支持')
    }
    try {
      this.engine.restoreCheckpoint(JSON.parse(row.checkpoint_json) as DocumentEngineCheckpoint)
    } catch (error) {
      failDocument('DOCUMENT_CHECKPOINT_CORRUPT', '数据库 Authority State 无法恢复', {
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private migrate(): void {
    this.sqlite.transaction(() => {
      this.sqlite.exec(DOCUMENT_AUTHORITY_SCHEMA)
      const row = this.sqlite
        .prepare(`SELECT value FROM document_store_metadata WHERE key = 'schema_version'`)
        .get() as { value: string } | undefined
      if (row && Number(row.value) > DOCUMENT_AUTHORITY_SCHEMA_VERSION) {
        failDocument('DOCUMENT_SCHEMA_VERSION_UNSUPPORTED', '数据库 Schema 版本高于当前引擎')
      }
      this.sqlite
        .prepare(
          `INSERT INTO document_store_metadata(key, value) VALUES ('schema_version', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(String(DOCUMENT_AUTHORITY_SCHEMA_VERSION))
    })()
  }

  private insertOutbox(event: PendingDocumentOutboxEvent): void {
    this.sqlite
      .prepare(
        `INSERT OR IGNORE INTO document_application_outbox
          (event_id, event_type, object_ref_json, authority_epoch,
           occurred_at, payload_json, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(
        event.eventId,
        event.type,
        JSON.stringify(event.objectRef),
        event.authorityEpoch,
        event.occurredAt,
        JSON.stringify(event.payload),
      )
  }

  private outboxFromReceipt(
    type: string,
    receipt: DocumentCommitReceipt,
  ): PendingDocumentOutboxEvent {
    return this.outboxForDocument(
      type,
      receipt.documentId,
      receipt.committedAt ?? new Date().toISOString(),
      {
        documentId: receipt.documentId,
        previousRevisionId: receipt.previousRevisionId,
        revisionId: receipt.revisionId,
        receiptId: receipt.receiptId,
        rootHash: receipt.rootHash ?? '',
      },
      `receipt:${receipt.receiptId}`,
    )
  }

  private outboxForDocument(
    type: string,
    documentId: DocumentId,
    occurredAt: string,
    payload: PendingDocumentOutboxEvent['payload'],
    identity?: string,
  ): PendingDocumentOutboxEvent {
    return this.outbox(type, this.engine.inspect(documentId), occurredAt, payload, identity)
  }

  private outbox(
    type: string,
    snapshot: DocumentSnapshot,
    occurredAt: string,
    payload: PendingDocumentOutboxEvent['payload'],
    identity: string = randomUUID(),
  ): PendingDocumentOutboxEvent {
    return {
      eventSequence: 0,
      eventId: `document-event-${contentHash({ type, identity }).slice(0, 32)}`,
      type,
      objectRef: this.objectRef(snapshot),
      authorityEpoch: snapshot.document.authorityEpoch,
      occurredAt,
      payload,
    }
  }

  private objectRef(snapshot: DocumentSnapshot): KernelObjectRef {
    return {
      objectType: 'document.semantic',
      objectId: snapshot.documentId as unknown as KernelObjectId,
      generation: snapshot.document.generation,
      ownerPrincipalId: snapshot.document.ownerPrincipalId,
      authorityNodeId: snapshot.document.authorityNodeId,
      authorityEpoch: snapshot.document.authorityEpoch,
    }
  }

  private fromOutboxRow(row: OutboxRow): DocumentOutboxEvent {
    return {
      eventSequence: row.event_sequence,
      eventId: row.event_id,
      type: row.event_type,
      objectRef: JSON.parse(row.object_ref_json) as KernelObjectRef,
      authorityEpoch: row.authority_epoch,
      occurredAt: row.occurred_at,
      payload: JSON.parse(row.payload_json) as DocumentOutboxEvent['payload'],
      status: row.status,
      ...(row.published_at ? { publishedAt: row.published_at } : {}),
    }
  }

  private latestTimestamp(checkpoint: DocumentEngineCheckpoint): string {
    const values = checkpoint.authorities.map((authority) => authority.document.updatedAt)
    return values.sort().at(-1) ?? new Date(0).toISOString()
  }

  private assertOpen(): void {
    if (this.closed) failDocument('DOCUMENT_STORE_CLOSED', 'Document Store 已关闭')
  }
}
