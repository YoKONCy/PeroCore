import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ArcaPortableProjectPackage,
  ContentAddressedBlobStore,
  InMemoryDocumentEngine,
  SqliteDocumentEngine,
  asKernelNodeId,
  type CollaborationBatch,
  type CollaborationBatchId,
  type DocumentId,
  type DocumentNodeId,
  type DocumentOperation,
  type OperationId,
} from '@infos/document-engine'

const directories: string[] = []
function directory(): string {
  const value = mkdtempSync(join(tmpdir(), 'infos-arca-advanced-'))
  directories.push(value)
  return value
}

afterEach(() => {
  directories.splice(0).forEach((value) => rmSync(value, { recursive: true, force: true }))
})

function createDocument(engine: InMemoryDocumentEngine) {
  return engine.createDocument({
    documentId: 'advanced-document' as DocumentId,
    rootNodeId: 'root' as DocumentNodeId,
    authorityNodeId: asKernelNodeId('node-source'),
    ownerPrincipalId: 'owner',
    title: '高级文档能力',
  })
}

function insert(
  snapshot: ReturnType<InMemoryDocumentEngine['inspect']>,
  input: {
    id: string
    type: 'heading' | 'paragraph' | 'table' | 'table-row' | 'table-cell' | 'citation'
    parentId: DocumentNodeId
    orderKey: string
    text?: string
    attributes?: Record<string, never | string | number | boolean>
    parentGeneration: number
  },
): DocumentOperation {
  return {
    operationId: `operation:${input.id}` as OperationId,
    documentId: snapshot.documentId,
    actorPrincipalId: 'human:tester',
    baseRevisionId: snapshot.revisionId,
    timestamp: '2026-08-18T00:00:00.000Z',
    type: 'node.insert',
    node: {
      nodeId: input.id as DocumentNodeId,
      type: input.type,
      parentId: input.parentId,
      orderKey: input.orderKey,
      ...(input.text === undefined ? {} : { text: input.text }),
      attributes: input.attributes ?? {},
    },
    parentGeneration: input.parentGeneration,
  }
}

