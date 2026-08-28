import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DocumentEngineError,
  SqliteDocumentEngine,
  asKernelNodeId,
  type ChangeSetId,
  type DocumentId,
  type DocumentNodeId,
  type DocumentOperation,
  type OperationId,
} from '@infos/document-engine'

const directories: string[] = []

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'infos-document-engine-'))
  directories.push(directory)
  return join(directory, 'authority.sqlite')
}

function createEngine(path = databasePath()) {
  return { path, engine: new SqliteDocumentEngine(path) }
}

function createDocument(engine: SqliteDocumentEngine) {
  return engine.createDocument({
    documentId: 'persistent-document' as DocumentId,
    rootNodeId: 'root' as DocumentNodeId,
    authorityNodeId: asKernelNodeId('application-node'),
    ownerPrincipalId: 'owner',
    title: '持久文档',
  })
}

function insertParagraph(
  snapshot: ReturnType<SqliteDocumentEngine['inspect']>,
  operationId = 'insert-paragraph',
): DocumentOperation {
  return {
    type: 'node.insert',
    operationId: operationId as OperationId,
    documentId: snapshot.documentId,
    actorPrincipalId: 'agent:writer',
    baseRevisionId: snapshot.revisionId,
    timestamp: '2026-08-18T00:00:00.000Z',
    node: {
      nodeId: 'paragraph' as DocumentNodeId,
      type: 'paragraph',
      parentId: snapshot.document.rootNodeId,
      orderKey: 'a',
      text: '持久化正文',
    },
    parentGeneration: 1,
  }
}

function transact(
  engine: SqliteDocumentEngine,
  snapshot: ReturnType<SqliteDocumentEngine['inspect']>,
  operations: DocumentOperation[],
  key: string,
) {
  return engine.transact({
    transactionId: `transaction:${key}`,
    documentId: snapshot.documentId,
    actorPrincipalId: 'agent:writer',
    baseRevisionId: snapshot.revisionId,
    operations,
    intent: '持久化测试',
    idempotencyKey: key,
  })
}

