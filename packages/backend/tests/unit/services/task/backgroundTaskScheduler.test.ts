import { describe, expect, it, vi } from 'vitest'
import { BackgroundTaskService } from '@infos/backend/services/task/backgroundTaskService'

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    revision: 1,
    lifecycleJson: null,
    agentId: 'pero',
    threadId: 'thread-task',
    targetThreadId: null,
    title: '后台任务',
    instruction: '执行任务',
    status: 'queued',
    progress: 0,
    currentStage: null,
    result: null,
    errorMessage: null,
    toolCallCount: 0,
    priority: 5,
    requestedBy: 'user',
    completionAction: 'notify',
    category: 'agent_task',
    inputQuestion: null,
    inputContextJson: null,
    metadataJson: '{}',
    checkpointJson: null,
    createdAt: '2026-01-01 00:00:00',
    startedAt: null,
    completedAt: null,
    readAt: null,
    updatedAt: '2026-01-01 00:00:00',
    ...overrides,
  }
}

function setup() {
  const rows = new Map<string, ReturnType<typeof taskRow>>()
  const seed = (row: ReturnType<typeof taskRow>) => {
    rows.set(String(row.id), row)
    return row
  }
  const repo = {
    create: vi.fn(async (input) => {
      return seed(taskRow({ ...input, metadataJson: input.metadataJson ?? '{}' }))
    }),
    findById: vi.fn(async (id: string) => rows.get(id) ?? null),
    transition: vi.fn(async (id: string, from: string | string[], to: string, patch = {}) => {
      const row = rows.get(id)
      if (!row || !(Array.isArray(from) ? from : [from]).includes(String(row.status))) return false
      seed({ ...row, ...patch, status: to })
      return true
    }),
    listWaiting: vi.fn(async () =>
      [...rows.values()].filter((row) => ['waiting', 'waiting_input'].includes(String(row.status))),
    ),
    listQueued: vi.fn(async () => [...rows.values()].filter((row) => row.status === 'queued')),
    update: vi.fn(async (id: string, patch) => {
      const row = rows.get(id)
      if (!row) return false
      seed({ ...row, ...patch })
      return true
    }),
  }
  const threadService = {
    createThread: vi.fn(async () => ({ id: 'thread-task' })),
    appendSystemMessage: vi.fn(),
  }
  const executeTurn = vi.fn(async () => ({ reply: '完成', toolCalls: [] }))
  let scheduleInput: Record<string, unknown> | undefined
  const listeners: Array<(snapshot: any) => void> = []
  const scheduler = {
    subscribe: vi.fn((listener) => {
      listeners.push(listener)
      return () => undefined
    }),
    submit: vi.fn(async (input) => {
      scheduleInput = input
      const descriptor = {
        executionId: 'execution-task-1',
        processId: 'process-task-1',
        principalId: input.principalId,
        taskId: input.taskId,
        class: input.class,
        priority: input.priority,
        budget: input.budget,
      }
      void input.run({
        descriptor,
        signal: new AbortController().signal,
        usage: { llmCalls: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0, concurrentIo: 0 },
        consume: vi.fn(),
        beginIo: vi.fn(() => () => undefined),
        wait: vi.fn(),
        resume: vi.fn(),
      })
      return {
        descriptor,
        state: 'queued',
        usage: { llmCalls: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0, concurrentIo: 0 },
        queuedAt: new Date().toISOString(),
      }
    }),
    get: vi.fn(),
    pause: vi.fn(() => true),
    resume: vi.fn(() => true),
    cancel: vi.fn(async () => true),
  }
  const service = new BackgroundTaskService(
    repo as never,
    threadService as never,
    { executeTurn } as never,
    scheduler as never,
  )
  return { service, repo, scheduler, executeTurn, getScheduleInput: () => scheduleInput, seed }
}

