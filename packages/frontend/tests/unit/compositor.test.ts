import { describe, expect, it } from 'vitest'
import type { SurfaceFrame, SurfaceId, SurfaceNodeId } from '@infos/shared'
import { createPinia, setActivePinia } from 'pinia'
import { useCompositorStore } from '@infos/frontend/stores/useCompositorStore'
import { segmentStreamMarkdown } from '@infos/frontend/compositor/markdownSegmentation'

function frame(
  sequence: number,
  operation: SurfaceFrame['operation'],
  generation = 'g1',
): SurfaceFrame {
  return {
    protocolVersion: 1,
    surfaceId: 'surface-1' as SurfaceId,
    generation,
    revision: sequence,
    sequence,
    operationId: `operation-${generation}-${sequence}`,
    operation,
  }
}

describe('Internal Compositor', () => {
  it('页面切换清理Scope时应保留运行中的流式Surface', () => {
    setActivePinia(createPinia())
    const store = useCompositorStore()
    store.replaceScope('conversation:thread-1', [
      {
        surfaceId: 'open-surface' as SurfaceId,
        generation: 'open-generation',
        threadId: 'thread-1',
        principalId: 'pero',
        revision: 1,
        sequence: 1,
        state: 'open',
        nodes: [],
      },
      {
        surfaceId: 'committed-surface' as SurfaceId,
        generation: 'message-generation',
        messageId: '42',
        threadId: 'thread-1',
        principalId: 'pero',
        revision: 1,
        sequence: 0,
        state: 'committed',
        nodes: [],
      },
    ])

    store.disposeScope('conversation:thread-1')

    expect(store.get('open-surface')?.state).toBe('open')
    expect(store.get('committed-surface')).toBeUndefined()
  })

  it('应当合并文本帧并以最终提交替换预览内容', () => {
    setActivePinia(createPinia())
    const store = useCompositorStore()
    store.enqueue(frame(1, { type: 'surface.open', threadId: 'thread-1', principalId: 'pero' }))
    store.enqueue(
      frame(2, {
        type: 'surface.append-text',
        nodeId: 'markdown' as SurfaceNodeId,
        delta: '你',
      }),
    )
    store.enqueue(
      frame(3, {
        type: 'surface.append-text',
        nodeId: 'markdown' as SurfaceNodeId,
        delta: '好',
      }),
    )
    store.flush()

    expect(store.get('surface-1')?.nodes[0]?.props).toEqual({ source: '你好', phase: 'preview' })

    const committedSurface = {
      surfaceId: 'conversation-message:42' as SurfaceId,
      generation: 'message:42:revision:1',
      messageId: '42',
      threadId: 'thread-1',
      principalId: 'pero',
      revision: 1,
      sequence: 0,
      state: 'committed' as const,
      nodes: [
        {
          nodeId: 'conversation-message:42:markdown' as SurfaceNodeId,
          kind: 'markdown' as const,
          lifecycle: 'stable' as const,
          revision: 1,
          props: { source: '你好！', phase: 'committed' },
        },
      ],
    }
    const message = {
      messageId: '42',
      threadId: 'thread-1',
      role: 'assistant' as const,
      content: '你好！',
      revision: 1,
      imageTranscription: false,
      status: 'completed',
      timestamp: '2026-08-18T00:00:00.000Z',
      toolCalls: [],
      attachments: [],
    }
    store.enqueue(
      frame(4, {
        type: 'surface.commit',
        snapshot: {
          protocolVersion: 1,
          threadId: 'thread-1',
          principalId: 'pero',
          revision: 1,
          generatedAt: '2026-08-18T00:00:00.000Z',
          messages: [message],
          surfaces: [committedSurface],
        },
        message,
        surface: committedSurface,
      }),
    )
    store.flush()
    expect(store.get('surface-1')).toBeUndefined()
    expect(store.get('conversation-message:42')).toMatchObject({ state: 'committed' })
    expect(store.get('conversation-message:42')?.nodes[0]?.props).toEqual({
      source: '你好！',
      phase: 'committed',
    })
  })

  it('本地用户消息应在流式回复期间立即携带附件节点', () => {
    setActivePinia(createPinia())
    const store = useCompositorStore()

    const surfaceId = store.installLocalMessage({
      localId: 'local-user-1',
      threadId: 'thread-1',
      principalId: 'pero',
      content: '看看这张图',
      attachments: [
        {
          id: 'attachment-1',
          threadId: 'thread-1',
          messageId: null,
          kind: 'image',
          originalName: 'screen.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
          contextPolicy: 'once',
          status: 'uploaded',
        },
      ],
    })

    expect(store.get(surfaceId)?.nodes).toEqual([
      expect.objectContaining({
        kind: 'attachment',
        props: {
          id: 'attachment-1',
          kind: 'image',
          name: 'screen.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
        },
      }),
      expect.objectContaining({
        kind: 'markdown',
        props: { source: '看看这张图', phase: 'committed' },
      }),
    ])
  })

  it('用户终止时只将思考状态迁移为已终止并冻结Surface', () => {
    setActivePinia(createPinia())
    const store = useCompositorStore()
    store.install({
      surfaceId: 'thinking-surface' as SurfaceId,
      generation: 'g-thinking',
      threadId: 'thread-1',
      principalId: 'pero',
      revision: 1,
      sequence: 1,
      state: 'open',
      nodes: [
        {
          nodeId: 'thinking-status' as SurfaceNodeId,
          kind: 'status',
          lifecycle: 'transient',
          revision: 1,
          props: { state: 'thinking', message: '正在思考...' },
        },
      ],
    })

    store.terminateThinking('thinking-surface')

    expect(store.get('thinking-surface')).toMatchObject({
      state: 'committed',
      suspended: true,
    })
    expect(store.get('thinking-surface')?.nodes[0]?.props).toEqual({
      state: 'cancelled',
      message: '已终止',
    })
  })

  it('终止操作不应改写已经进入生成阶段的状态', () => {
    setActivePinia(createPinia())
    const store = useCompositorStore()
    store.install({
      surfaceId: 'generating-surface' as SurfaceId,
      generation: 'g-generating',
      threadId: 'thread-1',
      principalId: 'pero',
      revision: 1,
      sequence: 1,
      state: 'open',
      nodes: [
        {
          nodeId: 'generating-status' as SurfaceNodeId,
          kind: 'status',
          lifecycle: 'transient',
          revision: 1,
          props: { state: 'generating', message: '正在流式输出' },
        },
      ],
    })

    store.terminateThinking('generating-surface')

    expect(store.get('generating-surface')?.nodes[0]?.props).toEqual({
      state: 'generating',
      message: '正在流式输出',
    })
  })

  it('应当拒绝旧序号、旧代次和重复操作', () => {
    setActivePinia(createPinia())
    const store = useCompositorStore()
    store.enqueue(frame(1, { type: 'surface.open', threadId: 'thread-1', principalId: 'pero' }))
    store.enqueue(
      frame(2, { type: 'surface.append-text', nodeId: 'markdown' as SurfaceNodeId, delta: 'A' }),
    )
    store.flush()

    store.enqueue(
      frame(2, { type: 'surface.append-text', nodeId: 'markdown' as SurfaceNodeId, delta: 'B' }),
    )
    store.enqueue(
      frame(
        3,
        { type: 'surface.append-text', nodeId: 'markdown' as SurfaceNodeId, delta: 'C' },
        'old',
      ),
    )
    store.flush()
    expect(store.get('surface-1')?.nodes[0]?.props).toEqual({ source: 'A', phase: 'preview' })
  })

  it('应按领域 Scope 原子替换、暂停和销毁 Surface', () => {
    setActivePinia(createPinia())
    const store = useCompositorStore()
    const descriptor = (surfaceId: string, threadId: string) => ({
      surfaceId: surfaceId as SurfaceId,
      generation: surfaceId,
      threadId,
      principalId: 'pero',
      revision: 1,
      sequence: 0,
      state: 'committed' as const,
      nodes: [],
    })

    store.replaceScope('conversation:t1', [descriptor('message-1', 't1')])
    store.replaceScope('stronghold:r1', [descriptor('stronghold-1', 'stronghold:r1')])
    store.setSuspended('message-1', true)
    expect(store.get('message-1')?.suspended).toBe(true)

    store.replaceScope('conversation:t1', [descriptor('message-2', 't1')])
    expect(store.get('message-1')).toBeUndefined()
    expect(store.get('message-2')).toBeDefined()
    expect(store.get('stronghold-1')).toBeDefined()

    store.disposeScope('conversation:t1')
    expect(store.get('message-2')).toBeUndefined()
    expect(store.get('stronghold-1')).toBeDefined()
  })

  it('多窗口应共享同一Surface Authority并独立管理视图与Seat', () => {
    setActivePinia(createPinia())
    const store = useCompositorStore()
    store.registerWindow({
      windowId: 'window-a',
      nodeId: 'node-a',
      sessionId: 'session-a',
      principalId: 'pero',
      state: 'open',
    })
    store.registerWindow({
      windowId: 'window-b',
      nodeId: 'node-a',
      sessionId: 'session-a',
      principalId: 'pero',
      state: 'open',
    })
    store.replaceScope('conversation:t1', [
      {
        surfaceId: 'message-1' as SurfaceId,
        generation: 'g1',
        threadId: 't1',
        principalId: 'pero',
        revision: 1,
        sequence: 0,
        state: 'committed',
        nodes: [],
      },
    ])
    store.bindScopeToWindow('conversation:t1', 'window-a')
    store.bindScopeToWindow('conversation:t1', 'window-b')
    expect(store.surfacesForWindow('window-a')[0]).toBe(store.surfacesForWindow('window-b')[0])
    store.installInputSeat({
      seatId: 'seat-1',
      sessionId: 'session-a',
      principalId: 'pero',
      windowId: 'window-a',
      epoch: 1,
      capabilities: ['input'],
    })
    expect(store.requireInputSeat('window-a', 'input')).toMatchObject({ seatId: 'seat-1' })
    expect(() => store.requireInputSeat('window-b', 'input')).toThrow(
      'COMPOSITOR_INPUT_SEAT_REQUIRED',
    )
    store.closeWindow('window-a')
    expect(store.get('message-1')).toBeDefined()
    expect(store.surfacesForWindow('window-a')).toEqual([])
    expect(store.surfacesForWindow('window-b')).toHaveLength(1)
    expect(() => store.requireInputSeat('window-a', 'input')).toThrow(
      'COMPOSITOR_INPUT_SEAT_REQUIRED',
    )
  })

  it('新Seat应原子替换同一Principal旧Seat并校验窗口身份', () => {
    setActivePinia(createPinia())
    const store = useCompositorStore()
    store.registerWindow({
      windowId: 'window-a',
      nodeId: 'node-a',
      sessionId: 'session-a',
      principalId: 'pero',
      state: 'open',
    })
    store.installInputSeat({
      seatId: 'seat-1',
      sessionId: 'session-a',
      principalId: 'pero',
      windowId: 'window-a',
      epoch: 1,
      capabilities: ['input'],
    })
    store.installInputSeat({
      seatId: 'seat-2',
      sessionId: 'session-a',
      principalId: 'pero',
      windowId: 'window-a',
      epoch: 2,
      capabilities: ['input'],
    })
    expect([...store.inputSeats.values()]).toEqual([expect.objectContaining({ seatId: 'seat-2' })])
    expect(() =>
      store.installInputSeat({
        seatId: 'invalid',
        sessionId: 'other-session',
        principalId: 'pero',
        windowId: 'window-a',
        epoch: 3,
        capabilities: ['input'],
      }),
    ).toThrow('COMPOSITOR_INPUT_SEAT_IDENTITY_MISMATCH')
  })

  it('应当只把闭合且稳定的 Mermaid 块升级为重型节点', () => {
    const source = '说明\n\n```mermaid\ngraph TD\nA-->B\n```\n\n结尾'
    const preview = segmentStreamMarkdown(source, 'markdown' as SurfaceNodeId)
    expect(preview.some((block) => block.kind === 'mermaid')).toBe(true)
    expect(preview.at(-1)?.stable).toBe(false)
    expect(preview.at(-1)?.source.trim()).toBe('结尾')

    const committed = segmentStreamMarkdown(source, 'markdown' as SurfaceNodeId, true)
    expect(committed.every((block) => block.stable)).toBe(true)
  })
})
