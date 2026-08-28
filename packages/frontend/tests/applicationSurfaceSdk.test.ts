import { describe, expect, it, vi } from 'vitest'
import { ApplicationSurfaceRegistry, defineApplicationSurface } from '../src/applications'

const manifest = {
  manifestVersion: 1 as const,
  id: 'infos.arca',
  name: 'Arca',
  description: '文档工作站',
  adapterVersion: '1.0.0',
  protocolVersion: 1 as const,
  application: { versions: '>=1', transports: ['websocket' as const] },
  frontend: {
    entry: '@infos/arca/client',
    surfaces: [{ surfaceId: 'workbench', title: 'Arca', slot: 'main.tab' as const }],
  },
  endpoints: [],
  requestedCapabilities: [],
}

describe('ApplicationSurfaceSdk', () => {
  it('应只允许注册Manifest已声明的Surface', () => {
    const registry = new ApplicationSurfaceRegistry()
    const load = vi.fn(async () => ({ default: {} }))
    const surface = defineApplicationSurface({ manifest, surfaceId: 'workbench', load })
    const dispose = registry.register(surface)
    expect(registry.list('main.tab')).toEqual([surface])
    dispose()
    expect(registry.list()).toEqual([])
    expect(() => defineApplicationSurface({ manifest, surfaceId: 'hidden', load })).toThrow(
      'APPLICATION_SURFACE_UNDECLARED',
    )
  })

  it('应允许Tab注册层从Surface声明生成加载器', async () => {
    const registry = new ApplicationSurfaceRegistry()
    const load = vi.fn(async () => ({ default: { name: 'ArcaTab' } }))
    registry.register(defineApplicationSurface({ manifest, surfaceId: 'workbench', load }))

    const [surface] = registry.list('main.tab')
    expect(surface?.declaration.title).toBe('Arca')
    await expect(surface?.load()).resolves.toEqual({ default: { name: 'ArcaTab' } })
    expect(load).toHaveBeenCalledOnce()
  })
})
