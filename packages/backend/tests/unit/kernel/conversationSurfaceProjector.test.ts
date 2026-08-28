import type { ConversationMessageProjection } from '@infos/shared'
import { describe, expect, it } from 'vitest'
import { ConversationSurfaceProjector } from '@infos/backend/projections/conversationSurfaceProjector'

function message(revision = 1): ConversationMessageProjection {
  return {
    messageId: '42',
    threadId: 'thread-1',
    role: 'assistant',
    content: '## 完成',
    rawContent: null,
    pairId: 'pair-1',
    senderId: 'pero',
    agentId: 'pero',
    revision,
    imageTranscription: false,
    status: 'completed',
    timestamp: '2026-08-18T00:00:00.000Z',
    toolCalls: [
      {
        callId: 'call-1',
        name: 'read_file',
        args: '{"path":"a.ts"}',
        result: '内容',
        isError: false,
      },
    ],
    attachments: [],
  }
}

describe('Conversation Surface Projector', () => {
  it('相同领域消息必须生成完全相同的 committed Surface', () => {
    const projector = new ConversationSurfaceProjector()
    const first = projector.projectMessage(message(), 'pero')
    const second = projector.projectMessage(message(), 'pero')

    expect(second).toEqual(first)
  })

  it('编辑只改变 generation 和 revision，不改变稳定 Surface 与 Node 身份', () => {
    const projector = new ConversationSurfaceProjector()
    const first = projector.projectMessage(message(1), 'pero')
    const edited = projector.projectMessage(message(2), 'pero')

    expect(edited.surfaceId).toBe(first.surfaceId)
    expect(edited.nodes.map(({ kind, nodeId }) => ({ kind, nodeId }))).toEqual(
      first.nodes.map(({ kind, nodeId }) => ({ kind, nodeId })),
    )
    expect(edited.generation).not.toBe(first.generation)
    expect(edited.revision).toBe(2)
  })

  it('工具调用和结果必须保留独立节点身份', () => {
    const surface = new ConversationSurfaceProjector().projectMessage(message(), 'pero')
    expect(surface.nodes.map((node) => [node.kind, node.nodeId])).toEqual([
      ['markdown', 'conversation-message:42:markdown'],
      ['tool-call', 'conversation-message:42:tool:call-1'],
      ['tool-result', 'conversation-message:42:tool-result:call-1'],
    ])
  })
})
