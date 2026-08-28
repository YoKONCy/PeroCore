import { createHash, randomUUID } from 'node:crypto'
import type {
  WebActionReceipt,
  WebInteractionScene,
  WebSiteModel,
  WebTaskCheckpoint,
} from '@infos/shared'

/** 经验证 Receipt 驱动的站点模型与任务 Checkpoint。 */
export class WebSiteModelRegistry {
  private readonly models = new Map<string, WebSiteModel>()
  private readonly checkpoints = new Map<string, WebTaskCheckpoint>()

  learn(scene: WebInteractionScene, receipt: WebActionReceipt): WebSiteModel {
    if (receipt.verificationStatus === 'unverified' || receipt.verificationStatus === 'failed') {
      throw new Error('WEB_SITE_MODEL_UNVERIFIED: 未验证动作不能更新站点模型')
    }
    const origin = new URL(scene.url).origin
    const previous = this.models.get(origin)
    const objectFingerprints = Object.fromEntries(
      scene.objects
        .filter((object) => object.confidence >= 0.75 && object.handle)
        .map((object) => [`${object.kind}:${object.name}`, object.handle!.semanticFingerprint]),
    )
    const successPatterns = receipt.observedEffects
      .filter((effect) => effect.matched)
      .map((effect) => `${effect.kind}:${effect.summary}`)
    const model: WebSiteModel = {
      modelId:
        previous?.modelId ??
        `site-model:${createHash('sha256').update(origin).digest('hex').slice(0, 16)}`,
      origin,
      version: (previous?.version ?? 0) + 1,
      pageKinds: [...new Set([...(previous?.pageKinds ?? []), this.pageKind(scene)])],
      objectFingerprints: { ...(previous?.objectFingerprints ?? {}), ...objectFingerprints },
      successPatterns: [...new Set([...(previous?.successPatterns ?? []), ...successPatterns])],
      blockerPatterns: [...new Set([...(previous?.blockerPatterns ?? []), ...scene.blockers])],
      updatedAt: new Date().toISOString(),
    }
    this.models.set(origin, model)
    return structuredClone(model)
  }

  checkpoint(input: {
    scene: WebInteractionScene
    intent: string
    completedObjectIds: string[]
    pendingObjectIds: string[]
    receiptIds: string[]
  }): WebTaskCheckpoint {
    const checkpoint: WebTaskCheckpoint = {
      checkpointId: `web-checkpoint:${randomUUID()}`,
      origin: new URL(input.scene.url).origin,
      intent: input.intent,
      sceneId: input.scene.sceneId,
      completedObjectIds: [...input.completedObjectIds],
      pendingObjectIds: [...input.pendingObjectIds],
      receiptIds: [...input.receiptIds],
      createdAt: new Date().toISOString(),
    }
    this.checkpoints.set(checkpoint.checkpointId, checkpoint)
    return structuredClone(checkpoint)
  }

  get(origin: string): WebSiteModel | null {
    const model = this.models.get(origin)
    return model ? structuredClone(model) : null
  }

  getCheckpoint(checkpointId: string): WebTaskCheckpoint | null {
    const checkpoint = this.checkpoints.get(checkpointId)
    return checkpoint ? structuredClone(checkpoint) : null
  }

  private pageKind(scene: WebInteractionScene): string {
    if (scene.objects.some((object) => object.kind === 'form')) return 'form-page'
    if (scene.objects.some((object) => object.kind === 'table')) return 'table-page'
    if (scene.objects.some((object) => object.kind === 'list')) return 'list-page'
    return 'content-page'
  }
}
