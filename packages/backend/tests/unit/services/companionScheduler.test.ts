import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanionScheduler } from '@infos/backend/services/companion/companionScheduler'

afterEach(() => vi.useRealTimers())

describe('主动陪伴的有界调度', () => {
  it('一次判断未结束时不会反复提交排队任务', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
    let finish!: (value: unknown) => void
    const scheduler = {
      submitAndWait: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      ),
    }
    const companion = new CompanionScheduler({
      agentId: 'pero',
      config: { intervalMs: 1000 },
      kernelScheduler: scheduler as never,
      onProactiveChat: vi.fn(),
      onPushMessage: vi.fn(),
      onSummarize: vi.fn(),
    })
    companion.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(scheduler.submitAndWait).toHaveBeenCalledTimes(1)
    finish({ state: 'completed' })
    await Promise.resolve()
    await companion.stop()
  })

  it('失败后按陪伴间隔冷却，不会每十秒重新调用模型', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
    const scheduler = { submitAndWait: vi.fn().mockRejectedValue(new Error('模型服务不可用')) }
    const companion = new CompanionScheduler({
      agentId: 'pero',
      config: { intervalMs: 60_000 },
      kernelScheduler: scheduler as never,
      onProactiveChat: vi.fn(),
      onPushMessage: vi.fn(),
      onSummarize: vi.fn(),
    })
    companion.start()
    await vi.advanceTimersByTimeAsync(100_000)
    expect(scheduler.submitAndWait).toHaveBeenCalledTimes(1)
    await companion.stop()
  })
})
