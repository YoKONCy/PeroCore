import { describe, expect, it } from 'vitest'
import { ConversationSurfaceSession } from '@infos/backend/projections/conversationSurfaceSession'
import { ConversationSurfaceProjector } from '@infos/backend/projections/conversationSurfaceProjector'

describe('Conversation Surface Session', () => {
  it('所有帧应绑定同一 Execution、Generation 且序号单调递增', () => {
    const session = new ConversationSurfaceSession('thread-1', 'pero', 'execution-1')
    const frames = [
      session.open(),
      session.startNarration('narration-1'),
      session.appendText('narration-1', '你好'),
      session.status('generating'),
    ]

    expect(frames.map((frame) => frame.executionId)).toEqual([
      'execution-1',
      'execution-1',
      'execution-1',
      'execution-1',
    ])
    expect(new Set(frames.map((frame) => frame.generation)).size).toBe(1)
    expect(frames.map((frame) => frame.sequence)).toEqual([1, 2, 3, 4])
  })

  it('工具草稿应在同一节点中流式组装并切换为调用态', () => {
    const session = new ConversationSurfaceSession('thread-1', 'pero', 'execution-1')
    const start = session.startToolDraft('tool-draft-1-0')
    const delta = session.appendToolDraft('tool-draft-1-0', 'browser_search', '{"query":"Nana', 14)
    const ready = session.finalizeToolDraft({
      draftId: 'tool-draft-1-0',
      callId: 'call-1',
      name: 'browser_search',
      args: { query: 'Nana' },
    })

    const operations = [start, delta, ready].map((frame) => frame.operation)
    expect(operations.every((operation) => operation.type === 'surface.upsert-node')).toBe(true)
    const nodes = operations.map((operation) =>
      operation.type === 'surface.upsert-node' ? operation.node : undefined,
    )
    expect(new Set(nodes.map((node) => node?.nodeId)).size).toBe(1)
    expect(nodes[0]?.props).toMatchObject({ state: 'assembling', name: '', args: '' })
    expect(nodes[1]?.props).toMatchObject({
      state: 'assembling',
      name: 'browser_search',
      args: '{"query":"Nana',
      receivedChars: 14,
    })
    expect(nodes[2]?.props).toMatchObject({
      state: 'calling',
      callId: 'call-1',
      name: 'browser_search',
      args: '{"query":"Nana"}',
    })
  })

  it('最终Commit应稳定携带流式模式与耗时遥测', () => {
    const session = new ConversationSurfaceSession('thread-1', 'pero', 'execution-1')
    const surface = {
      surfaceId: 'conversation-message:2',
      generation: 'message:2:1',
      messageId: '2',
      threadId: 'thread-1',
      principalId: 'pero',
      revision: 1,
      sequence: 1,
      state: 'committed' as const,
      nodes: [],
    }
    const snapshot = {
      protocolVersion: 1 as const,
      threadId: 'thread-1',
      agentId: 'pero',
      channel: 'desktop' as const,
      revision: 1,
      generatedAt: new Date().toISOString(),
      messages: [],
      surfaces: [surface],
    }
    const frame = session.commit(
      snapshot,
      { messageId: '2', role: 'assistant', content: '回复', createdAt: new Date().toISOString() },
      surface,
      { mode: 'stream', firstTokenMs: 120, outputDurationMs: 480, totalDurationMs: 650 },
    )

    expect(frame.operation).toMatchObject({
      type: 'surface.commit',
      surface: {
        nodes: [
          {
            kind: 'status',
            props: {
              state: 'completed',
              mode: 'stream',
              firstTokenMs: 120,
              outputDurationMs: 480,
              totalDurationMs: 650,
            },
          },
        ],
      },
    })
  })

  it('历史Projection应按正文、工具、正文顺序重建Timeline', () => {
    const projector = new ConversationSurfaceProjector()
    const surface = projector.projectMessage(
      {
        messageId: '2',
        threadId: 'thread-1',
        role: 'assistant',
        content: '准备检查。检查完成。',
        revision: 1,
        imageTranscription: false,
        status: 'active',
        timestamp: new Date().toISOString(),
        contentBlocks: [
          {
            blockId: 'native-reasoning-1',
            sequence: 0,
            kind: 'native_reasoning',
            turn: 1,
            content: '正在分析。',
            mode: 'stream',
            durationMs: 120,
          },
          {
            blockId: 'narration-1',
            sequence: 1,
            kind: 'narration',
            turn: 1,
            phase: 'progress',
            content: '准备检查。',
          },
          {
            blockId: 'tool-call-1',
            sequence: 2,
            kind: 'tool',
            turn: 1,
            callId: 'call-1',
            name: 'read_file',
            args: '{}',
            result: '内容',
          },
          {
            blockId: 'narration-2',
            sequence: 3,
            kind: 'narration',
            turn: 2,
            phase: 'final',
            content: '检查完成。',
          },
        ],
        toolCalls: [],
        attachments: [],
      },
      'pero',
    )

    expect(surface.nodes.map((node) => node.kind)).toEqual([
      'native-reasoning',
      'markdown',
      'tool-call',
      'tool-result',
      'markdown',
    ])
  })

  it('工具结果应使用独立稳定节点，不覆盖工具调用身份', () => {
    const session = new ConversationSurfaceSession('thread-1', 'pero', 'execution-1')
    const call = session.toolCall({ callId: 'call-1', name: 'read_file', args: { path: 'a.ts' } })
    const [result] = session.toolResult({
      callId: 'call-1',
      result: '内容',
      isError: false,
      durationMs: 12,
    })

    expect(call.operation).toMatchObject({
      type: 'surface.upsert-node',
      node: { kind: 'tool-call', props: { name: 'read_file' } },
    })
    expect(result?.operation).toMatchObject({
      type: 'surface.upsert-node',
      node: { kind: 'tool-result', props: { callId: 'call-1', result: '内容' } },
    })
  })
})
