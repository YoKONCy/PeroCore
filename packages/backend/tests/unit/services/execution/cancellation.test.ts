import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCancellationScope,
  trackCancellationCleanup,
  waitForCancellationCleanup,
  waitWithSignal,
} from '@infos/backend/services/execution/cancellation'

afterEach(() => vi.useRealTimers())

describe('执行取消作用域', () => {
  it('父级取消会唤醒等待，底层随后失败不会成为未处理拒绝', async () => {
    const parent = new AbortController()
    const scope = createCancellationScope({ signal: parent.signal })
    let rejectOperation!: (error: Error) => void
    const operation = new Promise<void>((_resolve, reject) => {
      rejectOperation = reject
    })
    const waiting = expect(waitWithSignal(operation, scope.signal)).rejects.toThrow('父级停止')
    parent.abort(new Error('父级停止'))
    await waiting
    rejectOperation(new Error('底层已收尾'))
    scope.dispose()
  })

  it('使用父任务截止时间与本次预算中更早的一个', async () => {
    vi.useFakeTimers()
    const scope = createCancellationScope({
      deadline: new Date(Date.now() + 100).toISOString(),
      timeoutMs: 10_000,
    })
    await vi.advanceTimersByTimeAsync(99)
    expect(scope.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(scope.signal.aborted).toBe(true)
    scope.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('已过期或无效的截止时间不会放行执行', () => {
    for (const deadline of ['错误时间', new Date(Date.now() - 1).toISOString()]) {
      const scope = createCancellationScope({ deadline })
      expect(scope.signal.aborted).toBe(true)
      scope.dispose()
    }
  })

  it('可以等待取消触发的异步资源回收', async () => {
    const parent = new AbortController()
    let release!: () => void
    let settled = false
    const cleanup = new Promise<void>((resolve) => {
      release = resolve
    })
    parent.signal.addEventListener('abort', () => trackCancellationCleanup(parent.signal, cleanup))
    parent.abort()
    const waiting = waitForCancellationCleanup(parent.signal).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await waiting
    expect(settled).toBe(true)
  })
})
