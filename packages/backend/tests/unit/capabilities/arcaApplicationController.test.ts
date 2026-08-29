import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArcaApplicationController } from '@infos/backend/capabilities/arcaApplicationController'

function createFederation(discovery?: { pid: number }) {
  return {
    status: vi.fn(() => ({
      state: discovery ? ('connected' as const) : ('offline' as const),
      discoveryPath: 'C:/infos/arca/discovery.json',
      discovery: discovery
        ? {
            protocolVersion: 1 as const,
            applicationProtocolVersion: 1 as const,
            application: {
              protocolVersion: 1 as const,
              appId: 'infos.arca',
              instanceId: 'instance-1',
              name: 'Arca',
              appVersion: '0.9.3-hotfix2',
              adapterVersion: '1.0.0',
              state: 'ready' as const,
              endpoints: [],
            },
            nodeId: 'arca-node',
            pid: discovery.pid,
            generation: 1,
            carrier: 'websocket' as const,
            endpoint: 'ws://127.0.0.1:7361',
            startedAt: '2026-08-18T00:00:00.000Z',
          }
        : undefined,
    })),
    reconnect: vi.fn(async () => undefined),
    disconnectCurrent: vi.fn(async () => undefined),
  }
}

function createController(federation: ReturnType<typeof createFederation>) {
  return new ArcaApplicationController(federation as never, {
    appRoot: 'C:/missing-infos/packages',
    workspaceRoot: 'C:/missing-infos',
    applicationsRoot: 'C:/missing-infos/applications',
    dataPath: 'C:/infos/arca',
    discoveryPath: 'C:/infos/arca/discovery.json',
    uiUrl: 'http://127.0.0.1:7362',
    packaged: true,
  })
}

describe('ArcaApplicationController', () => {
  it('开发态应从Workspace根探测tsx与Arca源码', () => {
    const workspaceRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..')
    const controller = new ArcaApplicationController(createFederation() as never, {
      appRoot: path.join(workspaceRoot, 'packages'),
      workspaceRoot,
      applicationsRoot: path.join(workspaceRoot, 'dist-applications'),
      dataPath: 'C:/infos/arca',
      discoveryPath: 'C:/infos/arca/discovery.json',
      uiUrl: 'http://127.0.0.1:7362',
      packaged: false,
    })

    expect(controller.status()).toMatchObject({ managedRuntimeAvailable: true })
  })

  it('应将外部发现的Host标记为adopted', () => {
    const controller = createController(createFederation({ pid: 7391 }))
    const status = controller.status()

    expect(status.ownership).toBe('adopted')
    expect(status.hostState).toBe('running')
    expect(status.pid).toBe(7391)
  })

  it('退出收口不得终止外部Host', async () => {
    const federation = createFederation({ pid: 7391 })
    const controller = createController(federation)

    await expect(controller.shutdownManaged()).resolves.toEqual({
      stopped: false,
      reason: 'not_managed',
    })
    expect(federation.disconnectCurrent).not.toHaveBeenCalled()
  })

  it('不得直接停止外部Host', async () => {
    const federation = createFederation({ pid: 7391 })
    const controller = createController(federation)

    await expect(controller.stop()).rejects.toThrow('ARCA_NOT_MANAGED')
    expect(federation.disconnectCurrent).not.toHaveBeenCalled()
  })

  it('发行产物缺失时应明确禁用托管启动', async () => {
    const controller = createController(createFederation())

    expect(controller.status()).toMatchObject({
      ownership: 'offline',
      managedRuntimeAvailable: false,
      managedRuntimeReason: '当前发行包尚未收集Arca Host产物',
    })
    await expect(controller.start()).rejects.toThrow('ARCA_MANAGED_RUNTIME_UNAVAILABLE')
  })

  it('重新检测应委托给Federation Connector', async () => {
    const federation = createFederation()
    const controller = createController(federation)

    await controller.reconnect()
    expect(federation.reconnect).toHaveBeenCalledOnce()
  })
})
