import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@infos/backend/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('后端退出清理', () => {
  it('IPC 和信号重复请求共用一次清理，单项失败仍继续关闭后续资源', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const guards = await import('@infos/backend/lib/processGuards')
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = vi.fn(() => waiting)
    const failed = vi.fn(() => {
      throw new Error('模拟单项清理失败')
    })
    const remaining = vi.fn()
    guards.onShutdown(slow)
    guards.onShutdown(failed)
    guards.onShutdown(remaining)
    const first = guards.requestGracefulShutdown('IPC')
    const second = guards.requestGracefulShutdown('SIGTERM')
    release()
    await Promise.all([first, second])
    expect(slow).toHaveBeenCalledTimes(1)
    expect(failed).toHaveBeenCalledTimes(1)
    expect(remaining).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(exit).toHaveBeenCalledExactlyOnceWith(0)
  })
})
