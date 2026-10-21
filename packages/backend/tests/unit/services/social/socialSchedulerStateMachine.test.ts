import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SocialScheduler } from '@infos/social/runtime/socialScheduler'

function session(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'group-1',
    channelType: 'group',
    agentId: 'pero',
    participation: 'idle',
    phase: 'ready',
    pendingMessages: [{ content: '一' }, { content: '二' }, { content: '三' }],
    inFlightMessages: [],
    lastActiveTime: 0,
    lastMessageTime: Date.now(),
    isMentioned: false,
    flushTimer: null,
    nextScanTime: 0,
    collectionStartedAt: 0,
    waitCount: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('SocialScheduler 确定性门控', () => {
  it('主动观察只选择一个最高优先级会话且不调用任何模型', async () => {
    const low = session({ channelId: 'low', lastMessageTime: Date.now() - 100_000 })
    const high = session({ channelId: 'high', isMentioned: true })
    const review = vi.fn().mockResolvedValue(undefined)
    const manager = {
      listSessions: vi.fn(() => [low, high]),
      checkActiveExpiry: vi.fn(),
      dueDeferredIntent: vi.fn(() => undefined),
      review,
      retry: vi.fn(),
    }
    const scheduler = new SocialScheduler(
      { sessionManager: manager as never },
      { nightSilenceEnabled: false },
    )

    scheduler.start()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    scheduler.stop()

    expect(review).toHaveBeenCalledTimes(1)
    expect(review).toHaveBeenCalledWith(high, 'proactive_review')
  })

  it('延后意图到期时重新交给同一会话审视', async () => {
    const target = session({ channelType: 'private' })
    const manager = {
      listSessions: vi.fn(() => [target]),
      checkActiveExpiry: vi.fn(),
      dueDeferredIntent: vi.fn().mockReturnValueOnce({ intention: '稍后询问' }),
      review: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn(),
    }
    const scheduler = new SocialScheduler(
      { sessionManager: manager as never },
      { nightSilenceEnabled: false },
    )

    await (scheduler as unknown as { scan: () => Promise<void> }).scan()

    expect(manager.review).toHaveBeenCalledWith(target, 'intent_due')
  })

  it('失败批次到期后走状态机重试而不是重新生成调度决策', async () => {
    const target = session({ phase: 'retrying', nextScanTime: 0 })
    const manager = {
      listSessions: vi.fn(() => [target]),
      dueDeferredIntent: vi.fn(() => undefined),
      checkActiveExpiry: vi.fn(),
      review: vi.fn(),
      retry: vi.fn().mockResolvedValue(undefined),
    }
    const scheduler = new SocialScheduler(
      { sessionManager: manager as never },
      { nightSilenceEnabled: false },
    )

    await (scheduler as unknown as { scan: () => Promise<void> }).scan()

    expect(manager.retry).toHaveBeenCalledWith(target)
  })
})
