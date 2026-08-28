// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { DocumentId, DocumentNodeId, RevisionId } from '@infos/document-engine'
import { DocumentDraftStore } from '../src/services/draftStore'

const store = new DocumentDraftStore()
const documentId = 'draft-document' as DocumentId
const nodeId = 'draft-node' as DocumentNodeId

afterEach(() => localStorage.clear())

describe('Arca A11 Draft Recovery', () => {
  it('应跨 Client Store 实例恢复本地 Draft 与基础 Revision', () => {
    store.save({
      protocolVersion: 1,
      documentId,
      nodeId,
      baseRevisionId: 'revision-1' as RevisionId,
      expectedGeneration: 3,
      value: '未提交正文',
      updatedAt: '2026-08-18T00:00:00.000Z',
    })
    const restored = new DocumentDraftStore().get(documentId, nodeId)
    expect(restored).toEqual(
      expect.objectContaining({
        baseRevisionId: 'revision-1',
        expectedGeneration: 3,
        value: '未提交正文',
      }),
    )
  })

  it('删除已提交 Draft 后不应再次恢复', () => {
    store.save({
      protocolVersion: 1,
      documentId,
      nodeId,
      baseRevisionId: 'revision-1' as RevisionId,
      expectedGeneration: 3,
      value: '正文',
      updatedAt: '2026-08-18T00:00:00.000Z',
    })
    store.remove(documentId, nodeId)
    expect(store.get(documentId, nodeId)).toBeUndefined()
  })
})
