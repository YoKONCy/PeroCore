import { describe, expect, it, vi } from 'vitest'
import { WorkspaceCheckpointService } from '@infos/backend/services/workspace/workspaceCheckpointService'

describe('WorkspaceCheckpointService 工具上下文映射', () => {
  it('将 ToolContext.toolCallId 显式映射为快照 callId', async () => {
    const service = new WorkspaceCheckpointService({} as never, {} as never)
    const capture = vi.spyOn(service, 'captureBefore').mockResolvedValue(null)

    await service.captureToolMutation(
      {
        source: 'desktop',
        agentId: 'nana',
        sessionId: 'thread-1',
        threadId: 'thread-1',
        channel: 'desktop',
        pairId: 'pair-1',
        toolCallId: 'call-1',
      },
      'turtle_soup_truth.txt',
    )

    expect(capture).toHaveBeenCalledWith(
      {
        agentId: 'nana',
        threadId: 'thread-1',
        pairId: 'pair-1',
        callId: 'call-1',
        channel: 'desktop',
        taskId: undefined,
      },
      'turtle_soup_truth.txt',
    )
  })
})