describe('BackgroundTask KernelScheduler迁移', () => {
  it('启动时补交排队任务，缺少可恢复等待条件的中断任务进入阻塞', async () => {
    const { service, repo, scheduler, seed } = setup()
    Object.assign(repo, {
      listInterrupted: vi.fn(async () => [
        seed(taskRow({ id: 'running-task', status: 'running' })),
        seed(taskRow({ id: 'waiting-task', status: 'waiting_input' })),
      ]),
      listQueued: vi.fn(async () => [seed(taskRow({ id: 'queued-task' }))]),
    })
    scheduler.submit.mockResolvedValue({
      descriptor: { executionId: 'recovered-execution' },
    } as never)
    expect(await service.recoverInterruptedTasks()).toBe(2)
    expect(repo.transition).toHaveBeenCalledWith(
      'waiting-task',
      ['running', 'waiting_input'],
      'blocked',
      expect.objectContaining({ lifecycleJson: expect.any(String) }),
      1,
    )
    expect(scheduler.submit).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'queued-task' }),
    )
  })
  it('一次性跟进继承受限作用域和较小预算', async () => {
    const ordinary = setup()
    await ordinary.service.dispatch({ agentId: 'pero', instruction: '常规任务' })
    const normalBudget = ordinary.getScheduleInput()!.budget as {
      maxDurationMs: number
      maxToolCalls: number
    }
    const { service, scheduler, executeTurn, getScheduleInput } = setup()
    await service.dispatch({
      agentId: 'pero',
      instruction: '重新读取结果',
      metadata: { capabilityScope: 'follow_up' },
    })
    await vi.waitFor(() => expect(executeTurn).toHaveBeenCalledOnce())
    expect(scheduler.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        budget: expect.objectContaining({
          maxDurationMs: expect.any(Number),
          maxToolCalls: expect.any(Number),
        }),
      }),
    )
    const budget = getScheduleInput()!.budget as typeof normalBudget
    expect(budget.maxDurationMs).toBeGreaterThan(0)
    expect(budget.maxDurationMs).toBeLessThan(normalBudget.maxDurationMs)
    expect(budget.maxToolCalls).toBeLessThan(normalBudget.maxToolCalls)
    expect(executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityScope: 'follow_up' }),
    )
  })

  it('并发与重启后的重复派发返回同一任务', async () => {
    const { service, repo, scheduler } = setup()
    let saved: ReturnType<typeof taskRow> | null = null
    repo.findById.mockImplementation(async (id: string) => (saved?.id === id ? saved : null))
    repo.create.mockImplementation(async (input) => {
      saved = taskRow({ ...input, metadataJson: input.metadataJson ?? '{}' })
      return saved
    })
    scheduler.submit.mockImplementation(
      async (input) =>
        ({ descriptor: { executionId: 'unique-execution', taskId: input.taskId } }) as never,
    )
    const input = { agentId: 'pero', instruction: '检查', idempotencyKey: 'schedule:1' }
    const [first, second] = await Promise.all([service.dispatch(input), service.dispatch(input)])
    expect(first.id).toBe(second.id)
    expect(repo.create).toHaveBeenCalledTimes(1)
    const recovered = new BackgroundTaskService(
      repo as never,
      {} as never,
      {} as never,
      scheduler as never,
    )
    const again = await recovered.dispatch(input)
    expect(again.id).toBe(first.id)
    expect(repo.create).toHaveBeenCalledTimes(1)
  })
  it('应提交background Execution并用Agent资源键保持串行', async () => {
    const { service, scheduler, executeTurn, getScheduleInput } = setup()
    await service.dispatch({ agentId: 'pero', instruction: '执行任务', priority: 7 })
    await vi.waitFor(() => expect(executeTurn).toHaveBeenCalled())
    expect(scheduler.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: 'pero',
        taskId: expect.any(String),
        class: 'background',
        priority: 7,
        resourceKey: 'agent:pero',
      }),
    )
    expect(getScheduleInput()?.budget).toEqual(
      expect.objectContaining({
        maxDurationMs: expect.any(Number),
        maxToolCalls: expect.any(Number),
      }),
    )
    expect(executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: expect.any(String),
        execution: expect.objectContaining({ executionId: 'execution-task-1' }),
      }),
    )
  })

  it('Scheduler拒绝时应将持久任务标记失败', async () => {
    const { service, repo, scheduler } = setup()
    scheduler.submit.mockRejectedValueOnce(new Error('KERNEL_SCHEDULER_BACKPRESSURE'))
    await service.dispatch({ agentId: 'pero', instruction: '执行任务' })
    await vi.waitFor(() => expect(repo.transition).toHaveBeenCalled())
    expect(repo.transition).toHaveBeenCalledWith(
      expect.any(String),
      'queued',
      'failed',
      expect.objectContaining({ errorMessage: 'KERNEL_SCHEDULER_BACKPRESSURE' }),
    )
  })
})
