import type { KernelObjectRef } from '@infos/shared'

export interface KernelObjectAdapter<T = unknown> {
  readonly objectType: string
  inspect(ref: KernelObjectRef): Promise<T | null>
  generation?(value: T): number
  ownerPrincipalId?(value: T): string
}

/** 逻辑微内核对象类型注册表；领域数据仍由各自 Repository 持有。 */
export class KernelObjectRegistry {
  private readonly adapters = new Map<string, KernelObjectAdapter>()

  register<T>(adapter: KernelObjectAdapter<T>): () => void {
    if (this.adapters.has(adapter.objectType)) {
      throw new Error(`Kernel Object Adapter 已注册: ${adapter.objectType}`)
    }
    this.adapters.set(adapter.objectType, adapter)
    return () => {
      if (this.adapters.get(adapter.objectType) === adapter) {
        this.adapters.delete(adapter.objectType)
      }
    }
  }

  get(objectType: string): KernelObjectAdapter | null {
    return this.adapters.get(objectType) ?? null
  }

  async inspect(ref: KernelObjectRef): Promise<unknown> {
    const adapter = this.get(ref.objectType)
    if (!adapter) throw new Error(`不支持的 Kernel Object 类型: ${ref.objectType}`)
    const value = await adapter.inspect(ref)
    if (value === null || value === undefined) throw new Error('KERNEL_OBJECT_NOT_FOUND')
    if (adapter.generation && adapter.generation(value) !== ref.generation) {
      throw new Error('KERNEL_OBJECT_GENERATION_MISMATCH')
    }
    if (adapter.ownerPrincipalId && adapter.ownerPrincipalId(value) !== ref.ownerPrincipalId) {
      throw new Error('KERNEL_OBJECT_OWNER_MISMATCH')
    }
    return value
  }

  listObjectTypes(): string[] {
    return [...this.adapters.keys()].sort()
  }
}
