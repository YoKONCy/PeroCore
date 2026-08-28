/**
 * Thread Service — 交互线程业务逻辑
 *
 * Thread 是主 Agent 与用户（或外部平台）的一次交互线程。
 * channel 是 Thread 的持久属性，创建时确定，不可变。
 *
 * 职责：
 * - 创建/查询/列表 Thread
 * - 追加消息（用户消息 + Agent 回复）
 * - 软删除消息 / 删除对话对
 * - 查询活跃消息（供 Context Compiler 使用）
 * - 摘要管理
 *
 * 不负责：
 * - 上下文编译（由 ContextCompiler 负责）
 * - 消息内容生成（由 AgentService + ReAct 负责）
 * - 长期记忆（由 MemoryService 负责）
 *
 * @module packages/backend/src/services/thread/threadService
 */

import type { KernelExecutionDescriptor } from '@infos/shared'
import type { ThreadRepository } from '../../repositories/thread.repo'
import { type ThreadChannel, type ThreadPurpose } from '../../repositories/thread.repo'
import type { AttachmentRepository } from '../../repositories/attachment.repo'
import type {
  WorkspaceCheckpointService,
  RewindPreview,
} from '../workspace/workspaceCheckpointService'
import { createLogger } from '../../lib/logger'
import { AppError } from '../../lib/appError'

const logger = createLogger('ThreadService')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** Thread 信息（返回给前端） */
export interface ThreadInfo {
  id: string
  agentId: string
  channel: ThreadChannel
  platform?: string
  platformIdentifier?: string
  title: string
  messageCount: number
  pairCount: number
  lastMessageAt: string | null
  status: string
  /**
   * ContextPolicy（JSON 序列化的 ChannelPolicy 字符串）
   * null 表示使用 DEFAULT_POLICIES 中该 channel 的默认策略
   */
  contextPolicy: string | null
  /** 当前 Thread 明确禁用的工具名；仅作为 Channel 白名单的减法层。 */
  disabledTools: string[]
  /** 是否跳过普通工具的审批请求。 */
  autoExecuteTools: boolean
  /** M05: Thread 用途（conversation / background_task / companion） */
  purpose: string
  createdAt: string
  updatedAt: string
}

/** Thread 消息（返回给前端） */
export interface ThreadMessageInfo {
  id: number
  threadId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  rawContent: string | null
  pairId: string | null
  senderId: string | null
  agentId: string | null
  revision: number
  metadataJson: string
  timestamp: string
  status: string
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export interface ThreadCoverageInvalidator {
  invalidatePairs(threadId: string, pairIds: string[]): Promise<void>
  invalidateThread(threadId: string): Promise<void>
}

export class ThreadService {
  constructor(
    private threadRepo: ThreadRepository,
    private attachmentRepo?: AttachmentRepository,
    private checkpointService?: WorkspaceCheckpointService,
    private coverageInvalidator?: ThreadCoverageInvalidator,
  ) {}

