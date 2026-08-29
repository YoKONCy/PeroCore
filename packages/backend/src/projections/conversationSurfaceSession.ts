import { randomUUID } from 'node:crypto'
import { ipcPayloadBytes, performanceEventsTotal, performanceLatencySeconds } from '../lib/metrics'
import type {
  SurfaceFrame,
  SurfaceId,
  SurfaceNode,
  SurfaceNodeId,
  ToolCallSurfaceProps,
  ToolResultSurfaceProps,
} from '@infos/shared'

/** 单次 Conversation Execution 的实时 Surface 帧构造器。 */
export class ConversationSurfaceSession {
  readonly surfaceId: SurfaceId
  readonly generation = randomUUID()
  private readonly markdownNodeIds = new Map<string, SurfaceNodeId>()
  private readonly reasoningNodeIds = new Map<string, SurfaceNodeId>()
  private readonly thinkingNodeIds = new Map<string, SurfaceNodeId>()
  private readonly toolDrafts = new Map<string, ToolCallSurfaceProps>()
  private sequence = 0
  private revision = 0
  private readonly toolArgumentPreviewLimit = 2048
  private readonly createdAt = performance.now()
  private firstFrameRecorded = false

  constructor(
    readonly threadId: string,
    readonly principalId: string,
    readonly executionId?: string,
  ) {
    this.surfaceId = `conversation:${threadId}:${executionId ?? this.generation}` as SurfaceId
  }

  open(): SurfaceFrame {
    return this.frame({
      type: 'surface.open',
      threadId: this.threadId,
      principalId: this.principalId,
      nodes: [this.statusNode('thinking')],
    })
  }

  startThinking(blockId: string): SurfaceFrame {
    const nodeId = `${this.surfaceId}:${blockId}` as SurfaceNodeId
    this.thinkingNodeIds.set(blockId, nodeId)
    return this.frame({
      type: 'surface.upsert-node',
      node: this.node(nodeId, 'thinking', 'stable', { source: '', phase: 'preview' }),
    })
  }

  appendThinking(blockId: string, delta: string): SurfaceFrame {
    const nodeId = this.thinkingNodeIds.get(blockId)
    if (!nodeId) throw new Error(`碎碎念块尚未开始: ${blockId}`)
    return this.frame({ type: 'surface.append-text', nodeId, delta })
  }

  completeThinking(blockId: string, durationMs: number): SurfaceFrame {
    const nodeId = this.thinkingNodeIds.get(blockId)
    if (!nodeId) throw new Error(`碎碎念块尚未开始: ${blockId}`)
    return this.frame({
      type: 'surface.patch-node',
      nodeId,
      patch: { phase: 'committed', durationMs },
    })
  }

  startNativeReasoning(blockId: string, mode: 'stream' | 'non_stream'): SurfaceFrame {
    const nodeId = `${this.surfaceId}:${blockId}` as SurfaceNodeId
    this.reasoningNodeIds.set(blockId, nodeId)
    return this.frame({
      type: 'surface.upsert-node',
      node: this.node(nodeId, 'native-reasoning', 'stable', {
        source: '',
        phase: 'preview',
        mode,
      }),
    })
  }

  appendNativeReasoning(blockId: string, delta: string): SurfaceFrame {
    const nodeId = this.reasoningNodeIds.get(blockId)
    if (!nodeId) throw new Error(`原生思考块尚未开始: ${blockId}`)
    return this.frame({ type: 'surface.append-text', nodeId, delta })
  }

  completeNativeReasoning(blockId: string, durationMs: number): SurfaceFrame {
    const nodeId = this.reasoningNodeIds.get(blockId)
    if (!nodeId) throw new Error(`原生思考块尚未开始: ${blockId}`)
    return this.frame({
      type: 'surface.patch-node',
      nodeId,
      patch: { durationMs },
    })
  }

  startNarration(blockId: string): SurfaceFrame {
    const nodeId = `${this.surfaceId}:${blockId}` as SurfaceNodeId
    this.markdownNodeIds.set(blockId, nodeId)
    return this.frame({
      type: 'surface.upsert-node',
      node: this.node(nodeId, 'markdown', 'stable', { source: '', phase: 'preview' }),
    })
  }

