import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../../src/lib/appError'
import {
  retryableLlmError,
  retryLimit,
  waitForRetry,
  retryScope,
} from '../../../../src/services/llm/retryPolicy'

afterEach(() => vi.useRealTimers())

describe('模型请求重试策略', () => {
  it('只对明确临时故障重试，尊重关闭重试和不可重试标记', () => {
    expect(retryableLlmError(new TypeError('terminated'))).toBe(true)
    expect(retryableLlmError(new AppError('LLM_TIMEOUT', { data: { retryable: false } }))).toBe(
      false,
    )
    expect(retryableLlmError(new AppError('LLM_ERROR', { data: { status: 401 } }))).toBe(false)
    expect(retryableLlmError(new SyntaxError('参数格式错误'))).toBe(false)
    expect(retryLimit(0, 5)).toBe(0)
    expect(retryLimit(99, 2)).toBe(5)
  })

  it('取消立即清理等待计时器，不产生迟到重试', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const waiting = waitForRetry(30_000, controller.signal)
    controller.abort(new Error('停止'))
    await expect(waiting).rejects.toThrow('停止')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('总预算到期是不可重试失败，清理后不残留定时器', () => {
    vi.useFakeTimers()
    const scope = retryScope(undefined, 1000)
    vi.advanceTimersByTime(1000)
    expect(scope.signal.aborted).toBe(true)
    expect(retryableLlmError(scope.signal.reason)).toBe(false)
    scope.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
