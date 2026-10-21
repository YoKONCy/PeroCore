// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClientSession } from '@infos/frontend/composables/system/useClientSession'

const api = vi.hoisted(() => ({ session: vi.fn() }))
vi.mock('@infos/frontend/api/modules/clientAccessApi', () => ({ clientAccessApi: api }))
vi.mock('@infos/frontend/api/transport', () => ({
  clearWebClientCredential: vi.fn(),
  isElectronRuntime: () => false,
}))

describe('Web 身份与网络恢复分离', () => {
  let client: ReturnType<typeof createClientSession>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    api.session.mockReset()
    client = createClientSession()
  })

  afterEach(() => {
    client.dispose()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('短暂断网保留已确认身份，并自动重试身份检查', async () => {
    api.session.mockResolvedValueOnce({
      data: { authenticated: true, admin: false, deviceId: '手机' },
    })
    await client.check()
    api.session.mockRejectedValueOnce(new TypeError('fetch failed'))
    await client.check()
    expect(client.session.value.authenticated).toBe(true)
    expect(client.error.value).toContain('fetch failed')
    api.session.mockResolvedValueOnce({
      data: { authenticated: true, admin: false, deviceId: '手机' },
    })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(client.error.value).toBe('')
    expect(api.session).toHaveBeenCalledTimes(3)
  })

  it('首次打开时离线不会误放行，网络恢复后无需刷新即可进入', async () => {
    api.session.mockRejectedValueOnce(new TypeError('网络不可用'))
    await client.check()
    expect(client.session.value.authenticated).toBe(false)
    api.session.mockResolvedValueOnce({ data: { authenticated: true, admin: false } })
    window.dispatchEvent(new Event('online'))
    await client.check()
    expect(client.session.value.authenticated).toBe(true)
  })

  it('服务端明确返回未授权时退出，迟到的成功检查不能覆盖撤销结果', async () => {
    api.session.mockResolvedValueOnce({ data: { authenticated: true, admin: false } })
    await client.check()
    let complete!: (value: unknown) => void
    api.session.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve
      }),
    )
    const pending = client.check()
    window.dispatchEvent(new Event('infos:unauthorized'))
    complete({ data: { authenticated: true, admin: false } })
    await pending
    expect(client.session.value.authenticated).toBe(false)
    api.session.mockResolvedValueOnce({ data: { authenticated: false, admin: false } })
    await client.check()
    expect(client.session.value.authenticated).toBe(false)
  })

  it('多个前台事件合并检查，不为每个事件创建请求', async () => {
    api.session.mockResolvedValue({ data: { authenticated: true, admin: false } })
    await client.check()
    vi.setSystemTime(Date.now() + 60_000)
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('pageshow'))
    document.dispatchEvent(new Event('visibilitychange'))
    await client.check()
    expect(api.session).toHaveBeenCalledTimes(2)
  })
})
