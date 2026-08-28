import { describe, expect, it, vi } from 'vitest'
import type { PackageManifest } from '@infos/shared'
import { PackageRegistry, PackageRuntime } from '@infos/backend/packages'

const manifest: PackageManifest = {
  manifestVersion: 2,
  packageId: 'test.package',
  name: '测试包',
  version: '1.0.0',
  trust: 'user',
  contributions: [
    { id: 'asset.one', kind: 'asset' },
    { id: 'presenter.one', kind: 'presenter' },
  ],
}

describe('Package Runtime', () => {
  it('应按 Contribution 激活并逆序释放', async () => {
    const registry = new PackageRegistry()
    registry.install(manifest)
    const runtime = new PackageRuntime(registry)
    const order: string[] = []
    runtime.registerActivator('asset', ({ contribution }) => {
      order.push(`start:${contribution.id}`)
      return () => order.push(`stop:${contribution.id}`)
    })
    runtime.registerActivator('presenter', ({ contribution }) => {
      order.push(`start:${contribution.id}`)
      return () => order.push(`stop:${contribution.id}`)
    })
    await runtime.activate(manifest.packageId)
    expect(registry.get(manifest.packageId)?.state).toBe('active')
    await runtime.deactivate(manifest.packageId)
    expect(order).toEqual([
      'start:asset.one',
      'start:presenter.one',
      'stop:presenter.one',
      'stop:asset.one',
    ])
  })

  it('缺少必需 Capability 时应拒绝启动', async () => {
    const registry = new PackageRegistry()
    registry.install({
      ...manifest,
      packageId: 'requires.package',
      requires: [
        {
          id: 'required.web',
          capabilityType: 'web.page',
          contractVersion: '1.0',
          operations: ['inspect'],
          required: true,
        },
      ],
    })
    const runtime = new PackageRuntime(registry)
    runtime.setRequirementResolver(() => false)
    await expect(runtime.activate('requires.package')).rejects.toThrow(
      'PACKAGE_REQUIREMENT_UNAVAILABLE',
    )
  })

  it('Contribution 激活失败应原子回滚', async () => {
    const registry = new PackageRegistry()
    registry.install(manifest)
    const runtime = new PackageRuntime(registry)
    const dispose = vi.fn()
    runtime.registerActivator('asset', () => dispose)
    runtime.registerActivator('presenter', () => {
      throw new Error('激活失败')
    })
    await expect(runtime.activate(manifest.packageId)).rejects.toThrow('激活失败')
    expect(dispose).toHaveBeenCalledOnce()
    expect(registry.get(manifest.packageId)).toMatchObject({ state: 'failed', error: '激活失败' })
  })
})
