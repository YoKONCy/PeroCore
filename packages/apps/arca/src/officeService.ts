import {
  compileOfficeEdit,
  officeContent,
  projectHtml,
  type DocumentId,
  type DocumentSnapshot,
  type OfficeEditRequest,
  type OfficeEditResult,
  type RevisionId,
  type SqliteDocumentEngine,
} from '@infos/document-engine'
import {
  InMemoryDocumentEngine,
  type ChangeSetId,
  type ContentAddressedBlobStore,
} from '@infos/document-engine'
import { officeTableGrid } from '@infos/document-engine/officeTable'

export class ArcaOfficeService {
  constructor(
    private readonly engine: SqliteDocumentEngine,
    private readonly blobs?: ContentAddressedBlobStore,
  ) {}

  apply(request: OfficeEditRequest, actor: string): OfficeEditResult {
    const baseline = this.engine.snapshotAt(request.documentId, request.baseRevisionId)
    const transaction = compileOfficeEdit(baseline, request, actor)
    for (const node of request.content.nodes)
      if (node.type === 'table') officeTableGrid(request.content, node.nodeId)
    if (!transaction.operations.length) {
      const snapshot = this.engine.inspect(request.documentId)
      if (snapshot.revisionId !== request.baseRevisionId)
        throw new Error('DOCUMENT_REVISION_CONFLICT: 文稿已在其他位置修改，请先核对差异')
      return { receipt: null, snapshot }
    }
    const receipt = this.engine.transact(transaction)
    return { receipt, snapshot: this.engine.snapshotAt(request.documentId, receipt.revisionId) }
  }

  restore(
    input: {
      documentId: DocumentId
      baseRevisionId: RevisionId
      revisionId: RevisionId
      transactionId: string
      timestamp: string
    },
    actor: string,
  ): OfficeEditResult {
    const historical = this.engine.snapshotAt(input.documentId, input.revisionId)
    return this.apply(
      { ...input, intent: `恢复文稿版本 ${input.revisionId}`, content: officeContent(historical) },
      actor,
    )
  }

  preview(
    documentId: DocumentId,
    revisionId?: RevisionId,
  ): { snapshot: DocumentSnapshot; html: string } {
    const snapshot = revisionId
      ? this.engine.snapshotAt(documentId, revisionId)
      : this.engine.inspect(documentId)
    return { snapshot, html: this.html(snapshot) }
  }
  previewChangeSet(changeSetId: ChangeSetId): {
    before: string
    after: string
    baseRevisionId: RevisionId
  } {
    const proposal = this.engine.getChangeSet(changeSetId),
      snapshot = this.engine.snapshotAt(proposal.documentId, proposal.baseRevisionId)
    const authority = this.engine
      .exportCheckpoint()
      .authorities.find((item) => item.document.documentId === snapshot.documentId)!
    const sequence = authority.revisions.find(
      (item) => item.revisionId === snapshot.revisionId,
    )!.sequence
    const journal = authority.journal.filter((entry) => entry.sequence <= sequence)
    const preview = new InMemoryDocumentEngine()
    preview.restoreCheckpoint({
      protocolVersion: 1,
      clock: Date.now(),
      authorities: [
        {
          document: snapshot.document,
          nodes: snapshot.nodes,
          revisions: authority.revisions.filter((item) => item.sequence <= sequence),
          journal,
          operationIds: journal.flatMap((entry) =>
            entry.operations.map((operation) => operation.operationId),
          ),
          idempotency: [],
        },
      ],
      changeSets: [],
      reviews: [],
    })
    preview.transact({
      transactionId: `preview:${changeSetId}`,
      documentId: snapshot.documentId,
      baseRevisionId: snapshot.revisionId,
      actorPrincipalId: proposal.actorPrincipalId,
      intent: proposal.intent,
      operations: proposal.operations,
      idempotencyKey: `preview:${changeSetId}`,
    })
    return {
      before: this.html(snapshot),
      after: this.html(preview.inspect(snapshot.documentId)),
      baseRevisionId: snapshot.revisionId,
    }
  }
  private html(snapshot: DocumentSnapshot): string {
    let embeddedBytes = 0
    return projectHtml({ inspect: () => snapshot } as never, snapshot.documentId, {
      resolveAsset: (node) => {
        const mime = String(node.attributes.mimeType),
          id = String(node.attributes.blobId)
        if (
          !this.blobs ||
          !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime) ||
          !/^sha256:[a-f0-9]{64}$/.test(id) ||
          !this.blobs.has(id)
        )
          return undefined
        const bytes = this.blobs.get(id)
        embeddedBytes += bytes.byteLength
        if (embeddedBytes > 20 * 1024 * 1024)
          throw new Error(
            '本次 HTML 预览的图片总量超过 20 MB，请缩小图片后重试；工程内原始资源仍保留',
          )
        return `data:${mime};base64,${bytes.toString('base64')}`
      },
    }).content
  }
}
