import type { ContentAddressedBlobStore } from './blobStore'
import { projectHtml } from './contentModel'
import { projectMarkdown } from './markdown'
import { ArcaPortableProjectPackage } from './portableProject'
import type {
  DocumentEngine,
  DocumentId,
  DocumentProjection,
  PresentationProjection,
} from './types'

export type DocumentExportResult =
  | (DocumentProjection<string> & { format: 'plain-text' | 'markdown' | 'html' })
  | PresentationProjection
  | { format: 'checkpoint'; content: Buffer; contentType: 'application/json' }
  | { format: 'portable-project'; content: Buffer; contentType: 'application/zip' }

/** Document Runtime统一导出入口；所有格式从同一Authority快照生成。 */
export class DocumentExportService {
  constructor(
    private readonly engine: DocumentEngine,
    private readonly blobs?: ContentAddressedBlobStore,
  ) {}

  export(
    documentId: DocumentId,
    format: 'plain-text' | 'markdown' | 'html' | 'presentation',
  ): DocumentExportResult
  export(documentId: DocumentId, format: 'checkpoint'): DocumentExportResult
  export(
    documentId: DocumentId,
    format: 'portable-project',
    options: { title: string; projectId?: string; historyMode?: 'snapshot' | 'full' },
  ): DocumentExportResult
  export(
    documentId: DocumentId,
    format: 'plain-text' | 'markdown' | 'html' | 'presentation' | 'checkpoint' | 'portable-project',
    options?: { title: string; projectId?: string; historyMode?: 'snapshot' | 'full' },
  ): DocumentExportResult {
    this.engine.inspect(documentId)
    if (format === 'plain-text') {
      return {
        ...this.engine.projectPlainText(documentId),
        format: 'plain-text',
      }
    }
    if (format === 'markdown') return projectMarkdown(this.engine, documentId)
    if (format === 'html') return projectHtml(this.engine, documentId)
    if (format === 'presentation') return this.engine.projectPresentation(documentId)
    if (format === 'checkpoint') {
      return {
        format,
        content: Buffer.from(JSON.stringify(this.engine.exportCheckpoint())),
        contentType: 'application/json',
      }
    }
    if (!this.blobs || !options) throw new Error('DOCUMENT_PORTABLE_EXPORT_REQUIRES_BLOB_STORE')
    return {
      format,
      content: new ArcaPortableProjectPackage(this.engine, this.blobs).export({
        projectId: options.projectId,
        title: options.title,
        documentIds: [documentId],
        historyMode: options.historyMode,
      }),
      contentType: 'application/zip',
    }
  }
}
