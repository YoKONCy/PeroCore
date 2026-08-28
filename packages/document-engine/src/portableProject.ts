import { randomUUID } from 'node:crypto'
import type { KernelNodeId } from '@infos/shared'
import { canonicalJson, cloneValue, documentRootHash } from './canonical'
import type { ContentAddressedBlobStore } from './blobStore'
import type { DocumentEngine, DocumentEngineCheckpoint, DocumentId, JsonValue } from './types'
import { createStoreZip, readStoreZip, sha256, type ZipEntry } from './zipStore'

export interface ArcaProjectManifest {
  format: 'infos.arca.project'
  formatVersion: 1
  packageId: string
  project: { projectId: string; title: string; description: string }
  exportedAt: string
  historyMode: 'snapshot' | 'full'
  documentIds: DocumentId[]
  entries: Array<{ path: string; byteLength: number; sha256: string }>
}

interface PortablePayload {
  protocolVersion: 1
  checkpoint: DocumentEngineCheckpoint
  provenance: { sourceAuthorityNodeIds: string[]; exportedAt: string }
}

export class ArcaPortableProjectPackage {
  constructor(
    private readonly engine: DocumentEngine,
    private readonly blobs: ContentAddressedBlobStore,
  ) {}

  export(input: {
    projectId?: string
    title: string
    description?: string
    documentIds: DocumentId[]
    historyMode?: 'snapshot' | 'full'
  }): Buffer {
    const checkpoint = this.selectCheckpoint(input.documentIds, input.historyMode ?? 'snapshot')
    const exportedAt = new Date().toISOString()
    const payload: PortablePayload = {
      protocolVersion: 1,
      checkpoint,
      provenance: {
        sourceAuthorityNodeIds: [
          ...new Set(checkpoint.authorities.map((authority) => authority.document.authorityNodeId)),
        ],
        exportedAt,
      },
    }
    const entries: ZipEntry[] = [
      { path: 'project.json', content: Buffer.from(canonicalJson(payload)) },
    ]
    for (const blobId of this.referencedBlobIds(checkpoint)) {
      const digest = blobId.slice('sha256:'.length)
      entries.push({
        path: `blobs/sha256/${digest.slice(0, 2)}/${digest.slice(2, 4)}/${digest}`,
        content: this.blobs.get(blobId),
      })
    }
    const manifest: ArcaProjectManifest = {
      format: 'infos.arca.project',
      formatVersion: 1,
      packageId: randomUUID(),
      project: {
        projectId: input.projectId ?? randomUUID(),
        title: input.title.trim(),
        description: input.description ?? '',
      },
      exportedAt,
      historyMode: input.historyMode ?? 'snapshot',
      documentIds: [...input.documentIds].sort(),
      entries: entries.map((entry) => ({
        path: entry.path,
        byteLength: entry.content.length,
        sha256: sha256(entry.content),
      })),
    }
    return createStoreZip([
      { path: 'manifest.json', content: Buffer.from(canonicalJson(manifest)) },
      ...entries,
    ])
  }

