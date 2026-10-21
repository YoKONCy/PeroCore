// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGatewayClient } from '@infos/frontend/composables/gateway/useGateway'

vi.mock('@infos/frontend/api/transport', () => ({
  getGatewayWsUrl: () => 'ws://infos.local/ws/gateway',
}))
vi.mock('@infos/frontend/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

class Socket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: Socket[] = []
  readyState = Socket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn(() => this.serverClose(1000))

  constructor() {
    Socket.instances.push(this)
  }

  open(): void {
    this.readyState = Socket.OPEN
    this.onopen?.()
  }

  receive(type: string, payload: Record<string, unknown> = {}, fields = {}): void {
    this.onmessage?.({ data: JSON.stringify({ protocolVersion: 1, type, payload, ...fields }) })
  }

  ready(sessionId = 'session-1'): void {
    this.open()
    this.receive('hello_ack', { agreedVersion: 1, sessionId, generation: 1 })
  }

  serverClose(code = 1001, reason = ''): void {
    this.readyState = Socket.CLOSED
    this.onclose?.({ code, reason })
  }

  sent(): Array<{ id: string; type: string; payload: Record<string, unknown> }> {
    return this.send.mock.calls.map(([data]) => JSON.parse(data as string))
  }
}

describe('手机 Gateway 连接恢复', () => {
  let client: ReturnType<typeof createGatewayClient>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', Socket)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    Socket.instances = []
    client = createGatewayClient()
  })

  afterEach(() => {
    client.dispose()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('只在握手完成后在线，握手悬挂时自动更换连接', async () => {
    await client.connect()
    const old = Socket.instances[0]!
    old.open()
    expect(client.isConnected.value).toBe(false)
    await vi.advanceTimersByTimeAsync(14_000)
    expect(old.close).toHaveBeenCalledOnce()
    expect(Socket.instances).toHaveLength(2)
    Socket.instances[1]!.ready('session-2')
    expect(client.isConnected.value).toBe(true)
    expect(client.sessionId.value).toBe('session-2')
    old.receive('hello_ack', { agreedVersion: 1, sessionId: '过期连接' })
    expect(client.sessionId.value).toBe('session-2')
  })

  it('超过十次失败仍继续重连，恢复网络事件能跳过退避等待', async () => {
    await client.connect()
    for (let index = 0; index < 12; index++) {
      Socket.instances.at(-1)!.serverClose()
      await vi.advanceTimersByTimeAsync(30_000)
    }
    expect(Socket.instances.length).toBeGreaterThan(10)
    const old = Socket.instances.at(-1)!
    old.serverClose()
    const count = Socket.instances.length
    window.dispatchEvent(new Event('online'))
    await Promise.resolve()
    expect(Socket.instances).toHaveLength(count + 1)
    Socket.instances.at(-1)!.ready('网络已恢复')
    expect(client.retryCount.value).toBe(0)
  })

  it('没有心跳回执时废弃假在线连接，回执正常时不误断开', async () => {
    await client.connect()
    const old = Socket.instances[0]!
    old.ready()
    await vi.advanceTimersByTimeAsync(25_000)
    old.receive('heartbeat_ack')
    await vi.advanceTimersByTimeAsync(24_000)
    expect(client.isConnected.value).toBe(true)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(old.close).toHaveBeenCalledOnce()
    expect(Socket.instances.length).toBeGreaterThan(1)
  })

  it('锁屏期间计时器暂停，返回前台也能立即替换陈旧连接', async () => {
    await client.connect()
    const old = Socket.instances[0]!
    old.ready()
    vi.setSystemTime(Date.now() + 120_000)
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(old.close).toHaveBeenCalledOnce()
    expect(Socket.instances).toHaveLength(2)
  })

  it('重连恢复订阅游标，但不重放断连前的业务请求', async () => {
    await client.subscribe('approval:pero')
    await client.connect()
    const old = Socket.instances[0]!
    old.ready()
    const subscription = old
      .sent()
      .find((message) => message.payload.action === 'gateway.subscribe')!
    old.receive('response', { latestSequence: 7, events: [] }, { id: subscription.id })
    await Promise.resolve()
    const pending = client.request('surface.input', { choice: 'approve' }).catch((error) => error)
    old.serverClose()
    expect(await pending).toBeInstanceOf(Error)
    await vi.advanceTimersByTimeAsync(2_000)
    const current = Socket.instances.at(-1)!
    current.ready('session-2')
    const restored = current
      .sent()
      .find((message) => message.payload.action === 'gateway.subscribe')!
    expect(restored.payload.lastSequence).toBe(7)
    expect(current.sent().some((message) => message.payload.action === 'surface.input')).toBe(false)
    current.receive('response', { latestSequence: 7, events: [] }, { id: restored.id })
  })

  it('明确撤销授权后停止重连，重新确认身份后才能恢复', async () => {
    await client.connect()
    Socket.instances[0]!.ready()
    window.dispatchEvent(new Event('infos:unauthorized'))
    await vi.advanceTimersByTimeAsync(120_000)
    window.dispatchEvent(new Event('online'))
    await Promise.resolve()
    expect(Socket.instances).toHaveLength(1)
    window.dispatchEvent(new Event('infos:authorized'))
    await Promise.resolve()
    expect(Socket.instances).toHaveLength(2)
  })

  it('显式断开后不因手机前台事件创建幽灵连接', async () => {
    await client.connect()
    client.disconnect()
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('pageshow'))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(Socket.instances).toHaveLength(1)
  })
})
