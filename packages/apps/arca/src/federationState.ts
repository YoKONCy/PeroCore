/**
 * federationState — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import type { DocumentId, SqliteDocumentEngine } from '@infos/document-engine'

export interface KernelDocumentHead {
  documentId: DocumentId
  authorityEpoch: number
  revisionId?: string
  rootHash?: string
}

export class ArcaFederationState {
  private readonly conflicts = new Map<DocumentId, number>()

  constructor(private readonly documents: SqliteDocumentEngine) {}

  resume(kernelHeads: KernelDocumentHead[]) {
    const kernelByDocument = new Map(kernelHeads.map((head) => [head.documentId, head]))
    const heads = this.documents.listDocuments().map((document) => {
      const snapshot = this.documents.inspect(document.documentId)
      const kernel = kernelByDocument.get(document.documentId)
      if (kernel && kernel.authorityEpoch > document.authorityEpoch) {
        this.conflicts.set(document.documentId, kernel.authorityEpoch)
      } else {
        this.conflicts.delete(document.documentId)
      }
      return {
        documentId: document.documentId,
        authorityEpoch: document.authorityEpoch,
        revisionId: snapshot.revisionId,
        rootHash: snapshot.rootHash,
        state: this.conflicts.has(document.documentId)
          ? ('authority_conflict' as const)
          : ('writable' as const),
      }
    })
    return {
      heads,
      pendingEvents: this.documents.listPendingOutbox(),
    }
  }

  requireWritable(documentId: DocumentId): void {
    const kernelEpoch = this.conflicts.get(documentId)
    if (kernelEpoch !== undefined) {
      throw new Error(`DOCUMENT_AUTHORITY_CONFLICT: Kernel Authority Epoch ${kernelEpoch} 更高`)
    }
  }

  state(documentId: DocumentId): 'writable' | 'authority_conflict' {
    return this.conflicts.has(documentId) ? 'authority_conflict' : 'writable'
  }
}
