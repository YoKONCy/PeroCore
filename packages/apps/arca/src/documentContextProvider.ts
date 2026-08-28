/**
 * documentContextProvider — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import type { ContextRegion, KernelNodeId, KernelObjectId, KernelObjectRef } from '@infos/shared'
import { Tiktoken } from 'tiktoken/lite'
import o200kBase from 'tiktoken/encoders/o200k_base'
import {
  contentHash,
  type DocumentId,
  type DocumentNodeId,
  type SqliteDocumentEngine,
} from '@infos/document-engine'

const tokenizer = new Tiktoken(o200kBase.bpe_ranks, o200kBase.special_tokens, o200kBase.pat_str)
const countTokens = (content: string): number => tokenizer.encode_ordinary(content).length

export class ArcaDocumentContextProvider {
  readonly providerId = 'infos.arca.document-context'

  constructor(
    private readonly nodeId: KernelNodeId,
    private readonly engine: SqliteDocumentEngine,
  ) {}

  provide(input: { documentId: DocumentId; currentNodeId?: DocumentNodeId }): ContextRegion[] {
    const snapshot = this.engine.inspect(input.documentId)
    const scene = this.engine.projectAgentScene(input.documentId, input.currentNodeId)
    const objectRef: KernelObjectRef = {
      objectType: 'document.semantic',
      objectId: input.documentId as unknown as KernelObjectId,
      generation: snapshot.document.generation,
      ownerPrincipalId: snapshot.document.ownerPrincipalId,
      authorityNodeId: this.nodeId,
      authorityEpoch: snapshot.document.authorityEpoch,
    }
    const region = (
      suffix: string,
      content: string,
      priority: number,
      required: boolean,
    ): ContextRegion => ({
      regionId: `${input.documentId}:${snapshot.revisionId}:${suffix}`,
      providerId: this.providerId,
      kind: 'state',
      trust: 'authority',
      priority,
      required,
      tokenEstimate: countTokens(content),
      contentHash: contentHash(content),
      content,
      delivery: 'system',
      sourceObjectRefs: [objectRef],
      provenance: {
        documentId: input.documentId,
        revisionId: snapshot.revisionId,
        rootHash: snapshot.rootHash,
        projection: suffix,
      },
      deduplicationKey: `${input.documentId}:${suffix}`,
    })

    const outline = JSON.stringify(scene.outline)
    const revision = JSON.stringify({
      documentId: scene.documentId,
      revisionId: scene.revisionId,
      title: scene.title,
      language: scene.language,
    })
    const pending = JSON.stringify(scene.pendingChangeSets)
    const regions = [
      region('revision', revision, 100, true),
      region('outline', outline, 85, false),
      region('pending-changesets', pending, 70, false),
    ]
    if (scene.currentNode) {
      regions.push(region('current-node', JSON.stringify(scene.currentNode), 95, true))
    }
    return regions
  }
}
