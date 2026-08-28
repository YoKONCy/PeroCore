import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  parseProgrammableSurfaceMessage,
  prepareProgrammableSandbox,
  ProgrammableSurfaceSourceRegistry,
} from '../../src/compositor/programmableSurfaceSandbox'
import type { ProgrammableIslandSurfaceProps } from '@infos/shared'

function descriptor(source: Uint8Array): ProgrammableIslandSurfaceProps {
  const hash = createHash('sha256').update(source).digest('hex')
  return {
    runtime: 'iframe',
    sourceBlobId: `sha256:${hash}`,
    sourceHash: hash,
    entrypoint: 'main.js',
    permissions: ['render', 'input'],
    network: 'none',
    sandboxId: 'sandbox-1',
  }
}

describe('Programmable Surface沙箱', () => {
  it('应校验内容寻址源码并生成禁止网络的opaque-origin文档', async () => {
    const source = new TextEncoder().encode('infosSurface.root.textContent="安全内容"')
    const prepared = await prepareProgrammableSandbox(descriptor(source), source)
    expect(prepared.srcdoc).toContain("connect-src 'none'")
    expect(prepared.srcdoc).toContain("default-src 'none'")
    expect(prepared.srcdoc).toContain("form-action 'none'")
    expect(prepared.srcdoc).not.toContain('allow-same-origin')
    await expect(
      prepareProgrammableSandbox(descriptor(source), new TextEncoder().encode('篡改')),
    ).rejects.toThrow('PROGRAMMABLE_SURFACE_INTEGRITY_FAILED')
  })

  it('应拒绝网络、未知权限和不一致Blob摘要', async () => {
    const source = new TextEncoder().encode('void 0')
    const valid = descriptor(source)
    await expect(
      prepareProgrammableSandbox({ ...valid, network: 'internet' as never }, source),
    ).rejects.toThrow('PROGRAMMABLE_SURFACE_NETWORK_DENIED')
    await expect(
      prepareProgrammableSandbox({ ...valid, permissions: ['host'] }, source),
    ).rejects.toThrow('PROGRAMMABLE_SURFACE_PERMISSION_DENIED')
    await expect(
      prepareProgrammableSandbox({ ...valid, sourceBlobId: `sha256:${'a'.repeat(64)}` }, source),
    ).rejects.toThrow('PROGRAMMABLE_SURFACE_SOURCE_MISMATCH')
  })

  it('Host消息协议应绑定Sandbox ID、版本和大小上限', () => {
    expect(
      parseProgrammableSurfaceMessage(
        { protocol: 'infos.surface.v1', sandboxId: 'sandbox-1', type: 'ready' },
        'sandbox-1',
      ),
    ).toMatchObject({ type: 'ready' })
    expect(
      parseProgrammableSurfaceMessage(
        { protocol: 'infos.surface.v1', sandboxId: 'other', type: 'ready' },
        'sandbox-1',
      ),
    ).toBeUndefined()
    expect(
      parseProgrammableSurfaceMessage(
        { protocol: 'infos.surface.v2', sandboxId: 'sandbox-1', type: 'ready' },
        'sandbox-1',
      ),
    ).toBeUndefined()
    expect(
      parseProgrammableSurfaceMessage(
        {
          protocol: 'infos.surface.v1',
          sandboxId: 'sandbox-1',
          type: 'render',
          payload: { text: 'x'.repeat(300_000) },
        },
        'sandbox-1',
      ),
    ).toBeUndefined()
  })

  it('源码Resolver只能由Host注册一次并支持撤销', async () => {
    const registry = new ProgrammableSurfaceSourceRegistry()
    const unregister = registry.register(async () => new Uint8Array([1]))
    expect(() => registry.register(async () => new Uint8Array([2]))).toThrow(
      'PROGRAMMABLE_SURFACE_RESOLVER_DUPLICATE',
    )
    expect(await registry.resolve('sha256:test')).toEqual(new Uint8Array([1]))
    unregister()
    await expect(registry.resolve('sha256:test')).rejects.toThrow(
      'PROGRAMMABLE_SURFACE_SOURCE_UNAVAILABLE',
    )
  })
})