  importAsCopy(
    buffer: Buffer,
    authorityNodeId: KernelNodeId,
  ): {
    projectId: string
    documentIds: DocumentId[]
  } {
    const entries = readStoreZip(buffer)
    const manifest = this.json<ArcaProjectManifest>(entries, 'manifest.json')
    if (manifest.format !== 'infos.arca.project' || manifest.formatVersion !== 1) {
      throw new Error('ARCA_PACKAGE_VERSION_UNSUPPORTED')
    }
    for (const expected of manifest.entries) {
      const content = entries.get(expected.path)
      if (
        !content ||
        content.length !== expected.byteLength ||
        sha256(content) !== expected.sha256
      ) {
        throw new Error(`ARCA_PACKAGE_INTEGRITY_FAILED: ${expected.path}`)
      }
    }
    const allowed = new Set(['manifest.json', ...manifest.entries.map((entry) => entry.path)])
    for (const path of entries.keys())
      if (!allowed.has(path)) throw new Error(`ARCA_PACKAGE_ENTRY_UNDECLARED: ${path}`)
    const payload = this.json<PortablePayload>(entries, 'project.json')
    if (payload.protocolVersion !== 1) throw new Error('ARCA_PACKAGE_PAYLOAD_UNSUPPORTED')
    const payloadDocumentIds = payload.checkpoint.authorities
      .map((authority) => authority.document.documentId)
      .sort()
    if (canonicalJson(payloadDocumentIds) !== canonicalJson([...manifest.documentIds].sort())) {
      throw new Error('ARCA_PACKAGE_DOCUMENT_MANIFEST_MISMATCH')
    }

    const current = this.engine.exportCheckpoint()
    const existing = new Set(current.authorities.map((authority) => authority.document.documentId))
    for (const authority of payload.checkpoint.authorities) {
      if (existing.has(authority.document.documentId))
        throw new Error(`ARCA_PACKAGE_DOCUMENT_CONFLICT: ${authority.document.documentId}`)
      authority.document.authorityNodeId = authorityNodeId
      authority.document.authorityEpoch = 1
      authority.document.metadata = {
        ...authority.document.metadata,
        importProvenance: {
          packageId: manifest.packageId,
          sourceAuthorityNodeIds: payload.provenance.sourceAuthorityNodeIds,
          importedAsCopy: true,
        } as unknown as JsonValue,
      }
      const sourceHead = authority.revisions.find(
        (revision) => revision.revisionId === authority.document.headRevisionId,
      )
      if (!sourceHead) throw new Error('ARCA_PACKAGE_HEAD_MISSING')
      const importedRevisionId =
        `import:${manifest.packageId}:${authority.document.documentId}` as never
      authority.document.headRevisionId = importedRevisionId
      const rootHash = documentRootHash(authority.document, authority.nodes)
      authority.revisions.push({
        revisionId: importedRevisionId,
        documentId: authority.document.documentId,
        sequence: Math.max(...authority.revisions.map((revision) => revision.sequence), 0) + 1,
        parentRevisionIds: [sourceHead.revisionId],
        actorPrincipalId: 'system:arca-package-import',
        rootHash,
        operationIds: [],
        intent: '导入 Portable Project Package副本',
        committedAt: new Date().toISOString(),
      })
    }
    const merged: DocumentEngineCheckpoint = {
      protocolVersion: 1,
      clock: Math.max(current.clock, payload.checkpoint.clock),
      authorities: [...current.authorities, ...payload.checkpoint.authorities],
      changeSets: [...current.changeSets, ...payload.checkpoint.changeSets],
      reviews: [...current.reviews, ...payload.checkpoint.reviews],
      semanticDiffs: [
        ...(current.semanticDiffs ?? []),
        ...(payload.checkpoint.semanticDiffs ?? []),
      ],
      comments: [...(current.comments ?? []), ...(payload.checkpoint.comments ?? [])],
      collaborationBatches: [
        ...(current.collaborationBatches ?? []),
        ...(payload.checkpoint.collaborationBatches ?? []),
      ],
    }
    const before = cloneValue(current)
    try {
      for (const expected of manifest.entries.filter((entry) => entry.path.startsWith('blobs/'))) {
        this.blobs.put(entries.get(expected.path)!)
      }
      this.engine.restoreCheckpoint(merged)
    } catch (error) {
      this.engine.restoreCheckpoint(before)
      throw error
    }
    return { projectId: randomUUID(), documentIds: manifest.documentIds }
  }

  private selectCheckpoint(
    documentIds: DocumentId[],
    historyMode: 'snapshot' | 'full',
  ): DocumentEngineCheckpoint {
    if (!documentIds.length) throw new Error('ARCA_PACKAGE_EMPTY_PROJECT')
    const selected = new Set(documentIds)
    const source = this.engine.exportCheckpoint()
    const authorities = source.authorities.filter((authority) =>
      selected.has(authority.document.documentId),
    )
    if (authorities.length !== selected.size) throw new Error('ARCA_PACKAGE_DOCUMENT_NOT_FOUND')
    if (historyMode === 'full') {
      const changeSets = source.changeSets.filter((changeSet) => selected.has(changeSet.documentId))
      const changeSetIds = new Set(changeSets.map((changeSet) => changeSet.changeSetId))
      return {
        ...source,
        authorities,
        changeSets,
        reviews: source.reviews.filter((review) => changeSetIds.has(review.changeSetId)),
        semanticDiffs: (source.semanticDiffs ?? []).filter((entry) =>
          changeSetIds.has(entry.changeSetId),
        ),
        comments: (source.comments ?? []).filter((comment) => selected.has(comment.documentId)),
        collaborationBatches: (source.collaborationBatches ?? []).filter((entry) =>
          selected.has(entry.batch.documentId),
        ),
      }
    }
    return {
      protocolVersion: 1,
      clock: source.clock,
      authorities: authorities.map((authority) => ({
        ...authority,
        revisions: authority.revisions.filter(
          (revision) => revision.revisionId === authority.document.headRevisionId,
        ),
        journal: [],
        operationIds: [],
        idempotency: [],
      })),
      changeSets: [],
      reviews: [],
      semanticDiffs: [],
    }
  }

  private referencedBlobIds(checkpoint: DocumentEngineCheckpoint): string[] {
    const ids = new Set<string>()
    const visit = (value: JsonValue): void => {
      if (typeof value === 'string' && value.startsWith('sha256:')) ids.add(value)
      else if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') Object.values(value).forEach(visit)
    }
    checkpoint.authorities.forEach((authority) =>
      authority.nodes.forEach((node) => visit(node.attributes)),
    )
    return [...ids].sort()
  }

  private json<T>(entries: Map<string, Buffer>, path: string): T {
    const content = entries.get(path)
    if (!content) throw new Error(`ARCA_PACKAGE_ENTRY_MISSING: ${path}`)
    return JSON.parse(content.toString('utf8')) as T
  }
}
