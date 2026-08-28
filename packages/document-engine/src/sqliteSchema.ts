import type { KernelObjectRef } from '@infos/shared'
import type { JsonValue } from './types'

export interface DocumentOutboxEvent {
  eventSequence: number
  eventId: string
  type: string
  objectRef: KernelObjectRef
  authorityEpoch: number
  occurredAt: string
  payload: JsonValue
  status: 'pending' | 'published'
  publishedAt?: string
}

export type PendingDocumentOutboxEvent = Omit<DocumentOutboxEvent, 'status' | 'publishedAt'>

export const DOCUMENT_AUTHORITY_SCHEMA_VERSION = 1

export const DOCUMENT_AUTHORITY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS document_store_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS document_authority_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    protocol_version INTEGER NOT NULL,
    checkpoint_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    document_id TEXT PRIMARY KEY,
    authority_node_id TEXT NOT NULL,
    authority_epoch INTEGER NOT NULL,
    head_revision_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    status TEXT NOT NULL,
    document_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS document_nodes (
    document_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    parent_id TEXT,
    node_type TEXT NOT NULL,
    order_key TEXT NOT NULL,
    generation INTEGER NOT NULL,
    node_json TEXT NOT NULL,
    PRIMARY KEY (document_id, node_id),
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_document_nodes_parent_order
    ON document_nodes(document_id, parent_id, order_key, node_id);

  CREATE TABLE IF NOT EXISTS document_revisions (
    revision_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    root_hash TEXT NOT NULL,
    committed_at TEXT NOT NULL,
    revision_json TEXT NOT NULL,
    UNIQUE(document_id, sequence),
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS document_operations (
    operation_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    operation_index INTEGER NOT NULL,
    operation_type TEXT NOT NULL,
    operation_json TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE RESTRICT,
    FOREIGN KEY (revision_id) REFERENCES document_revisions(revision_id) ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS idx_document_operations_revision
    ON document_operations(revision_id, operation_index);

  CREATE TABLE IF NOT EXISTS document_receipts (
    receipt_id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    status TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    UNIQUE(document_id, transaction_id),
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE RESTRICT,
    FOREIGN KEY (revision_id) REFERENCES document_revisions(revision_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS document_changesets (
    change_set_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    base_revision_id TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    change_set_json TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS document_reviews (
    review_id TEXT PRIMARY KEY,
    change_set_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    review_json TEXT NOT NULL,
    FOREIGN KEY (change_set_id) REFERENCES document_changesets(change_set_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS document_idempotency_records (
    document_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    receipt_id TEXT NOT NULL,
    PRIMARY KEY (document_id, idempotency_key),
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE RESTRICT,
    FOREIGN KEY (receipt_id) REFERENCES document_receipts(receipt_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS document_application_outbox (
    event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    object_ref_json TEXT NOT NULL,
    authority_epoch INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    published_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_document_outbox_status_sequence
    ON document_application_outbox(status, event_sequence);
`
