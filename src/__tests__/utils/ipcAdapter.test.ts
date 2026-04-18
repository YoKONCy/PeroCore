import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as IPCAdapter from '@/utils/ipcAdapter'
import { getRuntimeCapabilities } from '@/utils/runtimeCapabilities'

vi.mock('@/utils/runtimeCapabilities', () => ({
  getRuntimeCapabilities: vi.fn()
}))

// 模拟 window.electron
const mockElectron = {
  invoke: vi.fn(),
  on: vi.fn()
}

// 设置全局模拟
vi.stubGlobal('window', {
  electron: mockElectron
})

describe('IPCAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getRuntimeCapabilities as any).mockReturnValue({
      host: 'web',
      eventTransport: 'browser-local',
      backendLogHistory: false,
      backendLogStream: false,
      localServiceControl: false,
      nativeWindowControl: false
    })
  })

  it('should call electron invoke when sending message', async () => {
    const channel = 'test-channel'
    const data = { key: 'value' }
    mockElectron.invoke.mockResolvedValue('response')

    // 模拟 isElectron 返回 true
    vi.spyOn(IPCAdapter, 'isElectron').mockReturnValue(true)

    const result = await IPCAdapter.invoke(channel, data)

    expect(mockElectron.invoke).toHaveBeenCalledWith(channel, data)
    expect(result).toBe('response')
  })

  it('should dispatch browser local events via emit/listen without websocket bridge', async () => {
    vi.spyOn(IPCAdapter, 'isElectron').mockReturnValue(false)

    const handler = vi.fn()
    const unlisten = await IPCAdapter.listen('sync-chat-to-pet', handler)

    await IPCAdapter.emit('sync-chat-to-pet', { role: 'user', content: 'hello' })

    expect(handler).toHaveBeenCalledWith({ role: 'user', content: 'hello' })

    unlisten()
    await IPCAdapter.emit('sync-chat-to-pet', { role: 'assistant', content: 'world' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should unwrap browser IPC raw responses and result envelopes', async () => {
    vi.spyOn(IPCAdapter, 'isElectron').mockReturnValue(false)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => 'pong'
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: 'wrapped' })
      })

    vi.stubGlobal('fetch', fetchMock)

    await expect(IPCAdapter.invoke('ping')).resolves.toBe('pong')
    await expect(IPCAdapter.invoke('get-app-version')).resolves.toBe('wrapped')
  })
})
