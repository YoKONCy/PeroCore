import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SocialScheduler } from '@infos/social/runtime/socialScheduler'
import { SocialSessionManager } from '@infos/social/runtime/socialSessionManager'
import { socialGroupPolicyKey } from '@infos/shared'

function session(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'group-1',
    channelType: 'group',
    agentId: 'pero',
    accountId: '123456789',
    participation: 'idle',
    phase: 'ready',
    pendingMessages: [{ content: '一' }, { content: '二' }, { content: '三' }],
    inFlightMessages: [],
    lastActiveTime: 0,
    lastMessageTime: Date.now(),
    isMentioned: false,
    flushTimer: null,
    nextScanTime: 0,
    nextReviewTime: 0,
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
  it('同一扫描唤醒各个到期群，某群的慢请求不占用其他群观察机会', async () => {
    const low = session({ channelId: 'low', lastMessageTime: Date.now() - 100_000 })
    const high = session({ channelId: 'high', isMentioned: true })
    const review = vi.fn(() => new Promise<void>(() => {}))
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
    await vi.advanceTimersByTimeAsync(30_000)
    scheduler.stop()

    expect(review).toHaveBeenCalledTimes(2)
    expect(review).toHaveBeenCalledWith(low, 'proactive_review')
    expect(review).toHaveBeenCalledWith(high, 'proactive_review')
  })

  it('各账号和群分别使用策略，关闭一群不影响另一群或同群的另一个账号', async () => {
    const muted = session({ channelId: 'same' })
    const otherAccount = session({ channelId: 'same', accountId: '234567890' })
    const otherGroup = session({ channelId: 'other' })
    const review = vi.fn().mockResolvedValue(undefined)
    const scheduler = new SocialScheduler(
      {
        sessionManager: {
          listSessions: () => [muted, otherAccount, otherGroup],
          checkActiveExpiry: vi.fn(),
          dueDeferredIntent: () => undefined,
          review,
        } as never,
      },
      { nightSilenceEnabled: false },
    )
    scheduler.updateGroupPolicies({
      [socialGroupPolicyKey('pero', '123456789', 'same')]: { proactiveGroupEnabled: false },
    })
    await (scheduler as unknown as { scan(): Promise<void> }).scan()
    expect(review).toHaveBeenCalledTimes(2)
    expect(review).not.toHaveBeenCalledWith(muted, 'proactive_review')
  })

  it('没有候选不会产生全局冷却，下一次有足够消息就能独立触发', async () => {
    const target = session({ pendingMessages: [] })
    const review = vi.fn().mockResolvedValue(undefined)
    const scheduler = new SocialScheduler(
      {
        sessionManager: {
          listSessions: () => [target],
          checkActiveExpiry: vi.fn(),
          dueDeferredIntent: () => undefined,
          review,
        } as never,
      },
      { nightSilenceEnabled: false },
    )
    const scan = () => (scheduler as unknown as { scan(): Promise<void> }).scan()
    await scan()
    expect(review).not.toHaveBeenCalled()
    target.pendingMessages.push({ content: '一' }, { content: '二' }, { content: '三' })
    await scan()
    expect(review).toHaveBeenCalledWith(target, 'proactive_review')
  })

  it('20 条门槛可真实触发并一次处理完整观察批次，PASS 仅冷却本群', async () => {
    const flush = vi.fn().mockResolvedValue({ type: 'pass' })
    const manager = new SocialSessionManager(flush, undefined, (current) =>
      scheduler.getGroupPolicy(current.agentId, current.accountId, current.channelId),
    )
    const scheduler = new SocialScheduler(
      { sessionManager: manager },
      {
        nightSilenceEnabled: false,
        minMessagesForReview: 20,
      },
    )
    for (let index = 0; index < 30; index++) {
      await manager.handleInbound({
        platform: 'qq',
        agentId: 'pero',
        channelType: 'group',
        channelId: 'group-1',
        senderId: 'user',
        senderName: '群友',
        content: `消息 ${index}`,
        rawEvent: { self_id: '123456789', message_id: index },
      })
    }
    expect(manager.listSessions()[0]!.pendingMessages).toHaveLength(20)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(30_000)
    scheduler.stop()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush.mock.calls[0]![1]).toHaveLength(20)
    expect(manager.listSessions()[0]!.pendingMessages).toHaveLength(0)
    expect(manager.listSessions()[0]!.nextReviewTime).toBe(Date.now() + 180_000)
    manager.stop()
  })

  it('缩短某群间隔会重算该群时钟，保留其他群策略和延后意图唤醒时间', () => {
    const target = session({
      lastReviewTime: Date.now() - 60_000,
      nextReviewTime: Date.now() + 120_000,
    })
    const other = session({
      channelId: 'other',
      lastReviewTime: Date.now(),
      nextReviewTime: Date.now() + 180_000,
    })
    const scheduler = new SocialScheduler(
      {
        sessionManager: {
          listSessions: () => [target, other],
        } as never,
      },
      { nightSilenceEnabled: false },
    )
    scheduler.updateGroupPolicies({
      [socialGroupPolicyKey('pero', '123456789', 'group-1')]: { reviewIntervalSeconds: 30 },
    })
    expect(target.nextReviewTime).toBe(Date.now())
    expect(target.nextScanTime).toBe(0)
    expect(other.nextReviewTime).toBe(Date.now() + 180_000)
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
