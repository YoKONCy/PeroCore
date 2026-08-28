import { randomUUID } from 'node:crypto'
import type { KernelCapabilityHandle, KernelCapabilityId, KernelObjectRef } from '@infos/shared'

/** 进程内 Capability Handle 签发与撤销注册表。 */
export class CapabilityHandleRegistry {
  private readonly handles = new Map<KernelCapabilityId, KernelCapabilityHandle>()
  private readonly revoked = new Set<KernelCapabilityId>()

  issue(input: Omit<KernelCapabilityHandle, 'handleId' | 'issuedAt'>): KernelCapabilityHandle {
    const handle: KernelCapabilityHandle = Object.freeze({
      ...input,
      operations: Object.freeze([...new Set(input.operations)]),
      handleId: randomUUID() as KernelCapabilityId,
      issuedAt: new Date().toISOString(),
    })
    this.assertDelegationDoesNotExpand(handle)
    this.handles.set(handle.handleId, handle)
    return handle
  }

  get(handleId: KernelCapabilityId): KernelCapabilityHandle | null {
    return this.getActive(handleId, new Set())
  }

  private getActive(
    handleId: KernelCapabilityId,
    visited: Set<KernelCapabilityId>,
  ): KernelCapabilityHandle | null {
    if (visited.has(handleId) || this.revoked.has(handleId)) return null
    visited.add(handleId)
    const handle = this.handles.get(handleId)
    if (!handle) return null
    if (handle.expiresAt && Date.parse(handle.expiresAt) <= Date.now()) return null
    if (handle.parentHandleId && !this.getActive(handle.parentHandleId, visited)) return null
    return handle
  }

  allows(handleId: KernelCapabilityId, resource: KernelObjectRef, operation: string): boolean {
    const handle = this.get(handleId)
    return Boolean(
      handle &&
      handle.resource.objectType === resource.objectType &&
      handle.resource.objectId === resource.objectId &&
      handle.resource.generation === resource.generation &&
      handle.resource.authorityNodeId === resource.authorityNodeId &&
      handle.resource.authorityEpoch === resource.authorityEpoch &&
      (!handle.providerNodeId || handle.providerNodeId === resource.authorityNodeId) &&
      handle.operations.includes(operation),
    )
  }

  revoke(handleId: KernelCapabilityId): boolean {
    const handle = this.handles.get(handleId)
    if (!handle?.revocable) return false
    this.revoked.add(handleId)
    return true
  }

  delegate(
    parentHandleId: KernelCapabilityId,
    input: Omit<KernelCapabilityHandle, 'handleId' | 'issuedAt' | 'parentHandleId' | 'resource'>,
  ): KernelCapabilityHandle {
    const parent = this.get(parentHandleId)
    if (!parent) throw new Error('父 Capability 不存在、已撤销或已过期')
    return this.issue({ ...input, resource: parent.resource, parentHandleId })
  }

  assertAllows(handleId: KernelCapabilityId, resource: KernelObjectRef, operation: string): void {
    if (!this.allows(handleId, resource, operation)) {
      throw new Error(`CAPABILITY_DENIED: 无权对 ${resource.objectType} 执行 ${operation}`)
    }
  }

  revokeSubject(subjectId: string): number {
    let count = 0
    for (const [handleId, handle] of this.handles) {
      if (handle.subjectId === subjectId && handle.revocable && !this.revoked.has(handleId)) {
        this.revoked.add(handleId)
        count += 1
      }
    }
    return count
  }

  private assertDelegationDoesNotExpand(handle: KernelCapabilityHandle): void {
    if (!handle.parentHandleId) return
    const parent = this.get(handle.parentHandleId)
    if (!parent) throw new Error('父 Capability 不存在、已撤销或已过期')
    if (
      parent.resource.objectType !== handle.resource.objectType ||
      parent.resource.objectId !== handle.resource.objectId ||
      parent.resource.generation !== handle.resource.generation ||
      parent.resource.authorityNodeId !== handle.resource.authorityNodeId ||
      parent.resource.authorityEpoch !== handle.resource.authorityEpoch ||
      parent.providerNodeId !== handle.providerNodeId
    ) {
      throw new Error('子 Capability 不得改变父资源对象')
    }
    if (handle.operations.some((operation) => !parent.operations.includes(operation))) {
      throw new Error('子 Capability 不得扩大操作集合')
    }
    if (parent.expiresAt && (!handle.expiresAt || handle.expiresAt > parent.expiresAt)) {
      throw new Error('子 Capability 不得延长有效期')
    }
  }
}
