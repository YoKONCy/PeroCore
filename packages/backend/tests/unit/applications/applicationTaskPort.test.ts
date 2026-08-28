import { describe, expect, it, vi } from 'vitest'
import { createAgentApplicationTaskPort } from '../../../src/applications/applicationTaskPort'

describe('ApplicationTaskPort', () => {
  it('应完成任务所有权移交并保留Correlation而非父Execution绑定', async () => {
    const task = {
      id: 'task-1',
      agentId: 'pero',
      threadId: 'thread-1',
      targetThreadId: null,
      title: 'Arca协作',
      instruction: '编辑文档',
      status: 'queued',
      progress: null,
      currentStage: null,
      result: null,
      errorMessage: null,
      toolCallCount: 0,
      priority: 5,
      requestedBy: 'runtime',
      completionAction: 'notify',
      category: 'agent_task',
      inputQuestion: null,
      inputContext: null,
      metadata: { applicationOperation: 'arca.collaboration' },
      execution: null,
      checkpoint: null,
      createdAt: '2026-08-22 00:00:00',
      startedAt: null,
      completedAt: null,
      readAt: null,
      updatedAt: '2026-08-22 00:00:00',
    } as const
    const scheduler = {
      dispatch: vi.fn(async () => task),
      getTask: vi.fn(async () => task),
      cancel: vi.fn(async () => ({ ...task, status: 'cancelled' as const })),
    }
    const port = createAgentApplicationTaskPort({
      appId: 'infos.arca',
      instanceId: 'managed',
      scheduler: scheduler as never,
    })
    const request = {
      operation: 'arca.collaboration',
      idempotencyKey: 'same-request',
      correlationId: 'correlation-1',
      causationId: 'agent-execution-1',
      input: { agentId: 'pero', instruction: '编辑文档' },
    }
    await expect(port.submit(request)).resolves.toEqual({
      accepted: true,
      taskId: 'task-1',
      acceptedAt: task.createdAt,
    })
    await port.submit(request)
    expect(scheduler.dispatch).toHaveBeenCalledOnce()
    expect(scheduler.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'infos.arca',
        realmId: 'infos.arca:managed',
        requestedBy: 'runtime',
        metadata: expect.objectContaining({
          correlationId: 'correlation-1',
          causationId: 'agent-execution-1',
        }),
      }),
    )
    expect(scheduler.dispatch.mock.calls[0]?.[0]).not.toHaveProperty('parentExecutionId')
  })
})
