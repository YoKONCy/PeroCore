import type { ConversationProjectionSnapshot } from '@infos/shared'
import { describe, expect, it, vi } from 'vitest'
import { BackgroundTaskProjectionService } from '@infos/backend/projections/backgroundTaskProjectionService'

const conversation: ConversationProjectionSnapshot = {
  protocolVersion: 1,
  threadId: 'task-thread',
  principalId: 'pero',
  revision: 1,
  generatedAt: '2026-08-18T00:00:00.000Z',
  messages: [],
  surfaces: [],
}

describe('Background Task Projection', () => {
  it('应把任务状态、输入和专属 Thread 归一为同一 Snapshot', async () => {
    const service = new BackgroundTaskProjectionService(
      {
        getTask: vi.fn(async () => ({
          id: 'task-1',
          agentId: 'pero',
          threadId: 'task-thread',
          targetThreadId: null,
          title: '整理资料',
          instruction: '整理项目资料',
          status: 'waiting_input',
          progress: 50,
          currentStage: '等待确认',
          result: null,
          errorMessage: null,
          toolCallCount: 1,
          priority: 5,
          requestedBy: 'user',
          completionAction: 'notify',
          category: 'agent_task',
          inputQuestion: '是否继续？',
          inputContext: null,
          checkpoint: null,
          createdAt: '2026-08-18 00:00:00',
          startedAt: null,
          completedAt: null,
          readAt: null,
          updatedAt: '2026-08-18 00:01:00',
        })),
      } as never,
      { getSnapshot: vi.fn(async () => conversation) } as never,
      { list: vi.fn(() => []) } as never,
    )

    const snapshot = await service.getSnapshot('task-1')
    expect(snapshot.taskId).toBe('task-1')
    expect(snapshot.surfaces[0]?.surfaceId).toBe('background-task:task-1')
    expect(snapshot.surfaces[0]?.nodes.map((node) => node.kind)).toEqual([
      'markdown',
      'status',
      'progress',
      'input',
    ])
  })
})