  /** 创建新 Thread */
  async createThread(params: {
    agentId: string
    channel: ThreadChannel
    platform?: string
    platformIdentifier?: string
    title?: string
    /** 可选自定义 Thread ID（如语音场景复用 sessionId） */
    id?: string
    /**
     * 可选 ContextPolicy（JSON 序列化的 ChannelPolicy 字符串）
     * 不传则使用 DEFAULT_POLICIES 默认策略
     */
    contextPolicy?: string | null
    /** Thread 用途，默认 conversation；后台任务传 background_task */
    purpose?: ThreadPurpose
  }): Promise<ThreadInfo> {
    const id = params.id ?? `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const row = await this.threadRepo.createThread({
      id,
      agentId: params.agentId,
      channel: params.channel,
      platform: params.platform,
      platformIdentifier: params.platformIdentifier,
      title: params.title,
      contextPolicy: params.contextPolicy ?? null,
      purpose: params.purpose,
    })
    logger.info(`Thread 已创建: id=${id}, agent=${params.agentId}, channel=${params.channel}`)
    return this.toThreadInfo(row)
  }

  /**
   * 更新 Thread 的 ContextPolicy
   *
   * @param threadId       Thread ID
   * @param contextPolicy  JSON 序列化的 ChannelPolicy 字符串；null 表示恢复默认策略
   */
  async updateContextPolicy(threadId: string, contextPolicy: string | null): Promise<boolean> {
    const success = await this.threadRepo.updateContextPolicy(threadId, contextPolicy)
    if (success) {
      logger.info(
        `Thread ContextPolicy 已更新: thread=${threadId}, ${contextPolicy ? '自定义' : '默认'}`,
      )
    }
    return success
  }

  /** 持久化 Thread 禁用工具列表；调用方必须先完成 Channel 白名单校验。 */
  async updateDisabledTools(threadId: string, disabledTools: string[]): Promise<void> {
    const unique = [...new Set(disabledTools)].sort()
    const success = await this.threadRepo.updateDisabledTools(threadId, JSON.stringify(unique))
    if (!success) throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
  }

  async updateAutoExecuteTools(threadId: string, autoExecuteTools: boolean): Promise<void> {
    const success = await this.threadRepo.updateAutoExecuteTools(threadId, autoExecuteTools)
    if (!success) throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
  }

  /** 获取或创建 Agent 的最新 Thread */
  async getOrCreateLatest(
    agentId: string,
    channel: ThreadChannel = 'desktop',
    purpose: import('../../repositories/thread.repo').ThreadPurpose = 'conversation',
  ): Promise<ThreadInfo> {
    const row = await this.threadRepo.getOrCreateLatestThread(agentId, channel, purpose)
    return this.toThreadInfo(row)
  }

  /** 获取 Thread 详情 */
  async getThread(threadId: string): Promise<ThreadInfo | null> {
    const row = await this.threadRepo.getThread(threadId)
    return row ? this.toThreadInfo(row) : null
  }

  /** 查询 Thread 列表；agentIds 用于“全部角色”时排除已不存在的孤儿角色数据。 */
  async listThreads(params: {
    agentId?: string
    agentIds?: string[]
    channel?: string
    /** 排除独立应用内部使用的 Channel。 */
    excludeChannels?: string[]
    /** M05: 按用途过滤；不传时返回全部用途 */
    purpose?: import('../../repositories/thread.repo').ThreadPurpose
    page?: number
    pageSize?: number
  }): Promise<{ items: ThreadInfo[]; total: number }> {
    const result = await this.threadRepo.listThreads(params)
    return {
      items: result.items.map((r) => this.toThreadInfo(r)),
      total: result.total,
    }
  }

  /**
   * 追加用户消息
   *
   * 用户消息写入后返回消息信息，供后续 LLM 调用使用。
   * 若 Thread 标题为空（首次对话），自动用消息内容前 20 字作为标题。
   *
   * @param pairId 可选，对话对 ID。传入时会写入消息记录，
   *   使得用户消息与后续 Agent 回复通过相同 pairId 关联，
   *   便于对话对级联删除（softDeletePair）。
   */
  async appendUserMessage(
    threadId: string,
    content: string,
    pairId?: string,
    metadataJson?: string,
    execution?: KernelExecutionDescriptor,
  ): Promise<ThreadMessageInfo> {
    const row = await this.threadRepo.appendMessage({
      threadId,
      role: 'user',
      content,
      pairId,
      metadataJson,
      execution,
    })

    // 用户消息同样计入消息总数，保持与 syncThreadStats 的统计口径一致
    await this.threadRepo.updateMessageCount(threadId, 0)

    // 首次对话自动设置标题：取消息内容前 20 字（去除换行）
    const thread = await this.threadRepo.getThread(threadId)
    if (thread && !thread.title) {
      const titleText = content.replace(/\n/g, ' ').trim()
      const title = titleText.length > 20 ? `${titleText.slice(0, 20)}...` : titleText
      if (title) {
        await this.threadRepo.updateTitle(threadId, title)
      }
    }

    logger.debug(`用户消息已追加: thread=${threadId}, msgId=${row.id}`)
    return this.toMessageInfo(row)
  }

  /**
   * 追加 Agent 回复
   *
   * Agent 回复写入后更新 Thread 的消息计数。
   */
  async appendAssistantMessage(params: {
    threadId: string
    content: string
    rawContent?: string
    pairId: string
    agentId: string
    metadataJson?: string
    scorerStatus?: 'pending' | 'analyzed' | 'failed' | 'skipped'
    status?: 'active' | 'failed' | 'interrupted'
    execution?: KernelExecutionDescriptor
  }): Promise<ThreadMessageInfo> {
    const row = await this.threadRepo.appendMessage({
      threadId: params.threadId,
      role: 'assistant',
      content: params.content,
      rawContent: params.rawContent,
      pairId: params.pairId,
      agentId: params.agentId,
      metadataJson: params.metadataJson,
      scorerStatus: params.scorerStatus,
      status: params.status,
      execution: params.execution,
    })

    // 更新 Thread 计数
    await this.threadRepo.updateMessageCount(params.threadId, 1)

    logger.debug(`Agent 回复已追加: thread=${params.threadId}, msgId=${row.id}`)
    return this.toMessageInfo(row)
  }

  /** 追加系统消息并更新 Thread 消息计数 */
  async appendSystemMessage(params: {
    threadId: string
    content: string
    metadataJson?: string
  }): Promise<ThreadMessageInfo> {
    const row = await this.threadRepo.appendMessage({
      threadId: params.threadId,
      role: 'system',
      content: params.content,
      metadataJson: params.metadataJson,
    })
    await this.threadRepo.updateMessageCount(params.threadId, 0)
    logger.debug(`系统消息已追加: thread=${params.threadId}, msgId=${row.id}`)
    return this.toMessageInfo(row)
  }

  /**
   * 保存对话对（user + assistant）
   *
   * 便捷方法：一次性写入用户消息和 Agent 回复。
   */
  async saveMessagePair(params: {
    threadId: string
    agentId: string
    userContent: string
    assistantContent: string
    assistantRawContent?: string
    pairId?: string
  }): Promise<{ userMessage: ThreadMessageInfo; assistantMessage: ThreadMessageInfo }> {
    const pairId = params.pairId ?? `pair_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const result = await this.threadRepo.saveMessagePair({
      threadId: params.threadId,
      agentId: params.agentId,
      userContent: params.userContent,
      assistantContent: params.assistantContent,
      assistantRawContent: params.assistantRawContent,
      pairId,
    })
    return {
      userMessage: this.toMessageInfo(result.userMessage),
      assistantMessage: this.toMessageInfo(result.assistantMessage),
    }
  }

