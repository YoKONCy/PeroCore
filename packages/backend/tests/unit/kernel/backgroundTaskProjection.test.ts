import type { ConversationProjectionSnapshot } from '@infos/shared'
import { describe, expect, it, vi } from 'vitest'
import { AgentInputService } from '@infos/backend/services/execution/agentInputService'
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
    const inputs = new AgentInputService()
    const question = inputs.create({
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'task-thread',
      threadId: 'task-thread',
      taskId: 'task-1',
      questions: [{ id: 'continue', question: '是否继续？' }],
    })
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
      inputs,
    )

    const snapshot = await service.getSnapshot('task-1')
    const nodes = snapshot.surfaces[0]!.nodes
    expect(nodes.find((node) => node.kind === 'markdown')?.props).toMatchObject({
      source: expect.stringContaining('整理项目资料'),
    })
    expect(nodes.find((node) => node.kind === 'status')?.props).toMatchObject({
      state: 'waiting_input',
      message: '等待确认',
    })
    expect(nodes.find((node) => node.kind === 'progress')?.props).toMatchObject({ value: 50 })
    expect(nodes.find((node) => node.kind === 'input')?.props).toMatchObject({
      question: '是否继续？',
    })
    expect(snapshot.taskId).toBe('task-1')
    expect(snapshot.surfaces[0]?.surfaceId).toBe('background-task:task-1')
    expect(nodes.filter((node) => node.kind === 'input')).toHaveLength(1)
    expect(nodes.find((node) => node.kind === 'input')?.props).toMatchObject({
      inputId: question.id,
      principalId: 'pero',
      questions: [{ id: 'continue', question: '是否继续？' }],
    })
    inputs.resolve(question.id, {
      answers: [{ questionId: 'continue', selectedOptionIds: [], message: '继续' }],
    })
    const answered = await service.getSnapshot('task-1')
    expect(answered.surfaces[0]?.nodes.some((node) => node.kind === 'input')).toBe(false)
  })
})
