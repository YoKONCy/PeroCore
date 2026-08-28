/**
 * webCapabilityCompiler — Application Realm 集成层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import { createHash } from 'node:crypto'
import type {
  KernelCapabilityDefinition,
  KernelCapabilityOffer,
  KernelEnvelope,
  KernelObjectId,
  WebInteractionScene,
} from '@infos/shared'
import type { CapabilityDirectory } from '../kernel/capabilityDirectory'
import type { LifecycleScope } from '../kernel/lifecycleScope'

export interface CompiledWebCapability {
  capabilityType: string
  definition: KernelCapabilityDefinition
  offer: KernelCapabilityOffer
}

/** 将高置信度网页 Affordance 编译为受限临时 Capability。 */
export class WebCapabilityCompiler {
  constructor(private readonly directory: CapabilityDirectory) {}

  compile(input: {
    scene: WebInteractionScene
    objectId: string
    providerInvoke: (
      envelope: KernelEnvelope<{ operation: string; input: unknown }>,
    ) => Promise<unknown>
    scope: LifecycleScope
  }): CompiledWebCapability {
    if (input.scene.injectionFindings.some((finding) => finding.severity === 'critical')) {
      throw new Error('WEB_CAPABILITY_UNTRUSTED_SCENE: 存在 critical 网页注入风险')
    }
    const object = input.scene.objects.find((candidate) => candidate.objectId === input.objectId)
    if (!object || object.confidence < 0.8 || !object.handle) {
      throw new Error('WEB_CAPABILITY_OBJECT_UNCERTAIN: 对象置信度不足')
    }
    const operations = object.affordances
      .filter((item) => item.enabled)
      .map((item) => item.operation)
    if (!operations.length) throw new Error('WEB_CAPABILITY_NO_AFFORDANCE: 对象没有可用操作')
    const origin = new URL(input.scene.url).origin
    const suffix = createHash('sha256')
      .update(`${origin}|${object.kind}|${object.name}`)
      .digest('hex')
      .slice(0, 16)
    const capabilityType = `web.site.${suffix}`
    const definition: KernelCapabilityDefinition = {
      capabilityType,
      contractVersion: '1.0',
      operations: Object.fromEntries(
        object.affordances
          .filter((item) => item.enabled)
          .map((item) => [
            item.operation,
            {
              risk:
                item.risk === 'read'
                  ? 'read'
                  : item.risk === 'local-change'
                    ? 'interact'
                    : 'elevated',
              idempotency: item.risk === 'read' ? 'safe' : 'unsafe',
            },
          ]),
      ),
    }
    const offer: KernelCapabilityOffer = {
      offerId: `${capabilityType}@1.0:${input.scene.sceneId}`,
      provider: {
        objectType: 'web-capability-provider',
        objectId: `${capabilityType}/${input.scene.sceneId}` as KernelObjectId,
        generation: input.scene.pageRef.generation,
        ownerPrincipalId: input.scene.pageRef.ownerPrincipalId,
      },
      capabilityType,
      contractVersion: '1.0',
      operations,
      resourceKinds: ['web-semantic-object'],
      health: 'available',
      constraints: {
        origin,
        sceneId: input.scene.sceneId,
        objectId: input.objectId,
        snapshotId: input.scene.snapshotId,
      },
    }
    input.scope.defer(this.directory.registerDefinition(definition))
    input.scope.defer(
      this.directory.registerProvider(offer, async (envelope) => {
        if (!(operations as readonly string[]).includes(envelope.payload.operation)) {
          throw new Error('WEB_CAPABILITY_OPERATION_DENIED: 操作不在编译范围')
        }
        return input.providerInvoke(envelope)
      }),
    )
    return { capabilityType, definition, offer }
  }
}