function code(action: () => unknown): string {
  try {
    action()
    return ''
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentEngineError)
    return (error as DocumentEngineError).kernelError.code
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('SQLite Document Authority A2', () => {
  it('重启后应恢复 Graph、Revision、Journal 和 Root Hash', () => {
    const { path, engine } = createEngine()
    const initial = createDocument(engine)
    const receipt = transact(engine, initial, [insertParagraph(initial)], 'persist')
    const expected = engine.inspect(initial.documentId)
    engine.close()

    const restored = new SqliteDocumentEngine(path)
    const actual = restored.inspect(initial.documentId)
    expect(actual.rootHash).toBe(expected.rootHash)
    expect(actual.revisionId).toBe(receipt.revisionId)
    expect(restored.projectPlainText(initial.documentId).content).toBe('持久化正文')
    expect(restored.listJournal(initial.documentId)).toHaveLength(1)
    restored.close()
  })

  it('重启后相同幂等请求应返回原 Receipt 且不重复 Outbox', () => {
    const { path, engine } = createEngine()
    const initial = createDocument(engine)
    const operations = [insertParagraph(initial)]
    const first = transact(engine, initial, operations, 'idempotent')
    expect(engine.listPendingOutbox()).toHaveLength(2)
    engine.close()

    const restored = new SqliteDocumentEngine(path)
    const second = transact(restored, initial, operations, 'idempotent')
    expect(second).toEqual(first)
    expect(restored.listJournal(initial.documentId)).toHaveLength(1)
    expect(restored.listPendingOutbox()).toHaveLength(2)
    restored.close()
  })

  it('重启后同一幂等键对应不同请求仍应拒绝', () => {
    const { path, engine } = createEngine()
    const initial = createDocument(engine)
    transact(engine, initial, [insertParagraph(initial)], 'conflict')
    engine.close()

    const restored = new SqliteDocumentEngine(path)
    expect(
      code(() =>
        restored.transact({
          transactionId: 'transaction:conflict',
          documentId: initial.documentId,
          actorPrincipalId: 'agent:writer',
          baseRevisionId: initial.revisionId,
          operations: [
            {
              ...insertParagraph(initial, 'other-operation'),
              node: {
                ...insertParagraph(initial).node,
                nodeId: 'other' as DocumentNodeId,
              },
            },
          ],
          intent: '持久化测试',
          idempotencyKey: 'conflict',
        }),
      ),
    ).toBe('DOCUMENT_IDEMPOTENCY_CONFLICT')
    restored.close()
  })

  it('ChangeSet 与批准 Review 应跨重启恢复并可继续提交', () => {
    const { path, engine } = createEngine()
    const initial = createDocument(engine)
    const changeSet = engine.propose({
      changeSetId: 'persistent-change' as ChangeSetId,
      documentId: initial.documentId,
      baseRevisionId: initial.revisionId,
      actorPrincipalId: 'agent:writer',
      actorKind: 'agent',
      intent: '插入段落',
      operations: [insertParagraph(initial)],
      risk: 'medium',
    })
    engine.validate(changeSet.changeSetId)
    engine.review({
      changeSetId: changeSet.changeSetId,
      reviewerPrincipalId: 'owner',
      decision: 'approve',
    })
    engine.close()

    const restored = new SqliteDocumentEngine(path)
    const receipt = restored.commitChangeSet(changeSet.changeSetId, {
      reviewerPrincipalId: 'owner',
      idempotencyKey: 'persistent-change-commit',
    })
    expect(receipt.status).toBe('committed')
    expect(restored.projectPlainText(initial.documentId).content).toBe('持久化正文')
    restored.close()
  })

  it('Outbox 应保持顺序并持久化 published 状态', () => {
    const { path, engine } = createEngine()
    const initial = createDocument(engine)
    transact(engine, initial, [insertParagraph(initial)], 'outbox')
    const pending = engine.listPendingOutbox()
    expect(pending.map((event) => event.type)).toEqual([
      'document.created',
      'document.revision.committed',
    ])
    expect(pending[0]!.eventSequence).toBeLessThan(pending[1]!.eventSequence)
    expect(engine.markOutboxPublished(pending[0]!.eventId, '2026-08-18T01:00:00.000Z')).toBe(true)
    expect(engine.markOutboxPublished(pending[0]!.eventId)).toBe(false)
    expect(engine.replayOutbox(pending[0]!.eventId)).toBe(true)
    expect(engine.markOutboxPublished(pending[0]!.eventId, '2020-01-01T00:00:00.000Z')).toBe(true)
    expect(engine.cleanupPublishedOutbox(new Date('2021-01-01T00:00:00.000Z'))).toBe(1)
    engine.close()

    const restored = new SqliteDocumentEngine(path)
    expect(restored.listPendingOutbox()).toEqual([
      expect.objectContaining({ eventId: pending[1]!.eventId }),
    ])
    restored.close()
  })

  it('SQLite 写入失败时应同时回滚内存 Authority 和数据库事务', () => {
    const { path, engine } = createEngine()
    const initial = createDocument(engine)
    const before = engine.inspect(initial.documentId)
    const sqlite = new Database(path)
    sqlite.exec(`
      CREATE TRIGGER reject_document_revision
      BEFORE INSERT ON document_revisions
      BEGIN
        SELECT RAISE(ABORT, '拒绝测试 Revision');
      END;
    `)
    sqlite.close()

    expect(code(() => transact(engine, initial, [insertParagraph(initial)], 'rollback'))).toBe(
      'DOCUMENT_STORE_WRITE_FAILED',
    )
    const after = engine.inspect(initial.documentId)
    expect(after.rootHash).toBe(before.rootHash)
    expect(after.revisionId).toBe(before.revisionId)
    expect(engine.listJournal(initial.documentId)).toHaveLength(0)
    expect(engine.listPendingOutbox()).toHaveLength(1)
    engine.close()

    const restored = new SqliteDocumentEngine(path)
    expect(restored.inspect(initial.documentId).rootHash).toBe(before.rootHash)
    expect(restored.listJournal(initial.documentId)).toHaveLength(0)
    restored.close()
  })

  it('领域提交、Receipt、Operation、Idempotency 和 Outbox 应同库落盘', () => {
    const { path, engine } = createEngine()
    const initial = createDocument(engine)
    transact(engine, initial, [insertParagraph(initial)], 'tables')
    engine.close()

    const sqlite = new Database(path, { readonly: true })
    const count = (table: string) =>
      (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
    expect(count('documents')).toBe(1)
    expect(count('document_nodes')).toBe(2)
    expect(count('document_revisions')).toBe(2)
    expect(count('document_operations')).toBe(1)
    expect(count('document_receipts')).toBe(1)
    expect(count('document_idempotency_records')).toBe(1)
    expect(count('document_application_outbox')).toBe(2)
    sqlite.close()
  })

  it('数据库 Authority Checkpoint 损坏时应拒绝启动', () => {
    const { path, engine } = createEngine()
    createDocument(engine)
    engine.close()
    const sqlite = new Database(path)
    sqlite
      .prepare(`UPDATE document_authority_state SET checkpoint_json = ? WHERE singleton = 1`)
      .run('{not-json')
    sqlite.close()
    expect(code(() => new SqliteDocumentEngine(path))).toBe('DOCUMENT_CHECKPOINT_CORRUPT')
  })

  it('关闭后的 Store 应拒绝继续操作', () => {
    const { engine } = createEngine()
    const initial = createDocument(engine)
    engine.close()
    expect(code(() => engine.inspect(initial.documentId))).toBe('DOCUMENT_STORE_CLOSED')
  })
})