  appendText(blockId: string, delta: string): SurfaceFrame {
    const nodeId = this.markdownNodeIds.get(blockId)
    if (!nodeId) throw new Error(`Narration块尚未开始: ${blockId}`)
    return this.frame({ type: 'surface.append-text', nodeId, delta })
  }

  status(
    state: 'thinking' | 'calling' | 'generating' | 'tool_failed' | 'completed',
    message?: string,
    telemetry?: Pick<
      import('@infos/shared').StatusSurfaceProps,
      'mode' | 'firstTokenMs' | 'outputDurationMs' | 'totalDurationMs'
    >,
  ) {
    return this.frame({
      type: 'surface.upsert-node',
      node: this.statusNode(state, message, telemetry),
    })
  }

  startToolDraft(draftId: string): SurfaceFrame {
    const nodeId = `${this.surfaceId}:tool:${draftId}` as SurfaceNodeId
    const props: ToolCallSurfaceProps = {
      callId: draftId,
      draftId,
      name: '',
      args: '',
      argsPreview: '',
      receivedChars: 0,
      state: 'assembling',
    }
    this.toolDrafts.set(draftId, props)
    return this.frame({
      type: 'surface.upsert-node',
      node: this.node<ToolCallSurfaceProps>(nodeId, 'tool-call', 'interactive', props),
    })
  }

  appendToolDraft(
    draftId: string,
    nameDelta?: string,
    argumentsDelta?: string,
    receivedChars?: number,
  ): SurfaceFrame | null {
    const nodeId = `${this.surfaceId}:tool:${draftId}` as SurfaceNodeId
    const current = this.toolDrafts.get(draftId)
    if (!current) throw new Error(`工具草稿尚未开始: ${draftId}`)
    const nextArgs = current.args + (argumentsDelta ?? '')
    const argsPreview = nextArgs.slice(0, this.toolArgumentPreviewLimit)
    const props: ToolCallSurfaceProps = {
      ...current,
      name: current.name + (nameDelta ?? ''),
      args: argsPreview,
      argsPreview,
      receivedChars: receivedChars ?? current.receivedChars,
    }
    this.toolDrafts.set(draftId, props)
    const nameChanged = props.name !== current.name
    const previewChanged = props.argsPreview !== current.argsPreview
    const previousChars = current.receivedChars ?? 0
    const nextChars = props.receivedChars ?? previousChars
    const progressChanged = Math.floor(previousChars / 4096) !== Math.floor(nextChars / 4096)
    if (!nameChanged && !previewChanged && !progressChanged) return null
    return this.frame({
      type: 'surface.upsert-node',
      node: this.node<ToolCallSurfaceProps>(nodeId, 'tool-call', 'interactive', props),
    })
  }

  finalizeToolDraft(input: {
    draftId: string
    callId: string
    name: string
    args: unknown
  }): SurfaceFrame {
    const nodeId = `${this.surfaceId}:tool:${input.draftId}` as SurfaceNodeId
    const props: ToolCallSurfaceProps = {
      ...(this.toolDrafts.get(input.draftId) ?? {
        draftId: input.draftId,
        argsPreview: '',
        receivedChars: 0,
      }),
      callId: input.callId,
      name: input.name,
      args: this.toolArgsPreview(input.args),
      state: 'calling',
    }
    this.toolDrafts.set(input.draftId, props)
    return this.frame({
      type: 'surface.upsert-node',
      node: this.node<ToolCallSurfaceProps>(nodeId, 'tool-call', 'interactive', props),
    })
  }

  toolCall(input: { callId: string; name: string; args: unknown }): SurfaceFrame {
    const nodeId = `${this.surfaceId}:tool:${input.callId}` as SurfaceNodeId
    return this.frame({
      type: 'surface.upsert-node',
      node: this.node<ToolCallSurfaceProps>(nodeId, 'tool-call', 'interactive', {
        callId: input.callId,
        name: input.name,
        args: this.toolArgsPreview(input.args),
        state: 'calling',
      }),
    })
  }

