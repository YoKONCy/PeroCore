import type {
  ConversationMessageProjection,
  ConversationProjectionSnapshot,
  KernelEventEnvelope,
} from '@infos/shared'
import type { ThreadService } from '../services/thread/threadService'
import type { ApprovalService } from '../services/execution/approvalService'
import type { AgentInputService } from '../services/execution/agentInputService'
import type { AttachmentService } from '../services/attachment/attachmentService'

import { ConversationSurfaceProjector } from './conversationSurfaceProjector'

interface CachedProjection {
  snapshot: ConversationProjectionSnapshot
  dirty: boolean
}

/**
 * Conversation 的可重建读模型。
 *
 * 权威数据仍来自 Thread/Attachment 领域表；Outbox 事件只负责使缓存失效。
 */
export class ConversationProjectionService {
  private readonly cache = new Map<string, CachedProjection>()
  private readonly processedEvents = new Set<string>()
  private readonly surfaceProjector = new ConversationSurfaceProjector()

  constructor(
    private readonly threadService: ThreadService,
    private readonly attachmentService: AttachmentService,
    private readonly approvalService?: ApprovalService,
    private readonly agentInputService?: AgentInputService,
  ) {}

  consume(event: KernelEventEnvelope<string, unknown>): void {
    if (this.processedEvents.has(event.eventId)) return
    this.processedEvents.add(event.eventId)
    if (this.processedEvents.size > 10_000)
      this.processedEvents.delete(this.processedEvents.values().next().value!)
    if (event.type !== 'conversation.message.committed') return
    const payload = event.payload as { threadId?: string }
    if (!payload.threadId) return
    const cached = this.cache.get(payload.threadId)
    if (cached) cached.dirty = true
  }

