/**
 * draftStore — 客户端服务
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import type { DocumentId, DocumentNodeId, RevisionId } from '@infos/document-engine'

export interface PersistedDocumentDraft {
  protocolVersion: 1
  documentId: DocumentId
  nodeId: DocumentNodeId
  baseRevisionId: RevisionId
  expectedGeneration: number
  value: string
  updatedAt: string
}

const PREFIX = 'arca-draft:'

export class DocumentDraftStore {
  save(draft: PersistedDocumentDraft): void {
    localStorage.setItem(`${PREFIX}${draft.documentId}:${draft.nodeId}`, JSON.stringify(draft))
  }

  get(documentId: DocumentId, nodeId: DocumentNodeId): PersistedDocumentDraft | undefined {
    const raw = localStorage.getItem(`${PREFIX}${documentId}:${nodeId}`)
    if (!raw) return undefined
    const draft = JSON.parse(raw) as PersistedDocumentDraft
    return draft.protocolVersion === 1 ? draft : undefined
  }

  list(documentId: DocumentId): PersistedDocumentDraft[] {
    const prefix = `${PREFIX}${documentId}:`
    const drafts: PersistedDocumentDraft[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      try {
        const draft = JSON.parse(localStorage.getItem(key) ?? '') as PersistedDocumentDraft
        if (draft.protocolVersion === 1) drafts.push(draft)
      } catch {
        //损坏的本地草稿不会阻止其他文档恢复。
      }
    }
    return drafts.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
  }

  remove(documentId: DocumentId, nodeId: DocumentNodeId): void {
    localStorage.removeItem(`${PREFIX}${documentId}:${nodeId}`)
  }
}
