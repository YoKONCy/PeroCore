import { describe, expect, it, vi } from 'vitest'
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

describe('SocialScheduler 确定性门控', () => {
  it('主动观察只选择一个最高优先级会话且不调用任何模型', async () => {
    const low = session({ channelId: 'low', lastMessageTime: Date.now() - 100_000 })
    const high = session({ channelId: 'high', isMentioned: true })
    const review = vi.fn().mockResolvedValue(undefined)
    const manager = {
      getActiveSessions: vi.fn(() => [low, high]),
      dueDeferredIntent: vi.fn(() => undefined),
      review,
      retry: vi.fn(),
    }
    const scheduler = new SocialScheduler({ sessionManager: manager as never })
    ;(scheduler as unknown as { nextGroupReviewAt: number }).nextGroupReviewAt = 0

    await (scheduler as unknown as { scan: () => Promise<void> }).scan()

    expect(review).toHaveBeenCalledTimes(1)
    expect(review).toHaveBeenCalledWith(high, 'proactive_review')
  })

  it('延后意图到期时重新交给同一会话审视', async () => {
    const target = session({ channelType: 'private' })
    const manager = {
      getActiveSessions: vi.fn(() => [target]),
      dueDeferredIntent: vi.fn(() => ({ intention: '稍后询问' })),
      review: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn(),
    }
    const scheduler = new SocialScheduler({ sessionManager: manager as never })

    await (scheduler as unknown as { scan: () => Promise<void> }).scan()

    expect(manager.review).toHaveBeenCalledWith(target, 'intent_due')
  })

  it('失败批次到期后走状态机重试而不是重新生成调度决策', async () => {
    const target = session({ phase: 'retrying', nextScanTime: 0 })
    const manager = {
      getActiveSessions: vi.fn(() => [target]),
      dueDeferredIntent: vi.fn(() => undefined),
      review: vi.fn(),
      retry: vi.fn().mockResolvedValue(undefined),
    }
    const scheduler = new SocialScheduler({ sessionManager: manager as never })

    await (scheduler as unknown as { scan: () => Promise<void> }).scan()

    expect(manager.retry).toHaveBeenCalledWith(target)
  })
})
