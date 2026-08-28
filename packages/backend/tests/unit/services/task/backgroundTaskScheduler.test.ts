import { describe, expect, it, vi } from 'vitest'
import { BackgroundTaskService } from '@infos/backend/services/task/backgroundTaskService'

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
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
  let row = taskRow()
  const repo = {
    create: vi.fn(async (input) => {
      row = taskRow({ ...input, metadataJson: input.metadataJson ?? '{}' })
      return row
    }),
    findById: vi.fn(async () => row),
    transition: vi.fn(async (_id, _from, to, patch = {}) => {
      row = { ...row, ...patch, status: to }
      return true
    }),
    update: vi.fn(async (_id, patch) => {
      row = { ...row, ...patch }
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
  return { service, repo, scheduler, executeTurn, getScheduleInput: () => scheduleInput }
}

describe('BackgroundTask KernelScheduler迁移', () => {
  it('应提交background Execution并用Agent资源键保持串行', async () => {
    const { service, scheduler, executeTurn, getScheduleInput } = setup()
    await service.dispatch({ agentId: 'pero', instruction: '执行任务', priority: 7 })
    await new Promise((resolve) => setTimeout(resolve, 10))
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
      expect.objectContaining({ maxDurationMs: 1_800_000, maxToolCalls: 96 }),
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
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(repo.transition).toHaveBeenCalledWith(
      expect.any(String),
      'queued',
      'failed',
      expect.objectContaining({ errorMessage: 'KERNEL_SCHEDULER_BACKPRESSURE' }),
    )
  })
})