  /**
   * 查询活跃消息（供 Context Compiler 使用）
   *
   * 返回最近 N 条 active 消息，时间正序。
   */
  async getActiveMessages(threadId: string, limit = 20): Promise<ThreadMessageInfo[]> {
    const rows = await this.threadRepo.queryActiveMessages({ threadId, limit })
    return rows.map((r) => this.toMessageInfo(r))
  }

  /**
   * 查询最近 N 个完整对话轮次（供 Context Compiler 使用）。
   * 每轮包含共享 pairId 的全部消息，保证不会从半轮中间截断。
   */
  async getActiveMessagePairs(threadId: string, pairLimit = 20): Promise<ThreadMessageInfo[]> {
    const rows = await this.threadRepo.queryActiveMessagePairs(threadId, pairLimit)
    return rows.map((row) => this.toMessageInfo(row))
  }

  /**
   * 分页查询活跃消息（供前端历史加载）
   *
   * 倒序返回（最新在前），前端可按需反转。
   */
  async listMessages(params: {
    threadId: string
    page?: number
    pageSize?: number
  }): Promise<{ items: ThreadMessageInfo[]; total: number }> {
    const result = await this.threadRepo.listActiveMessages(params)
    return {
      items: result.items.map((r) => this.toMessageInfo(r)),
      total: result.total,
    }
  }