describe('Document Engine 高级领域能力', () => {
  it('Portable Package 应验证完整性并导入为当前 Node 的 Authority Material', () => {
    const sourceRoot = directory()
    const targetRoot = directory()
    const source = new SqliteDocumentEngine(join(sourceRoot, 'source.sqlite'))
    const sourceBlobs = new ContentAddressedBlobStore(join(sourceRoot, 'blobs'))
    const snapshot = source.createDocument({
      documentId: 'portable-document' as DocumentId,
      authorityNodeId: asKernelNodeId('node-source'),
      ownerPrincipalId: 'owner',
      title: '便携工程',
    })
    const exporter = new ArcaPortableProjectPackage(source, sourceBlobs)
    const archive = exporter.export({
      projectId: 'project-source',
      title: '便携工程',
      documentIds: [snapshot.documentId],
      historyMode: 'full',
    })
    expect(archive.readUInt32LE(0)).toBe(0x04034b50)

    const target = new SqliteDocumentEngine(join(targetRoot, 'target.sqlite'))
    const targetBlobs = new ContentAddressedBlobStore(join(targetRoot, 'blobs'))
    const importer = new ArcaPortableProjectPackage(target, targetBlobs)
    const imported = importer.importAsCopy(archive, asKernelNodeId('node-target'))
    expect(imported.documentIds).toEqual([snapshot.documentId])
    const restored = target.inspect(snapshot.documentId)
    expect(restored.document.authorityNodeId).toBe('node-target')
    expect(restored.document.authorityEpoch).toBe(1)
    expect(restored.revisionId).not.toBe(snapshot.revisionId)
    expect(restored.document.metadata.importProvenance).toEqual(
      expect.objectContaining({ importedAsCopy: true }),
    )

    const corrupted = Buffer.from(archive)
    const marker = corrupted.indexOf(Buffer.from('project.json'))
    corrupted[marker + 'project.json'.length + 35] ^= 0xff
    expect(() => importer.importAsCopy(corrupted, asKernelNodeId('node-target'))).toThrow()
    source.close()
    target.close()
    const reopened = new SqliteDocumentEngine(join(targetRoot, 'target.sqlite'))
    expect(reopened.inspect(snapshot.documentId).revisionId).toBe(restored.revisionId)
    reopened.close()
  })

  it('Table 与 Citation 应作为受结构约束的语义节点提交', () => {
    const engine = new InMemoryDocumentEngine()
    const initial = createDocument(engine)
    const table = insert(initial, {
      id: 'table',
      type: 'table',
      parentId: initial.document.rootNodeId,
      orderKey: 'a',
      parentGeneration: 1,
    })
    const tableReceipt = engine.transact({
      transactionId: 'insert-table',
      documentId: initial.documentId,
      actorPrincipalId: 'human:tester',
      baseRevisionId: initial.revisionId,
      operations: [table],
      intent: '插入表格',
      idempotencyKey: 'insert-table',
    })
    const afterTable = engine.inspect(initial.documentId)
    const row = insert(afterTable, {
      id: 'row',
      type: 'table-row',
      parentId: 'table' as DocumentNodeId,
      orderKey: 'a',
      parentGeneration: 1,
    })
    engine.transact({
      transactionId: 'insert-row',
      documentId: initial.documentId,
      actorPrincipalId: 'human:tester',
      baseRevisionId: tableReceipt.revisionId,
      operations: [row],
      intent: '插入表格行',
      idempotencyKey: 'insert-row',
    })
    const afterRow = engine.inspect(initial.documentId)
    const cell = insert(afterRow, {
      id: 'cell',
      type: 'table-cell',
      parentId: 'row' as DocumentNodeId,
      orderKey: 'a',
      text: '数据',
      parentGeneration: 1,
    })
    const citation = insert(afterRow, {
      id: 'citation',
      type: 'citation',
      parentId: initial.document.rootNodeId,
      orderKey: 'b',
      text: '[1]',
      attributes: { sourceId: 'source-1', locator: 'p. 7' },
      parentGeneration: afterRow.nodes.find((node) => node.nodeId === initial.document.rootNodeId)!
        .generation,
    })
    expect(() =>
      engine.transact({
        transactionId: 'invalid-cell',
        documentId: initial.documentId,
        actorPrincipalId: 'human:tester',
        baseRevisionId: afterRow.revisionId,
        operations: [
          {
            ...cell,
            node: { ...cell.node, parentId: initial.document.rootNodeId },
            parentGeneration: afterRow.nodes.find(
              (node) => node.nodeId === initial.document.rootNodeId,
            )!.generation,
          },
        ],
        intent: '非法单元格',
        idempotencyKey: 'invalid-cell',
      }),
    ).toThrow(/table-cell/)
    engine.transact({
      transactionId: 'insert-content',
      documentId: initial.documentId,
      actorPrincipalId: 'human:tester',
      baseRevisionId: afterRow.revisionId,
      operations: [cell, citation],
      intent: '插入表格内容与引用',
      idempotencyKey: 'insert-content',
    })
    expect(engine.inspect(initial.documentId).nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'cell', type: 'table-cell', text: '数据' }),
        expect.objectContaining({
          nodeId: 'citation',
          attributes: { sourceId: 'source-1', locator: 'p. 7' },
        }),
      ]),
    )
  })

  it('Comment 应锚定 Node/Revision 且不改变 Document Root Hash', () => {
    const engine = new InMemoryDocumentEngine()
    const snapshot = createDocument(engine)
    const before = snapshot.rootHash
    const comment = engine.createComment({
      documentId: snapshot.documentId,
      nodeId: snapshot.document.rootNodeId,
      revisionId: snapshot.revisionId,
      authorPrincipalId: 'human:reviewer',
      body: '需要补充说明',
    })
    expect(engine.inspect(snapshot.documentId).rootHash).toBe(before)
    expect(engine.listComments(snapshot.documentId)).toEqual([comment])
    expect(engine.resolveComment(comment.commentId, 'human:owner')).toEqual(
      expect.objectContaining({ status: 'resolved', resolvedBy: 'human:owner' }),
    )
  })

  it('Presentation Projection 应按 Heading 确定性切分且不创建新 Authority', () => {
    const engine = new InMemoryDocumentEngine()
    const snapshot = createDocument(engine)
    const heading = insert(snapshot, {
      id: 'heading',
      type: 'heading',
      parentId: snapshot.document.rootNodeId,
      orderKey: 'a',
      text: '第一部分',
      attributes: { level: 1 },
      parentGeneration: 1,
    })
    engine.transact({
      transactionId: 'presentation-content',
      documentId: snapshot.documentId,
      actorPrincipalId: 'human:tester',
      baseRevisionId: snapshot.revisionId,
      operations: [heading],
      intent: '创建演示结构',
      idempotencyKey: 'presentation-content',
    })
    const first = engine.projectPresentation(snapshot.documentId)
    const second = engine.projectPresentation(snapshot.documentId)
    expect(first.content).toEqual([
      expect.objectContaining({ title: '第一部分', sourceNodeId: 'heading' }),
    ])
    expect(first.contentHash).toBe(second.contentHash)
    expect(engine.listDocuments()).toHaveLength(1)
  })

  it('Collaboration Batch 应幂等接纳当前 Head 并拒绝过期 Base Revision', () => {
    const engine = new InMemoryDocumentEngine()
    const snapshot = createDocument(engine)
    const paragraph = insert(snapshot, {
      id: 'paragraph',
      type: 'paragraph',
      parentId: snapshot.document.rootNodeId,
      orderKey: 'a',
      text: '离线正文',
      parentGeneration: 1,
    })
    const batch: CollaborationBatch = {
      batchId: 'batch-1' as CollaborationBatchId,
      documentId: snapshot.documentId,
      actorId: 'human:tester',
      lamport: 1,
      baseRevisionId: snapshot.revisionId,
      operations: [paragraph],
      createdAt: '2026-08-18T00:00:00.000Z',
    }
    expect(engine.mergeCollaborationBatch(batch).status).toBe('committed')
    expect(engine.mergeCollaborationBatch(batch).status).toBe('duplicate')
    const staleBatch = {
      ...batch,
      batchId: 'batch-2' as CollaborationBatchId,
      lamport: 2,
    }
    const laterBatch = {
      ...batch,
      batchId: 'batch-3' as CollaborationBatchId,
      lamport: 3,
    }
    const ordered = engine.mergeCollaborationBatches([laterBatch, staleBatch])
    expect(ordered.map((result) => result.batchId)).toEqual(['batch-2', 'batch-3'])
    const stale = ordered[0]!
    expect(stale).toEqual(
      expect.objectContaining({
        status: 'conflicted',
        conflict: expect.objectContaining({ code: 'base_revision_conflict' }),
      }),
    )
  })
})
