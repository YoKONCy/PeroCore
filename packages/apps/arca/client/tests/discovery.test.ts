// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { resolveArcaEndpoint } from '../src/services/discovery'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  delete window.__ARCA_DISCOVERY__
})

describe('Arca Client Discovery', () => {
  it('显式查询参数应优先于桌面壳发现记录', () => {
    window.__ARCA_DISCOVERY__ = {
      protocolVersion: 1,
      applicationProtocolVersion: 1,
      application: {
        protocolVersion: 1,
        appId: 'infos.arca',
        instanceId: 'instance',
        name: 'Arca',
        appVersion: '1.0.0',
        adapterVersion: '1.0.0',
        state: 'ready',
        endpoints: [],
      },
      nodeId: 'node' as never,
      pid: 1,
      generation: 1,
      carrier: 'websocket',
      endpoint: 'ws://127.0.0.1:41000',
      startedAt: '2026-08-18T00:00:00.000Z',
    }
    window.history.replaceState({}, '', '/?endpoint=ws%3A%2F%2F127.0.0.1%3A42000')
    expect(resolveArcaEndpoint()).toBe('ws://127.0.0.1:42000')
  })

  it('桌面壳应能注入动态 Discovery Endpoint', () => {
    window.__ARCA_DISCOVERY__ = {
      protocolVersion: 1,
      applicationProtocolVersion: 1,
      application: {
        protocolVersion: 1,
        appId: 'infos.arca',
        instanceId: 'instance',
        name: 'Arca',
        appVersion: '1.0.0',
        adapterVersion: '1.0.0',
        state: 'ready',
        endpoints: [],
      },
      nodeId: 'node' as never,
      pid: 1,
      generation: 2,
      carrier: 'websocket',
      endpoint: 'ws://127.0.0.1:43000',
      startedAt: '2026-08-18T00:00:00.000Z',
    }
    expect(resolveArcaEndpoint()).toBe('ws://127.0.0.1:43000')
  })
})
