import { describe, expect, it, vi } from 'vitest'
import type { KernelCapabilityId, KernelObjectId } from '@infos/shared'
import {
  CapabilityHandleRegistry,
  KernelObjectRegistry,
  LifecycleScope,
} from '@infos/backend/kernel'

describe('逻辑微内核基础框架', () => {
  it('LifecycleScope 应按逆序释放并保持幂等', async () => {
    const order: string[] = []
    const scope = new LifecycleScope('test')
    scope.defer(() => order.push('first'))
    const child = scope.child('child')
    child.defer(() => order.push('child'))
    scope.defer(() => order.push('last'))

    await Promise.all([scope.dispose(), scope.dispose()])

    expect(order).toEqual(['last', 'child', 'first'])
    expect(scope.isClosed).toBe(true)
    expect(() => scope.defer(vi.fn())).toThrow('生命周期作用域已关闭')
  })

  it('Capability 子句柄只能收窄操作并可被撤销', () => {
    const registry = new CapabilityHandleRegistry()
    const resource = {
      objectType: 'workspace',
      objectId: 'workspace-pero' as KernelObjectId,
      generation: 1,
      ownerPrincipalId: 'pero',
    }
    const root = registry.issue({
      subjectId: 'pero',
      resource,
      operations: ['read', 'write'],
      revocable: true,
    })
    const child = registry.issue({
      subjectId: 'app-editor',
      resource,
      operations: ['read'],
      parentHandleId: root.handleId,
      revocable: true,
    })

    expect(registry.allows(child.handleId, resource, 'read')).toBe(true)
    expect(registry.allows(child.handleId, resource, 'write')).toBe(false)
    expect(() =>
      registry.issue({
        subjectId: 'app-editor',
        resource,
        operations: ['delete'],
        parentHandleId: root.handleId,
        revocable: true,
      }),
    ).toThrow('不得扩大操作集合')
    expect(registry.revoke(child.handleId)).toBe(true)
    expect(registry.get(child.handleId)).toBeNull()
    const sibling = registry.issue({
      subjectId: 'app-reader',
      resource,
      operations: ['read'],
      parentHandleId: root.handleId,
      revocable: true,
    })
    expect(registry.revoke(root.handleId)).toBe(true)
    expect(registry.get(sibling.handleId)).toBeNull()
    expect(registry.get('missing' as KernelCapabilityId)).toBeNull()
  })

  it('KernelObjectRegistry应拒绝错误Generation、Owner和不存在对象', async () => {
    const registry = new KernelObjectRegistry()
    registry.register({
      objectType: 'thread',
      inspect: async () => ({ generation: 2, owner: 'nana' }),
      generation: (value) => value.generation,
      ownerPrincipalId: (value) => value.owner,
    })
    const base = {
      objectType: 'thread',
      objectId: 'thread-1' as KernelObjectId,
      generation: 2,
      ownerPrincipalId: 'nana',
    }
    await expect(registry.inspect(base)).resolves.toMatchObject({ generation: 2 })
    await expect(registry.inspect({ ...base, generation: 1 })).rejects.toThrow(
      'KERNEL_OBJECT_GENERATION_MISMATCH',
    )
    await expect(registry.inspect({ ...base, ownerPrincipalId: 'pero' })).rejects.toThrow(
      'KERNEL_OBJECT_OWNER_MISMATCH',
    )

    const missing = new KernelObjectRegistry()
    missing.register({ objectType: 'thread', inspect: async () => null })
    await expect(missing.inspect(base)).rejects.toThrow('KERNEL_OBJECT_NOT_FOUND')
  })

  it('KernelObjectRegistry 只负责对象适配，不持有领域数据', async () => {
    const registry = new KernelObjectRegistry()
    const inspect = vi.fn().mockResolvedValue({ title: '现有 Thread 数据' })
    const unregister = registry.register({ objectType: 'thread', inspect })
    const ref = {
      objectType: 'thread',
      objectId: 'thread-1' as KernelObjectId,
      generation: 1,
      ownerPrincipalId: 'nana',
    }

    await expect(registry.inspect(ref)).resolves.toEqual({ title: '现有 Thread 数据' })
    expect(inspect).toHaveBeenCalledWith(ref)
    unregister()
    await expect(registry.inspect(ref)).rejects.toThrow('不支持的 Kernel Object 类型')
  })
})
