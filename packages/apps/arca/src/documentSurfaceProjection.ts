/**
 * documentSurfaceProjection — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import type {
  DocumentSurfaceProps,
  SurfaceDescriptor,
  SurfaceId,
  SurfaceNodeId,
  SurfaceProjectionSnapshot,
} from '@infos/shared'
import type { DocumentProjection } from '@infos/document-engine'

export function projectDocumentSurface(
  projection: DocumentProjection<unknown>,
  principalId: string,
): SurfaceProjectionSnapshot {
  const scopeId = `document:${projection.documentId}`
  const descriptor: SurfaceDescriptor = {
    surfaceId: `document:${projection.documentId}:${projection.format}` as SurfaceId,
    generation: `${projection.revisionId}:${projection.contentHash}`,
    threadId: scopeId,
    principalId,
    revision: 1,
    sequence: 0,
    state: 'committed',
    nodes: [
      {
        nodeId: `document:${projection.documentId}:${projection.format}:content` as SurfaceNodeId,
        kind: 'document',
        lifecycle: projection.format === 'presentation' ? 'heavy' : 'stable',
        revision: 1,
        props: {
          documentId: projection.documentId,
          revisionId: projection.revisionId,
          format:
            projection.format === 'presentation'
              ? 'presentation'
              : projection.format === 'html'
                ? 'html'
                : 'markdown',
          contentHash: projection.contentHash,
          content: projection.content,
        } satisfies DocumentSurfaceProps,
      },
    ],
  }
  return {
    protocolVersion: 1,
    scopeId,
    principalId,
    revision: 1,
    generatedAt: new Date().toISOString(),
    surfaces: [descriptor],
  }
}