  async getSnapshot(
    threadId: string,
    options: { beforeCursor?: string; pageSize?: number } = {},
  ): Promise<ConversationProjectionSnapshot> {
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 60))
    const beforeMessageId = options.beforeCursor ? Number(options.beforeCursor) : undefined
    const useCache = beforeMessageId === undefined && pageSize === 60
    const cached = useCache ? this.cache.get(threadId) : undefined
    if (cached && !cached.dirty) return cached.snapshot

    const thread = await this.threadService.getThread(threadId)
    if (!thread) throw new Error(`Conversation Projection 找不到 Thread: ${threadId}`)
    const result = await this.threadService.listMessages({
      threadId,
      beforeMessageId: Number.isSafeInteger(beforeMessageId) ? beforeMessageId : undefined,
      pageSize,
    })
    const ordered = [...result.items].reverse()
    const attachments = await this.attachmentService.listForMessages(
      ordered.map((message) => message.id),
    )
    const messages = ordered.map<ConversationMessageProjection>((message) => ({
      messageId: String(message.id),
      threadId: message.threadId,
      role: message.role,
      content: message.content,
      rawContent: message.rawContent,
      pairId: message.pairId,
      senderId: message.senderId,
      agentId: message.agentId,
      revision: message.revision,
      imageTranscription: this.isImageTranscription(message.metadataJson),
      status: message.status,
      failureMessage: this.parseFailureMessage(message.metadataJson),
      timestamp: message.timestamp,
      outputTokens: this.parseOutputTokens(message.metadataJson),
      contentBlocks: this.parseContentBlocks(message.metadataJson),
      toolCalls: this.parseToolCalls(message.metadataJson),
      attachments: (attachments.get(message.id) ?? []).map((item) => ({
        id: item.id,
        kind: item.kind,
        name: item.originalName,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
      })),
    }))
    const surfaces = messages.map((message) =>
      this.surfaceProjector.projectMessage(message, message.agentId ?? thread.agentId),
    )
    const approvals = (this.approvalService?.list({ status: 'pending' }) ?? []).filter(
      (approval) => approval.threadId === threadId && !approval.taskId,
    )
    for (const approval of approvals) {
      surfaces.push({
        surfaceId: `conversation-approval:${approval.id}` as import('@infos/shared').SurfaceId,
        generation: `conversation-approval:${approval.id}`,
        threadId,
        principalId: approval.agentId,
        revision: 1,
        sequence: 0,
        state: 'committed',
        nodes: [
          {
            nodeId:
              `conversation-approval:${approval.id}:approval` as import('@infos/shared').SurfaceNodeId,
            kind: 'approval',
            lifecycle: 'interactive',
            revision: 1,
            props: {
              approvalId: approval.id,
              principalId: approval.agentId,
              threadId,
              toolName: approval.toolName,
              title: approval.reason,
              summary: approval.argsSummary,
              riskLevel: approval.riskLevel,
            },
          },
        ],
      })
    }
    for (const input of this.agentInputService?.list({ status: 'pending', threadId }) ?? []) {
      if (input.taskId) continue
      surfaces.push({
        surfaceId: `conversation-input:${input.id}` as import('@infos/shared').SurfaceId,
        generation: `conversation-input:${input.id}`,
        threadId,
        principalId: input.agentId,
        revision: 1,
        sequence: 0,
        state: 'committed',
        nodes: [
          {
            nodeId: `conversation-input:${input.id}:input` as import('@infos/shared').SurfaceNodeId,
            kind: 'input',
            lifecycle: 'interactive',
            revision: 1,
            props: {
              inputId: input.id,
              inputKind: 'agent_question',
              principalId: input.agentId,
              title: '想问问你',
              question: input.question,
              context: input.context ? { message: input.context } : null,
              options: input.options,
              allowFreeText: input.allowFreeText,
              required: input.required,
              actions: input.required
                ? [{ id: 'answer', label: '回答并继续', tone: 'primary' }]
                : [
                    { id: 'skip', label: '暂时跳过', tone: 'neutral' },
                    { id: 'answer', label: '回答并继续', tone: 'primary' },
                  ],
            },
          },
        ],
      })
    }
    const snapshot: ConversationProjectionSnapshot = {
      protocolVersion: 1,
      threadId,
      principalId: thread.agentId,
      revision: messages.reduce(
        (revision, message) => revision + Number(message.messageId || 0),
        result.total,
      ),
      generatedAt: new Date().toISOString(),
      messages,
      surfaces,
      totalMessages: result.total,
      pageSize,
      hasMoreBefore: result.hasMoreBefore,
      beforeCursor: messages[0]?.messageId,
    }
    if (useCache) this.cache.set(threadId, { snapshot, dirty: false })
    return snapshot
  }

  invalidate(threadId: string): void {
    const cached = this.cache.get(threadId)
    if (cached) cached.dirty = true
  }

  private isImageTranscription(metadataJson: string): boolean {
    try {
      return (JSON.parse(metadataJson) as { kind?: string }).kind === 'image_transcription'
    } catch {
      return false
    }
  }

  private parseFailureMessage(metadataJson: string): string | undefined {
    try {
      const parsed = JSON.parse(metadataJson) as { failure?: { message?: unknown } }
      return typeof parsed.failure?.message === 'string' ? parsed.failure.message : undefined
    } catch {
      return undefined
    }
  }

  private parseOutputTokens(metadataJson: string): number | undefined {
    try {
      const parsed = JSON.parse(metadataJson) as { tokenUsage?: { outputTokens?: unknown } }
      const value = parsed.tokenUsage?.outputTokens
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined
    } catch {
      return undefined
    }
  }

  private parseContentBlocks(metadataJson: string): ConversationMessageProjection['contentBlocks'] {
    try {
      const parsed = JSON.parse(metadataJson) as { contentBlocks?: unknown }
      if (!Array.isArray(parsed.contentBlocks)) return []
      const blocks: ConversationMessageProjection['contentBlocks'] = []
      for (const value of parsed.contentBlocks) {
        if (!value || typeof value !== 'object') continue
        const item = value as Record<string, unknown>
        const blockId = typeof item.blockId === 'string' ? item.blockId : ''
        const sequence = typeof item.sequence === 'number' ? item.sequence : 0
        const turn = typeof item.turn === 'number' ? item.turn : 0
        if (!blockId) continue
        if (item.kind === 'native_reasoning' && typeof item.content === 'string') {
          blocks.push({
            blockId,
            sequence,
            turn,
            kind: 'native_reasoning',
            content: item.content,
            mode: item.mode === 'non_stream' ? 'non_stream' : 'stream',
            durationMs: typeof item.durationMs === 'number' ? item.durationMs : undefined,
          })
          continue
        }
        if (item.kind === 'narration' && typeof item.content === 'string') {
          blocks.push({
            blockId,
            sequence,
            turn,
            kind: 'narration',
            phase: item.phase === 'progress' ? 'progress' : 'final',
            content: item.content,
          })
          continue
        }
        if (
          item.kind !== 'tool' ||
          typeof item.callId !== 'string' ||
          typeof item.name !== 'string'
        )
          continue
        blocks.push({
          blockId,
          sequence,
          turn,
          kind: 'tool',
          callId: item.callId,
          name: item.name,
          args: typeof item.args === 'string' ? item.args : JSON.stringify(item.args ?? {}),
          result: typeof item.result === 'string' ? item.result : undefined,
          isError: typeof item.isError === 'boolean' ? item.isError : undefined,
          durationMs: typeof item.durationMs === 'number' ? item.durationMs : undefined,
        })
      }
      return blocks.sort((left, right) => left.sequence - right.sequence)
    } catch {
      return []
    }
  }

  private parseToolCalls(metadataJson: string): ConversationMessageProjection['toolCalls'] {
    try {
      const parsed = JSON.parse(metadataJson) as { toolCalls?: Array<Record<string, unknown>> }
      if (!Array.isArray(parsed.toolCalls)) return []
      return parsed.toolCalls
        .filter((item) => typeof item.name === 'string')
        .map((item) => ({
          callId: typeof item.callId === 'string' ? item.callId : undefined,
          name: item.name as string,
          args: typeof item.args === 'string' ? item.args : JSON.stringify(item.args ?? {}),
          result: typeof item.result === 'string' ? item.result : undefined,
          isError: typeof item.isError === 'boolean' ? item.isError : undefined,
          durationMs: typeof item.durationMs === 'number' ? item.durationMs : undefined,
        }))
    } catch {
      return []
    }
  }
}
