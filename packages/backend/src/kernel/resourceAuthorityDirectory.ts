import type { NodeRegistry } from './nodeRegistry'
import type { KernelNodeId, KernelObjectRef, KernelResourceAuthority } from '@infos/shared'

/** Kernel Object 到唯一 Authority Node 的路由权威。 */
export class ResourceAuthorityDirectory {
  private readonly authorities = new Map<string, KernelResourceAuthority>()

  constructor(private readonly nodes?: NodeRegistry) {}

  register(input: KernelResourceAuthority): () => void {
    const key = this.key(input.object)
    const existing = this.authorities.get(key)
    if (existing && existing.authorityEpoch > input.authorityEpoch) {
      throw new Error('AUTHORITY_STALE_EPOCH: 不允许注册更旧的 Authority Epoch')
    }
    if (
      existing &&
      existing.authorityEpoch === input.authorityEpoch &&
      existing.authorityNodeId !== input.authorityNodeId
    ) {
      throw new Error('AUTHORITY_SPLIT_BRAIN: 同一 Epoch 出现多个 Authority Node')
    }
    const record = Object.freeze(structuredClone(input))
    this.authorities.set(key, record)
    return () => {
      if (this.authorities.get(key) === record) this.authorities.delete(key)
    }
  }

  resolve(object: KernelObjectRef, writable = false): KernelResourceAuthority {
    const authority = this.authorities.get(this.key(object))
    if (!authority) throw new Error('AUTHORITY_NOT_FOUND: 对象 Authority 未注册')
    if (authority.leaseExpiresAt && Date.parse(authority.leaseExpiresAt) <= Date.now()) {
      throw new Error('AUTHORITY_LEASE_EXPIRED: 对象 Authority Lease 已过期')
    }
    if (writable && !authority.writable) {
      throw new Error('AUTHORITY_READ_ONLY: 当前 Authority 不允许写入')
    }
    if (writable && this.nodes && !this.nodes.getActiveSession(authority.authorityNodeId)) {
      throw new Error('AUTHORITY_NODE_UNREACHABLE: Authority Node当前不可达，写入已关闭')
    }
    return structuredClone(authority)
  }

  transfer(input: {
    object: KernelObjectRef
    fromNodeId: KernelNodeId
    toNodeId: KernelNodeId
    expectedEpoch: number
    leaseExpiresAt?: string
  }): KernelResourceAuthority {
    const current = this.resolve(input.object)
    if (
      current.authorityNodeId !== input.fromNodeId ||
      current.authorityEpoch !== input.expectedEpoch
    ) {
      throw new Error('AUTHORITY_TRANSFER_CONFLICT: Authority 已变化')
    }
    const next: KernelResourceAuthority = {
      ...current,
      authorityNodeId: input.toNodeId,
      authorityEpoch: current.authorityEpoch + 1,
      leaseExpiresAt: input.leaseExpiresAt,
      replicaNodeIds: [...new Set([...(current.replicaNodeIds ?? []), current.authorityNodeId])],
      updatedAt: new Date().toISOString(),
    }
    this.authorities.set(this.key(input.object), Object.freeze(next))
    return structuredClone(next)
  }

  list(): KernelResourceAuthority[] {
    return [...this.authorities.values()].map((authority) => structuredClone(authority))
  }

  private key(object: KernelObjectRef): string {
    return `${object.objectType}:${object.objectId}:${object.generation}`
  }
}
