import { describe, expect, it, vi } from 'vitest'
import type { KernelExecutionId } from '@infos/shared'
import { KernelScheduler } from '@infos/backend/kernel/kernelScheduler'

function runtime() {
  return {
    create: vi.fn(async (input) => ({
      executionId: crypto.randomUUID() as KernelExecutionId,
      processId: crypto.randomUUID(),
      principalId: input.principalId,
      taskId: input.taskId,
      class: input.class,
      priority: input.priority ?? 5,
      deadline: input.deadline,
      budget: input.budget ?? {},
    })),
    start: vi.fn(),
    stateChanged: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn(),
    timeout: vi.fn(),
    fail: vi.fn(),
  }
}

function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 15))
}

describe('KernelScheduler', () => {
  it('应按调度类别和优先级选择任务，并受全局并发限制', async () => {
    const execution = runtime()
    const scheduler = new KernelScheduler(execution as never, {
      maxQueued: 8,
      maxRunning: 1,
      classConcurrency: {},
      agingIntervalMs: 10_000,
    })
    const blocker = gate()
    const order: string[] = []
    await scheduler.submit({
      principalId: 'system',
      class: 'background',
      priority: 1,
      run: async () => blocker.promise,
    })
    await settle()
    await scheduler.submit({
      principalId: 'system',
      class: 'maintenance',
      priority: 9,
      run: async () => void order.push('maintenance'),
    })
    await scheduler.submit({
      principalId: 'human',
      class: 'interactive',
      priority: 1,
      run: async () => void order.push('interactive'),
    })
    blocker.release()
    await settle()
    await settle()
    expect(order).toEqual(['interactive', 'maintenance'])
  })

  it('应限制同类并发并投影明确WaitReason', async () => {
    const scheduler = new KernelScheduler(runtime() as never, {
      maxQueued: 8,
      maxRunning: 3,
      classConcurrency: { background: 1 },
      agingIntervalMs: 100,
    })
    const blocker = gate()
    await scheduler.submit({ principalId: 'a', class: 'background', run: () => blocker.promise })
    await settle()
    const queued = await scheduler.submit({
      principalId: 'b',
      class: 'background',
      run: async () => undefined,
    })
    await settle()
    expect(scheduler.get(queued.descriptor.executionId)).toMatchObject({
      state: 'queued',
      waitReason: 'class_capacity',
    })
    blocker.release()
    await settle()
  })

  it('应以resourceKey保证互斥，但允许无冲突资源并行', async () => {
    const scheduler = new KernelScheduler(runtime() as never, {
      maxQueued: 8,
      maxRunning: 2,
      classConcurrency: {},
      agingIntervalMs: 100,
    })
    const blocker = gate()
    await scheduler.submit({
      principalId: 'a',
      class: 'background',
      resourceKey: 'agent:pero',
      run: () => blocker.promise,
    })
    await settle()
    const same = await scheduler.submit({
      principalId: 'b',
      class: 'interactive',
      resourceKey: 'agent:pero',
      run: async () => undefined,
    })
    const other = await scheduler.submit({
      principalId: 'c',
      class: 'interactive',
      resourceKey: 'agent:nana',
      run: async () => undefined,
    })
    await settle()
    expect(scheduler.get(same.descriptor.executionId)?.waitReason).toBe('resource_locked')
    expect(scheduler.get(other.descriptor.executionId)?.state).toBe('completed')
    blocker.release()
    await settle()
  })

  it('队列达到上限时必须Backpressure拒绝', async () => {
    const scheduler = new KernelScheduler(runtime() as never, {
      maxQueued: 1,
      maxRunning: 1,
      classConcurrency: {},
      agingIntervalMs: 100,
    })
    const blocker = gate()
    await scheduler.submit({ principalId: 'a', class: 'background', run: () => blocker.promise })
    await settle()
    await scheduler.submit({ principalId: 'b', class: 'background', run: async () => undefined })
    await expect(
      scheduler.submit({ principalId: 'c', class: 'background', run: async () => undefined }),
    ).rejects.toThrow('KERNEL_SCHEDULER_BACKPRESSURE')
    blocker.release()
  })

  it('应支持排队取消与运行中取消', async () => {
    const execution = runtime()
    const scheduler = new KernelScheduler(execution as never, {
      maxQueued: 8,
      maxRunning: 1,
      classConcurrency: {},
      agingIntervalMs: 100,
    })
    const blocker = gate()
    const running = await scheduler.submit({
      principalId: 'a',
      class: 'background',
      run: async ({ signal }) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')))
        })
      },
    })
    await settle()
    const queued = await scheduler.submit({
      principalId: 'b',
      class: 'background',
      run: () => blocker.promise,
    })
    await scheduler.cancel(queued.descriptor.executionId)
    await scheduler.cancel(running.descriptor.executionId)
    await settle()
    expect(scheduler.get(queued.descriptor.executionId)?.state).toBe('cancelled')
    expect(scheduler.get(running.descriptor.executionId)?.state).toBe('cancelled')
  })

  it('应支持协作式暂停和恢复', async () => {
    const scheduler = new KernelScheduler(runtime() as never)
    let runs = 0
    const first = gate()
    const snapshot = await scheduler.submit({
      principalId: 'a',
      class: 'background',
      run: async ({ signal }) => {
        runs += 1
        if (runs === 1) {
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('暂停', 'AbortError')))
            first.promise.then(() => undefined)
          })
        }
      },
    })
    await settle()
    expect(scheduler.pause(snapshot.descriptor.executionId)).toBe(true)
    await settle()
    expect(scheduler.get(snapshot.descriptor.executionId)).toMatchObject({
      state: 'suspended',
      waitReason: 'paused',
    })
    expect(scheduler.resume(snapshot.descriptor.executionId)).toBe(true)
    await settle()
    expect(scheduler.get(snapshot.descriptor.executionId)?.state).toBe('completed')
    expect(runs).toBe(2)
  })

  it('应执行Deadline并标记timed_out', async () => {
    const scheduler = new KernelScheduler(runtime() as never)
    const snapshot = await scheduler.submit({
      principalId: 'a',
      class: 'interactive',
      budget: { maxDurationMs: 10 },
      run: async ({ signal }) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('超时', 'AbortError')))
        })
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(scheduler.get(snapshot.descriptor.executionId)?.state).toBe('timed_out')
  })

  it('应执行LLM、Token、Tool和I/O预算', async () => {
    const scheduler = new KernelScheduler(runtime() as never)
    const snapshot = await scheduler.submit({
      principalId: 'a',
      class: 'interactive',
      budget: { maxLlmCalls: 1, maxConcurrentIo: 1 },
      run: async (context) => {
        context.consume({ llmCalls: 1 })
        const end = context.beginIo()
        end()
        context.consume({ llmCalls: 1 })
      },
    })
    await settle()
    expect(scheduler.get(snapshot.descriptor.executionId)).toMatchObject({
      state: 'failed',
      usage: { llmCalls: 2, concurrentIo: 0 },
    })
  })

  it('应由内核注册、触发并统计周期计划', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const scheduler = new KernelScheduler(runtime() as never)
    const handler = vi.fn().mockResolvedValue(undefined)
    scheduler.registerPeriodic({
      name: 'reflection',
      displayName: '深度记忆维护',
      description: '维护长期记忆',
      intervalMs: 60_000,
      handler,
    })

    expect(scheduler.getPeriodicScheduleStatus()[0]).toMatchObject({
      name: 'reflection',
      running: false,
      nextDueAt: Date.parse('2026-01-01T00:01:00.000Z'),
    })
    expect(await scheduler.triggerPeriodicNow('reflection')).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(scheduler.getPeriodicScheduleStatus()[0]).toMatchObject({
      lastOutcome: 'success',
      stats: { totalRuns: 1, successCount: 1, errorCount: 0 },
    })
    vi.useRealTimers()
  })

  it('周期计划失败时应记录错误且保持可再次调度', async () => {
    const scheduler = new KernelScheduler(runtime() as never)
    scheduler.registerPeriodic({
      name: 'failing',
      displayName: '失败计划',
      description: '验证错误状态',
      intervalMs: 60_000,
      handler: async () => {
        throw new Error('计划失败')
      },
    })

    expect(await scheduler.triggerPeriodicNow('failing')).toBe(true)
    expect(scheduler.getPeriodicScheduleStatus()[0]).toMatchObject({
      running: false,
      lastOutcome: 'error',
      stats: { totalRuns: 1, successCount: 0, errorCount: 1 },
    })
  })
})
