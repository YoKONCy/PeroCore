import { describe, expect, it } from 'vitest'
import { ConversationProjectionService } from '../../../src/projections/conversationProjectionService'
import { ApprovalService } from '../../../src/services/execution/approvalService'
import { AgentInputService } from '../../../src/services/execution/agentInputService'

function createProjection() {
  const approvals = new ApprovalService()
  const inputs = new AgentInputService()
  const service = new ConversationProjectionService(
    {
      getThread: async () => ({ id: 'thread-1', agentId: 'pero' }),
      listMessages: async () => ({ items: [], total: 0 }),
    } as never,
    { listForMessages: async () => new Map() } as never,
    approvals,
    inputs,
  )
  approvals.onRequested((request) => service.invalidate(request.threadId))
  inputs.onRequested((request) => service.invalidate(request.threadId))
  approvals.onResolved((request) => service.invalidate(request.threadId))
  inputs.onResolved((request) => service.invalidate(request.threadId))
  return { service, approvals, inputs }
}

describe('Conversation交互Surface投影', () => {
  it('缓存建立后新增求助仍应立即进入下一份Projection', async () => {
    const { service, inputs } = createProjection()
    expect((await service.getSnapshot('thread-1')).surfaces).toEqual([])

    inputs.create({
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'thread-1',
      threadId: 'thread-1',
      question: '你希望采用哪一种方式？',
    })

    const snapshot = await service.getSnapshot('thread-1')
    expect(snapshot.surfaces).toEqual([
      expect.objectContaining({
        surfaceId: expect.stringMatching(/^conversation-input:/),
        nodes: [expect.objectContaining({ kind: 'input' })],
      }),
    ])
  })

  it('缓存建立后新增审批仍应立即进入下一份Projection', async () => {
    const { service, approvals } = createProjection()
    await service.getSnapshot('thread-1')

    approvals.create({
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'thread-1',
      threadId: 'thread-1',
      toolName: 'delete_file',
      args: { file_path: 'C:/outside/test.txt' },
      reason: '需要删除工作区外文件',
    })

    const snapshot = await service.getSnapshot('thread-1')
    expect(snapshot.surfaces).toEqual([
      expect.objectContaining({
        surfaceId: expect.stringMatching(/^conversation-approval:/),
        nodes: [expect.objectContaining({ kind: 'approval' })],
      }),
    ])
  })
})