  /** 修改用户可见的 Thread 标题。空白标题统一保存为空，由前端显示“未命名会话”。 */
  async renameThread(threadId: string, title: string): Promise<void> {
    const thread = await this.threadRepo.getThread(threadId)
    if (!thread || thread.status === 'deleted') {
      throw new AppError('NOT_FOUND', { message: '会话不存在' })
    }
    await this.threadRepo.updateTitle(threadId, title.trim())
    logger.info(`Thread 已改名: thread=${threadId}`)
  }

  /** 获取删除某轮的链式 rewind 预检：目标轮次及所有后续轮次。 */
  async previewMessageRewind(threadId: string, messageId: number): Promise<RewindPreview> {
    const preview = await this.checkpointService?.previewPair(threadId, messageId)
    if (!preview) throw new AppError('NOT_FOUND', { message: '消息不存在、已删除或不属于当前会话' })
    return preview
  }

  /** 获取删除整条 Thread 的 rewind 预检。 */
  async previewThreadRewind(threadId: string): Promise<RewindPreview> {
    const preview = await this.checkpointService?.previewThread(threadId)
    if (!preview) throw new AppError('NOT_FOUND', { message: '会话不存在或已删除' })
    return preview
  }

  /**
   * 执行链式 rewind：先安全回滚未发生后续变动的文件，再删除目标轮次及全部后续轮次。
   */
  async rewindMessage(threadId: string, messageId: number, deletedBy = 'user') {
    const preview = await this.previewMessageRewind(threadId, messageId)
    const workspace = await this.checkpointService!.rollback(preview)
    const messageIds = await this.checkpointService!.deletePairs(preview, deletedBy)
    await this.attachmentRepo?.softDeleteByMessageIds(messageIds)
    await this.coverageInvalidator?.invalidatePairs(threadId, preview.pairIds)
    await this.threadRepo.syncThreadStats(threadId)
    logger.info(
      `对话已链式回滚: thread=${threadId}, pairs=${preview.pairCount}, messages=${messageIds.length}`,
    )
    return {
      preview: { ...preview, files: workspace.files },
      workspace,
      deletedMessageIds: messageIds,
    }
  }

  /** 删除整条 Thread 前安全回滚该会话未发生后续变动的文件检查点。 */
  async rewindThread(threadId: string) {
    const preview = await this.previewThreadRewind(threadId)
    const workspace = await this.checkpointService!.rollback(preview)
    const result = await this.threadRepo.softDeleteThread(threadId)
    if (!result.deleted) throw new AppError('NOT_FOUND', { message: '会话不存在或已删除' })
    await this.attachmentRepo?.softDeleteByMessageIds(result.messageIds)
    await this.coverageInvalidator?.invalidateThread(threadId)
    logger.info(`Thread 已回滚并软删除: thread=${threadId}, pairs=${preview.pairCount}`)
    return {
      preview: { ...preview, files: workspace.files },
      workspace,
      deletedMessageIds: result.messageIds,
    }
  }

  /** 软删除已退役 Channel 的全部 Thread 与消息。 */
  async deleteThreadsByChannel(channel: string): Promise<number> {
    const count = await this.threadRepo.softDeleteByChannel(channel)
    if (count > 0) logger.info(`已软删除退役 Channel 会话: channel=${channel}, count=${count}`)
    return count
  }

  /** 软删除整条 Thread；不会删除由该 Thread 提炼出的长期记忆。 */
  async deleteThread(threadId: string): Promise<boolean> {
    const result = await this.threadRepo.softDeleteThread(threadId)
    if (!result.deleted) return false
    await this.attachmentRepo?.softDeleteByMessageIds(result.messageIds)
    await this.coverageInvalidator?.invalidateThread(threadId)
    logger.info(`Thread 已软删除: thread=${threadId}, messages=${result.messageIds.length}`)
    return true
  }

  /** 软删除单条消息 */
  async deleteMessage(messageId: number, deletedBy = 'user'): Promise<boolean> {
    const context = await this.threadRepo.getMessageCoverageContext(messageId)
    const success = await this.threadRepo.softDeleteMessage(messageId, deletedBy)
    if (success) {
      await this.attachmentRepo?.softDeleteByMessageIds([messageId])
      if (context?.pairId) {
        await this.coverageInvalidator?.invalidatePairs(context.threadId, [context.pairId])
      }
      logger.info(`消息已软删除: msgId=${messageId}`)
    }
    return success
  }

