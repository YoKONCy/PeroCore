import type {
  KernelObjectId,
  KernelObjectRef,
  WebInteractionScene,
  WebSceneObject,
} from '@infos/shared'
import type { KernelObjectAdapter, KernelObjectRegistry } from '../kernel/kernelObjectRegistry'

/** 把高置信度网页业务实体投影为可授权、可订阅的 Kernel Object。 */
export class WebSemanticObjectStore implements KernelObjectAdapter {
  readonly objectType = 'web-semantic-object'
  private readonly objects = new Map<string, { ref: KernelObjectRef; object: WebSceneObject }>()

  update(scene: WebInteractionScene): KernelObjectRef[] {
    this.objects.clear()
    for (const object of scene.objects) {
      if (
        object.confidence < 0.75 ||
        !['form', 'field', 'button', 'dialog', 'card', 'table'].includes(object.kind)
      )
        continue
      const ref: KernelObjectRef = {
        objectType: this.objectType,
        objectId: `${scene.pageRef.objectId}/${object.objectId}` as KernelObjectId,
        generation: scene.pageRef.generation,
        ownerPrincipalId: scene.pageRef.ownerPrincipalId,
      }
      this.objects.set(String(ref.objectId), { ref, object: structuredClone(object) })
    }
    return [...this.objects.values()].map(({ ref }) => ({ ...ref }))
  }

  register(registry: KernelObjectRegistry): () => void {
    return registry.register(this)
  }

  async inspect(ref: KernelObjectRef): Promise<WebSceneObject> {
    const record = this.objects.get(String(ref.objectId))
    if (!record || record.ref.generation !== ref.generation) {
      throw new Error('RUNTIME_STALE_HANDLE: Web 语义对象已失效')
    }
    return structuredClone(record.object)
  }
}
