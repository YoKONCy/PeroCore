import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function setWindow(overrides: Record<string, unknown>) {
  Object.defineProperty(globalThis, 'window', {
    value: overrides,
    writable: true,
    configurable: true,
  })
}

async function importTransport() {
  vi.resetModules()
  return import('@infos/frontend/api/transport')
}

describe('transport runtime helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('应当在 Web 环境生成 ws 网关和 API 地址', async () => {
    setWindow({
      location: { origin: 'https://pero.example', protocol: 'https:', host: 'pero.example' },
    })

    const { getApiBaseUrl, getGatewayWsUrl, isElectronRuntime } = await importTransport()

    expect(isElectronRuntime()).toBe(false)
    expect(getGatewayWsUrl()).toBe('wss://pero.example/ws/gateway')
    expect(getApiBaseUrl()).toBe('https://pero.example/api')
  })

  it('应当在 Electron 环境生成 localhost 网关和 API 地址', async () => {
    setWindow({
      electron: { invoke: vi.fn() },
      location: { origin: 'http://web', protocol: 'http:', host: 'web' },
    })

    const { ELECTRON_BACKEND_ORIGIN, getApiBaseUrl, getGatewayWsUrl, isElectronRuntime } =
      await importTransport()

    expect(isElectronRuntime()).toBe(true)
    expect(getGatewayWsUrl()).toBe(`${ELECTRON_BACKEND_ORIGIN.replace(/^http/, 'ws')}/ws/gateway`)
    expect(getApiBaseUrl()).toBe(`${ELECTRON_BACKEND_ORIGIN}/api`)
  })
})

describe('transport singleton', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('应当在 Web 环境通过 HTTP 请求 API 并合并 JSON 头', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ code: 'OK', message: '成功', data: { id: 1 } }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    setWindow({
      location: { origin: 'http://localhost:7359', protocol: 'http:', host: 'localhost:7359' },
    })

    const { transport } = await importTransport()
    const result = await transport.request('/agents', { headers: { 'X-Test': '1' } })

    expect(result).toEqual({ code: 'OK', message: '成功', data: { id: 1 } })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:7359/api/agents', {
      headers: { 'Content-Type': 'application/json', 'X-Test': '1' },
    })
  })

  it('应当在 Web 环境将 HTTP 错误 JSON 信封原样返回', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: () => Promise.resolve({ code: 'VALIDATION_ERROR', message: '参数错误' }),
        }),
      ),
    )
    setWindow({
      location: { origin: 'http://localhost:7359', protocol: 'http:', host: 'localhost:7359' },
    })

    const { transport } = await importTransport()

    await expect(transport.request('/agents')).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: '参数错误',
    })
  })

  it('应当在 Web 环境将不可解析错误降级为 NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: () => Promise.reject(new Error('不是 JSON')),
        }),
      ),
    )
    setWindow({
      location: { origin: 'http://localhost:7359', protocol: 'http:', host: 'localhost:7359' },
    })

    const { transport } = await importTransport()

    await expect(transport.request('/health')).resolves.toEqual({
      code: 'NETWORK_ERROR',
      message: 'HTTP 503 Service Unavailable',
    })
  })

  it('应当在 Web 环境通过 HTTP 替代 IPC invoke', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ code: 'OK', data: { path: 'C:/Pero' } }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    setWindow({
      location: { origin: 'http://localhost:7359', protocol: 'http:', host: 'localhost:7359' },
    })

    const { transport } = await importTransport()
    const result = await transport.invoke('dialog:open', 'workspace')

    expect(result).toEqual({ path: 'C:/Pero' })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:7359/api/ipc/dialog:open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['workspace']),
    })
  })

  it('应当在 Electron 环境请求 localhost API 并通过 IPC invoke', async () => {
    const invoke = vi.fn(() => Promise.resolve('完成'))
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ code: 'OK', message: '成功' }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    setWindow({
      electron: { invoke },
      location: { origin: 'http://web', protocol: 'http:', host: 'web' },
    })

    const { ELECTRON_BACKEND_ORIGIN, transport } = await importTransport()
    await expect(transport.request('/system/info')).resolves.toEqual({
      code: 'OK',
      message: '成功',
    })
    await expect(transport.invoke('system:open-path', 'C:/Pero')).resolves.toBe('完成')

    expect(fetchMock).toHaveBeenCalledWith(`${ELECTRON_BACKEND_ORIGIN}/api/system/info`, {
      headers: { 'Content-Type': 'application/json' },
    })
    expect(invoke).toHaveBeenCalledWith('system:open-path', 'C:/Pero')
  })
})