  /** 软删除整对消息 */
  async deleteMessagePair(messageId: number, deletedBy = 'user'): Promise<number> {
    const context = await this.threadRepo.getMessageCoverageContext(messageId)
    const messageIds = await this.threadRepo.getPairMessageIds(messageId)
    const count = await this.threadRepo.softDeletePair(messageId, deletedBy)
    if (count > 0) {
      await this.attachmentRepo?.softDeleteByMessageIds(messageIds)
      if (context?.pairId) {
        await this.coverageInvalidator?.invalidatePairs(context.threadId, [context.pairId])
      }
      logger.info(`对话对已软删除: msgId=${messageId}, count=${count}`)
    }
    return count
  }

  /** 编辑消息内容 */
  async editMessage(messageId: number, newContent: string): Promise<boolean> {
    const context = await this.threadRepo.getMessageCoverageContext(messageId)
    const success = await this.threadRepo.editMessage(messageId, newContent)
    if (success) {
      if (context?.pairId) {
        await this.coverageInvalidator?.invalidatePairs(context.threadId, [context.pairId])
      }
      logger.info(`消息已编辑: msgId=${messageId}`)
    }
    return success
  }

  // ── 摘要（已废弃，见 .docs/archived/03-context-runtime.md 第 0 节决策） ──
  // 超出上下文窗口的早期消息由长记忆系统兜底，不再生成滚动摘要。

  /** @deprecated 已废弃，超窗口消息由长记忆系统兜底 */
  async getSummary(threadId: string): Promise<string | null> {
    const row = await this.threadRepo.getLatestSummary(threadId)
    return row?.content ?? null
  }

  /** @deprecated 已废弃，超窗口消息由长记忆系统兜底 */
  async upsertSummary(
    threadId: string,
    content: string,
    coversMessageIds: string[],
  ): Promise<void> {
    await this.threadRepo.upsertSummary({ threadId, content, coversMessageIds })
    logger.info(`摘要已更新: thread=${threadId}, covers=${coversMessageIds.length} 条消息`)
  }

  // ── 私有转换 ──

  private toThreadInfo(row: ReturnType<typeof Object>): ThreadInfo {
    const r = row as Record<string, unknown>
    return {
      id: r.id as string,
      agentId: r.agentId as string,
      channel: r.channel as ThreadChannel,
      platform: (r.platform as string) ?? undefined,
      platformIdentifier: (r.platformIdentifier as string) ?? undefined,
      title: (r.title as string) ?? '',
      messageCount: (r.messageCount as number) ?? 0,
      pairCount: (r.pairCount as number) ?? 0,
      lastMessageAt: (r.lastMessageAt as string) ?? null,
      status: (r.status as string) ?? 'active',
      contextPolicy: (r.contextPolicy as string) ?? null,
      disabledTools: this.parseDisabledTools(r.disabledToolsJson),
      autoExecuteTools: Boolean(r.autoExecuteTools),
      purpose: (r.purpose as string) ?? 'conversation',
      createdAt: (r.createdAt as string) ?? '',
      updatedAt: (r.updatedAt as string) ?? '',
    }
  }

  private parseDisabledTools(raw: unknown): string[] {
    if (typeof raw !== 'string') return []
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : []
    } catch {
      return []
    }
  }

  private toMessageInfo(row: ReturnType<typeof Object>): ThreadMessageInfo {
    const r = row as Record<string, unknown>
    return {
      id: r.id as number,
      threadId: r.threadId as string,
      role: r.role as ThreadMessageInfo['role'],
      content: r.content as string,
      rawContent: (r.rawContent as string) ?? null,
      pairId: (r.pairId as string) ?? null,
      senderId: (r.senderId as string) ?? null,
      agentId: (r.agentId as string) ?? null,
      revision: (r.revision as number) ?? 1,
      metadataJson: (r.metadataJson as string) ?? '{}',
      timestamp: (r.timestamp as string) ?? '',
      status: (r.status as string) ?? 'active',
    }
  }
}