  toolResult(input: {
    callId: string
    result: string
    isError: boolean
    durationMs?: number
  }): SurfaceFrame[] {
    return [
      this.frame({
        type: 'surface.upsert-node',
        node: this.node<ToolResultSurfaceProps>(
          `${this.surfaceId}:tool-result:${input.callId}` as SurfaceNodeId,
          'tool-result',
          'stable',
          input,
        ),
      }),
    ]
  }

  commit(
    snapshot: import('@infos/shared').ConversationProjectionSnapshot,
    message: import('@infos/shared').ConversationMessageProjection,
    surface: import('@infos/shared').ConversationSurfaceDescriptor,
    telemetry?: Pick<
      import('@infos/shared').StatusSurfaceProps,
      'mode' | 'firstTokenMs' | 'outputDurationMs' | 'totalDurationMs'
    >,
  ): SurfaceFrame {
    const committedSurface = telemetry
      ? {
          ...surface,
          nodes: [...surface.nodes, this.statusNode('completed', '输出完成', telemetry)],
        }
      : surface
    const committedSnapshot = telemetry
      ? {
          ...snapshot,
          surfaces: snapshot.surfaces.map((item) =>
            item.surfaceId === surface.surfaceId ? committedSurface : item,
          ),
        }
      : snapshot
    return this.frame({
      type: 'surface.commit',
      snapshot: committedSnapshot,
      message,
      surface: committedSurface,
    })
  }

  fail(code: string, message: string, content?: string): SurfaceFrame {
    return this.frame({ type: 'surface.fail', code, message, content })
  }

  private toolArgsPreview(args: unknown): string {
    if (!args || typeof args !== 'object') {
      return String(args ?? '').slice(0, this.toolArgumentPreviewLimit)
    }
    const record = args as Record<string, unknown>
    const preview: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (['content', 'new_text', 'old_text'].includes(key) && typeof value === 'string') {
        preview[key] = `[正文 ${value.length} 字符]`
      } else if (typeof value === 'string' && value.length > 512) {
        preview[key] = `${value.slice(0, 512)}…[共 ${value.length} 字符]`
      } else {
        preview[key] = value
      }
    }
    return JSON.stringify(preview).slice(0, this.toolArgumentPreviewLimit)
  }

  private statusNode(
    state: import('@infos/shared').StatusSurfaceProps['state'],
    message?: string,
    telemetry?: Pick<
      import('@infos/shared').StatusSurfaceProps,
      'mode' | 'firstTokenMs' | 'outputDurationMs' | 'totalDurationMs'
    >,
  ): SurfaceNode {
    return this.node(`${this.surfaceId}:status` as SurfaceNodeId, 'status', 'transient', {
      state,
      message,
      ...telemetry,
    })
  }

  private node<T extends object>(
    nodeId: SurfaceNodeId,
    kind: SurfaceNode['kind'],
    lifecycle: SurfaceNode['lifecycle'],
    props: T,
  ): SurfaceNode<T> {
    return { nodeId, kind, lifecycle, revision: ++this.revision, props }
  }

  private frame(operation: SurfaceFrame['operation']): SurfaceFrame {
    const frame: SurfaceFrame = {
      protocolVersion: 1,
      surfaceId: this.surfaceId,
      generation: this.generation,
      revision: ++this.revision,
      sequence: ++this.sequence,
      executionId: this.executionId,
      operationId: randomUUID(),
      operation,
    }
    if (!this.firstFrameRecorded) {
      this.firstFrameRecorded = true
      performanceLatencySeconds.observe(
        { metric: 'surface_first_frame', provider: 'conversation' },
        (performance.now() - this.createdAt) / 1000,
      )
    }
    performanceEventsTotal.inc({ metric: 'surface_frame', outcome: operation.type })
    ipcPayloadBytes.observe(
      { carrier: 'surface', direction: 'outbound' },
      Buffer.byteLength(JSON.stringify(frame)),
    )
    return frame
  }
}
