import type { SurfaceId } from '@infos/shared'
import { describe, expect, it } from 'vitest'
import { ConversationSurfaceSession } from '@infos/backend/projections/conversationSurfaceSession'
import { ConversationSurfaceProjector } from '@infos/backend/projections/conversationSurfaceProjector'

describe('Conversation Surface Session', () => {
  it('队列实时快照包含已生成正文和工具参数，可在断线后直接接续观察', () => {
    const session = new ConversationSurfaceSession('thread', 'pero', 'run', true)
    session.open()
    session.startNarration('text')
    session.appendText('text', '已生成的进度')
    session.startToolDraft('draft')
    session.appendToolDraft('draft', 'read_file', '{"path":"a.ts"}', 15)
    const snapshot = session.liveSnapshot()
    expect(snapshot.state).toBe('open')
    expect(snapshot.nodes).toContainEqual(
      expect.objectContaining({
        kind: 'markdown',
        props: expect.objectContaining({ source: '已生成的进度' }),
      }),
    )
    expect(snapshot.nodes).toContainEqual(
      expect.objectContaining({
        kind: 'tool-call',
        props: expect.objectContaining({ name: 'read_file', args: '{"path":"a.ts"}' }),
      }),
    )
    expect(snapshot.sequence).toBeGreaterThan(0)
  })
  it('流式提交保留暂停终态，不再覆盖成输出完成', () => {
    const message = { messageId: '42', executionPause: { kind: 'desktop', message: '用户已接管' } }
    const surface = {
      surfaceId: 'message:42',
      nodes: [{ kind: 'status', props: { state: 'paused' } }],
    }
    const snapshot = { surfaces: [surface] }
    const session = new ConversationSurfaceSession('thread', 'pero', 'run')
    const frame = session.commit(snapshot as never, message as never, surface as never, {
      totalDurationMs: 100,
    })
    if (frame.operation.type !== 'surface.commit') throw new Error('缺少持久提交')
    const statuses = frame.operation.surface.nodes.filter((node) => node.kind === 'status')
    expect(statuses).toHaveLength(1)
    expect(statuses[0]?.props).toMatchObject({
      state: 'paused',
      message: '桌面操作已暂停：用户已接管',
    })
  })
  it('输入占用补丁写入现有状态节点，后续阶段切换仍携带最新统计', () => {
    const session = new ConversationSurfaceSession('thread-1', 'pero', 'execution-1')
    const open = session.open()
    const budget = {
      usedTokens: 12_000,
      maxInputTokens: 30_000,
      contextWindowTokens: 32_000,
      modelId: 'test-model',
      turn: 3,
      estimated: true,
      updatedAt: 100,
    }
    const patch = session.contextBudget(budget)
    expect(patch.operation).toMatchObject({
      type: 'surface.patch-node',
      nodeId: `${session.surfaceId}:status`,
      patch: { contextBudget: budget },
    })
    const status = session.status('calling', '正在等待工具回传……')
    expect(status.operation).toMatchObject({
      type: 'surface.upsert-node',
      node: {
        nodeId: `${session.surfaceId}:status`,
        props: { state: 'calling', contextBudget: budget },
      },
    })
    session.contextBudget({ ...budget, usedTokens: 12_345, estimated: false, updatedAt: 101 })
    expect(session.status('thinking').operation).toMatchObject({
      node: {
        props: {
          contextBudget: { usedTokens: 12_345, estimated: false, updatedAt: 101 },
        },
      },
    })
    expect(patch.sequence).toBeGreaterThan(open.sequence)
  })

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

    const operations = [start, delta, ready].map((frame) => frame!.operation)
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

  it.each(['write_file', 'edit_file'])('%s 超过原来的预览边界仍完整传输增量和终态', (name) => {
    const session = new ConversationSurfaceSession('thread-1', 'pero', 'execution-1')
    session.startToolDraft('tool-draft-large')
    const args =
      name === 'write_file'
        ? { file_path: 'src/large.ts', content: 'a'.repeat(300_000) }
        : { file_path: 'src/large.ts', old_text: '旧文', new_text: 'a'.repeat(300_000) }
    const serialized = JSON.stringify(args)
    const split = 260_000
    const first = session.appendToolDraft(
      'tool-draft-large',
      name,
      serialized.slice(0, split),
      split,
    )
    const tail = session.appendToolDraft(
      'tool-draft-large',
      undefined,
      serialized.slice(split),
      serialized.length,
    )
    const ready = session.finalizeToolDraft({
      draftId: 'tool-draft-large',
      callId: 'call-large',
      name,
      args,
    })

    expect(first?.operation.type).toBe('surface.append-tool-arguments')
    if (first?.operation.type !== 'surface.append-tool-arguments') throw new Error('缺少参数增量帧')
    expect(first.operation.argumentsDelta).toBe(serialized.slice(0, split))
    expect(first.operation.previewTruncated).toBe(false)
    expect(tail?.operation).toMatchObject({
      type: 'surface.append-tool-arguments',
      argumentsDelta: serialized.slice(split),
      previewTruncated: false,
    })
    if (ready.operation.type !== 'surface.upsert-node') throw new Error('缺少工具节点')
    const props = ready.operation.node.props as { args: string; previewTruncated: boolean }
    expect(props.args).toBe(serialized)
    expect(props.previewTruncated).toBe(false)
    expect(props.args).toContain('src/large.ts')
    expect(props.args).toContain('a'.repeat(1000))
  })

  it('不同 ReAct 轮次的思考使用独立节点，单轮结束即完成该块', () => {
    const session = new ConversationSurfaceSession('thread-1', 'pero', 'execution-1')
    const first = session.startNativeReasoning('reasoning-1', 'stream', 1)
    const firstDelta = session.appendNativeReasoning('reasoning-1', '第一轮')
    const done = session.completeNativeReasoning('reasoning-1', 100)
    const second = session.startNativeReasoning('reasoning-2', 'stream', 2)
    const secondDelta = session.appendNativeReasoning('reasoning-2', '第二轮')
    expect(done.operation).toMatchObject({
      type: 'surface.patch-node',
      patch: { phase: 'committed', durationMs: 100 },
    })
    if (
      first.operation.type !== 'surface.upsert-node' ||
      second.operation.type !== 'surface.upsert-node'
    )
      throw new Error('缺少思考节点')
    expect(first.operation.node.nodeId).not.toBe(second.operation.node.nodeId)
    expect(firstDelta.operation).toMatchObject({
      nodeId: first.operation.node.nodeId,
      delta: '第一轮',
    })
    expect(secondDelta.operation).toMatchObject({
      nodeId: second.operation.node.nodeId,
      delta: '第二轮',
    })
    expect(second.operation.node.props).toMatchObject({ turn: 2, source: '', phase: 'preview' })
  })

  it('最终Commit应稳定携带流式模式与耗时遥测', () => {
    const session = new ConversationSurfaceSession('thread-1', 'pero', 'execution-1')
    const surface = {
      surfaceId: 'conversation-message:2' as SurfaceId,
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
      principalId: 'pero',
      revision: 1,
      generatedAt: new Date().toISOString(),
      messages: [],
      surfaces: [surface],
    }
    const frame = session.commit(
      snapshot,
      {
        messageId: '2',
        threadId: 'thread-1',
        role: 'assistant',
        content: '回复',
        revision: 1,
        imageTranscription: false,
        status: 'completed',
        timestamp: new Date().toISOString(),
        toolCalls: [],
        attachments: [],
        contentBlocks: [],
      },
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
