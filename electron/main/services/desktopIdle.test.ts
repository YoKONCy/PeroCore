import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForDesktopIdle } from './desktopIdle'

afterEach(() => {
  vi.useRealTimers()
})

describe('桌面短暂繁忙等待', () => {
  it('等待输入空闲后才允许动作继续', async () => {
    vi.useFakeTimers()
    const lastInput = Date.now()
    const dispatch = vi.fn()
    const waiting = waitForDesktopIdle(
      () => Date.now() - lastInput,
      () => {},
    ).then(dispatch)
    await vi.advanceTimersByTimeAsync(599)
    expect(dispatch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('持续繁忙返回可恢复错误，不伪装成用户明确接管', async () => {
    vi.useFakeTimers()
    const waiting = expect(
      waitForDesktopIdle(
        () => 0,
        () => {},
      ),
    ).rejects.toThrow('DESKTOP_USER_BUSY')
    await vi.advanceTimersByTimeAsync(2_000)
    await waiting
    expect(vi.getTimerCount()).toBe(0)
  })

  it('父任务取消立即结束等待并释放定时器', async () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    const waiting = expect(
      waitForDesktopIdle(
        () => 0,
        () => {},
        parent.signal,
      ),
    ).rejects.toThrow()
    parent.abort(new Error('用户停止了父任务'))
    await waiting
    expect(vi.getTimerCount()).toBe(0)
  })

  it('等待期间明确暂停仍立即生效', async () => {
    vi.useFakeTimers()
    let paused = false
    const waiting = expect(
      waitForDesktopIdle(
        () => 0,
        () => {
          if (paused) throw new Error('DESKTOP_WAITING: 用户已接管')
        },
      ),
    ).rejects.toThrow('DESKTOP_WAITING')
    paused = true
    await vi.advanceTimersByTimeAsync(100)
    await waiting
  })
})
