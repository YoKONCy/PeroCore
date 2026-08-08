/**
 * Thread Repository
 *
 * threads + thread_messages + thread_summaries 表的数据访问层。
 * 消息是不可变事件流，只追加，不修改。删除通过软删除实现。
 *
 * @module packages/backend/src/repositories/thread.repo
 */

import { eq, desc, sql, and, inArray } from 'drizzle-orm'
import { threads, threadMessages, threadSummaries } from '../database/schema'
import type { DrizzleDb } from '../database'

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/**
 * Thread Channel 类型
 *
 * - desktop/companion: 主 Agent 场景，由 ContextCompiler 编译
 * - social/group: 预留，由社交子 Agent 应用独立处理（不走 ContextCompiler）
 */
export type ThreadChannel = 'desktop' | 'social' | 'group' | 'companion'

/** Thread 创建输入 */
export interface CreateThreadInput {
  id: string
  agentId: string
  channel: ThreadChannel
  platform?: string
  platformIdentifier?: string
  title?: string
  /**
   * ContextPolicy（JSON 序列化的 ChannelPolicy 字符串）
   * null/undefined 表示使用 DEFAULT_POLICIES 中该 channel 的默认策略
   * 传入时覆盖默认策略，允许 Thread 级别自定义上下文窗口/记忆检索等行为
   */
  contextPolicy?: string | null
}

/** Thread 消息创建输入 */
export interface CreateThreadMessageInput {
  threadId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  rawContent?: string
  pairId?: string
  senderId?: string
  agentId?: string
  metadataJson?: string
}

/** 查询活跃消息参数 */
export interface QueryActiveMessagesParams {
  threadId: string
  /** 返回最近 N 条（默认 20） */
  limit?: number
}

/** Thread 摘要创建输入 */
export interface CreateSummaryInput {
  threadId: string
  content: string
  coversMessageIds: string[]
}

// Drizzle 推导行类型
type ThreadRow = typeof threads.$inferSelect
type ThreadMessageRow = typeof threadMessages.$inferSelect
type ThreadSummaryRow = typeof threadSummaries.$inferSelect

// ─────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────

export class ThreadRepository {
  constructor(private db: DrizzleDb) {}

  // ── Thread 操作 ──

  /** 创建 Thread */
  async createThread(data: CreateThreadInput): Promise<ThreadRow> {
    const rows = await this.db
      .insert(threads)
      .values({
        id: data.id,
        agentId: data.agentId,
        channel: data.channel,
        platform: data.platform,
        platformIdentifier: data.platformIdentifier,
        title: data.title ?? '',
        contextPolicy: data.contextPolicy ?? null,
      })
      .returning()
    return rows[0]!
  }

  /** 根据 ID 查询 Thread */
  async getThread(id: string): Promise<ThreadRow | undefined> {
    const rows = await this.db.select().from(threads).where(eq(threads.id, id)).limit(1)
    return rows[0]
  }

  /** 查询 Agent 的 Thread 列表 */
  async listThreads(params: {
    agentId: string
    channel?: string
    page?: number
    pageSize?: number
  }): Promise<{ items: ThreadRow[]; total: number }> {
    const page = Math.max(1, params.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20))
    const offset = (page - 1) * pageSize

    const conditions = [eq(threads.agentId, params.agentId)]
    if (params.channel) {
      conditions.push(eq(threads.channel, params.channel))
    }

    const items = await this.db
      .select()
      .from(threads)
      .where(and(...conditions))
      .orderBy(desc(threads.lastMessageAt), desc(threads.createdAt))
      .limit(pageSize)
      .offset(offset)

    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(threads)
      .where(and(...conditions))
    const total = countResult[0]?.count ?? 0

    return { items, total }
  }

  /** 查询或创建 Agent 的最新 Thread */
  async getOrCreateLatestThread(
    agentId: string,
    channel: ThreadChannel,
  ): Promise<ThreadRow> {
    // 查找最新的活跃 Thread
    const existing = await this.db
      .select()
      .from(threads)
      .where(and(eq(threads.agentId, agentId), eq(threads.channel, channel), eq(threads.status, 'active')))
      .orderBy(desc(threads.lastMessageAt), desc(threads.createdAt))
      .limit(1)

    if (existing.length > 0) {
      return existing[0]!
    }

    // 没有则创建
    return this.createThread({
      id: `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agentId,
      channel,
    })
  }

  /** 更新 Thread 的消息计数 */
  async updateMessageCount(threadId: string, pairCount: number): Promise<void> {
    await this.db
      .update(threads)
      .set({
        messageCount: sql`message_count + 1`,
        pairCount: sql`pair_count + ${pairCount}`,
        lastMessageAt: sql`(datetime('now', 'localtime'))`,
        updatedAt: sql`(datetime('now', 'localtime'))`,
      })
      .where(eq(threads.id, threadId))
  }

  /**
   * 更新 Thread 标题
   *
   * 用于首次用户消息时自动设置标题（取消息内容前 N 字截断）。
   */
  async updateTitle(threadId: string, title: string): Promise<void> {
    await this.db
      .update(threads)
      .set({
        title,
        updatedAt: sql`(datetime('now', 'localtime'))`,
      })
      .where(eq(threads.id, threadId))
  }

  /**
   * 查询 Thread 的消息总数（仅活跃消息）
   *
   * 用于总览页统计真实对话条数，而非 Thread 记录数。
   */
  async countActiveMessages(threadId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(threadMessages)
      .where(
        and(eq(threadMessages.threadId, threadId), eq(threadMessages.status, 'active')),
      )
    return result[0]?.count ?? 0
  }

  /**
   * 更新 Thread 的 ContextPolicy
   *
   * @param threadId       Thread ID
   * @param contextPolicy  JSON 序列化的 ChannelPolicy 字符串；null 表示恢复使用默认策略
   */
  async updateContextPolicy(
    threadId: string,
    contextPolicy: string | null,
  ): Promise<boolean> {
    const result = await this.db
      .update(threads)
      .set({
        contextPolicy,
        updatedAt: sql`(datetime('now', 'localtime'))`,
      })
      .where(eq(threads.id, threadId))
    return result.changes > 0
  }

  // ── 消息操作 ──

  /** 追加一条消息 */
  async appendMessage(data: CreateThreadMessageInput): Promise<ThreadMessageRow> {
    const rows = await this.db
      .insert(threadMessages)
      .values({
        threadId: data.threadId,
        role: data.role,
        content: data.content,
        rawContent: data.rawContent,
        pairId: data.pairId,
        senderId: data.senderId,
        agentId: data.agentId,
        metadataJson: data.metadataJson ?? '{}',
      })
      .returning()
    return rows[0]!
  }

  /** 保存对话对（user + assistant） */
  async saveMessagePair(params: {
    threadId: string
    agentId: string
    userContent: string
    assistantContent: string
    assistantRawContent?: string
    pairId: string
  }): Promise<{ userMessage: ThreadMessageRow; assistantMessage: ThreadMessageRow }> {
    const userMessage = await this.appendMessage({
      threadId: params.threadId,
      role: 'user',
      content: params.userContent,
      pairId: params.pairId,
    })

    const assistantMessage = await this.appendMessage({
      threadId: params.threadId,
      role: 'assistant',
      content: params.assistantContent,
      rawContent: params.assistantRawContent,
      pairId: params.pairId,
      agentId: params.agentId,
    })

    // 更新 Thread 计数
    await this.updateMessageCount(params.threadId, 1)

    return { userMessage, assistantMessage }
  }

  /**
   * 查询 Thread 的活跃消息（时间正序）
   *
   * 默认返回最近 N 条 active 消息，供 Context Compiler 使用。
   */
  async queryActiveMessages(params: QueryActiveMessagesParams): Promise<ThreadMessageRow[]> {
    const limit = params.limit ?? 20

    // 先按时间倒序取最近 N 条 active 消息
    const recent = await this.db
      .select()
      .from(threadMessages)
      .where(and(eq(threadMessages.threadId, params.threadId), eq(threadMessages.status, 'active')))
      .orderBy(desc(threadMessages.timestamp), desc(threadMessages.id))
      .limit(limit)

    // 反转为时间正序（供 LLM 消费）
    return recent.reverse()
  }

  /** 查询 Thread 的全部活跃消息（分页，用于前端历史加载） */
  async listActiveMessages(params: {
    threadId: string
    page?: number
    pageSize?: number
  }): Promise<{ items: ThreadMessageRow[]; total: number }> {
    const page = Math.max(1, params.page ?? 1)
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 100))
    const offset = (page - 1) * pageSize

    const conditions = [
      eq(threadMessages.threadId, params.threadId),
      eq(threadMessages.status, 'active'),
    ]

    // 倒序查询（最新在前）
    const items = await this.db
      .select()
      .from(threadMessages)
      .where(and(...conditions))
      .orderBy(desc(threadMessages.timestamp), desc(threadMessages.id))
      .limit(pageSize)
      .offset(offset)

    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(threadMessages)
      .where(and(...conditions))
    const total = countResult[0]?.count ?? 0

    return { items, total }
  }

  /** 软删除单条消息 */
  async softDeleteMessage(messageId: number, deletedBy: string): Promise<boolean> {
    // 先查消息所属 threadId，用于后续同步计数
    const msg = await this.db
      .select({ threadId: threadMessages.threadId })
      .from(threadMessages)
      .where(eq(threadMessages.id, messageId))
      .limit(1)
    if (!msg[0]) return false

    const result = await this.db
      .update(threadMessages)
      .set({
        status: 'deleted',
        deletedAt: sql`(datetime('now', 'localtime'))`,
        deletedBy,
      })
      .where(eq(threadMessages.id, messageId))

    // 删除成功后同步 Thread 的消息计数和最后消息时间
    if (result.changes > 0) {
      await this.syncThreadStats(msg[0].threadId)
    }

    return result.changes > 0
  }

  /**
   * 同步 Thread 的 messageCount / pairCount / lastMessageAt
   *
   * 软删除消息后调用，根据活跃消息重新统计并更新 Thread 记录。
   * 保证总览页「最近对话」的数量和排序正确。
   */
  async syncThreadStats(threadId: string): Promise<void> {
    // 统计活跃消息数
    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(threadMessages)
      .where(and(eq(threadMessages.threadId, threadId), eq(threadMessages.status, 'active')))
    const activeCount = countResult[0]?.count ?? 0

    // 统计活跃对话对数（assistant 消息数即 pair 数）
    const pairResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(threadMessages)
      .where(
        and(
          eq(threadMessages.threadId, threadId),
          eq(threadMessages.status, 'active'),
          eq(threadMessages.role, 'assistant'),
        ),
      )
    const activePairCount = pairResult[0]?.count ?? 0

    // 查最后一条活跃消息时间
    const lastMsg = await this.db
      .select({ timestamp: threadMessages.timestamp })
      .from(threadMessages)
      .where(and(eq(threadMessages.threadId, threadId), eq(threadMessages.status, 'active')))
      .orderBy(desc(threadMessages.timestamp))
      .limit(1)
    const lastMessageAt = lastMsg[0]?.timestamp ?? null

    await this.db
      .update(threads)
      .set({
        messageCount: activeCount,
        pairCount: activePairCount,
        lastMessageAt,
        updatedAt: sql`(datetime('now', 'localtime'))`,
      })
      .where(eq(threads.id, threadId))
  }

  /**
   * 软删除整对消息
   *
   * 优先按 pairId 级联删除（新数据）。
   * 旧数据兼容：pairId 为 null 时，按 threadId + 时间顺序找相邻配对消息。
   * - user 消息 → 找同 thread 中时间最近的下一条 assistant 消息
   * - assistant 消息 → 找同 thread 中时间最近的上一条 user 消息
   */
  async softDeletePair(messageId: number, deletedBy: string): Promise<number> {
    // 先找到消息
    const msg = await this.db
      .select()
      .from(threadMessages)
      .where(eq(threadMessages.id, messageId))
      .limit(1)

    if (!msg[0]) return 0

    const current = msg[0]

    // 有 pairId → 按 pairId 级联删除
    if (current.pairId) {
      const result = await this.db
        .update(threadMessages)
        .set({
          status: 'deleted',
          deletedAt: sql`(datetime('now', 'localtime'))`,
          deletedBy,
        })
        .where(eq(threadMessages.pairId, current.pairId))

      // 删除成功后同步 Thread 统计
      if (result.changes > 0) {
        await this.syncThreadStats(current.threadId)
      }

      return result.changes
    }

    // 旧数据兼容：pairId 为 null，按 threadId + 时间顺序找相邻配对消息
    const isUser = current.role === 'user'
    const neighbor = await this.db
      .select({ id: threadMessages.id })
      .from(threadMessages)
      .where(
        and(
          eq(threadMessages.threadId, current.threadId),
          eq(threadMessages.role, isUser ? 'assistant' : 'user'),
          eq(threadMessages.status, 'active'),
          isUser
            ? sql`${threadMessages.timestamp} >= ${current.timestamp}`
            : sql`${threadMessages.timestamp} <= ${current.timestamp}`,
        ),
      )
      .orderBy(
        isUser
          ? sql`${threadMessages.timestamp} asc`
          : sql`${threadMessages.timestamp} desc`,
      )
      .limit(1)

    // 收集要删除的消息 ID（当前消息 + 配对消息）
    const idsToDelete = neighbor[0] ? [messageId, neighbor[0].id] : [messageId]

    const result = await this.db
      .update(threadMessages)
      .set({
        status: 'deleted',
        deletedAt: sql`(datetime('now', 'localtime'))`,
        deletedBy,
      })
      .where(inArray(threadMessages.id, idsToDelete))

    // 删除成功后同步 Thread 统计
    if (result.changes > 0) {
      await this.syncThreadStats(current.threadId)
    }

    return result.changes
  }

  /** 编辑消息内容（创建新 revision） */
  async editMessage(messageId: number, newContent: string): Promise<boolean> {
    // 更新当前消息的内容和 revision
    const result = await this.db
      .update(threadMessages)
      .set({
        content: newContent,
        revision: sql`revision + 1`,
      })
      .where(eq(threadMessages.id, messageId))

    return result.changes > 0
  }

  // ── 摘要操作（已废弃，见 .aios/03-context-runtime.md 第 0 节决策） ──
  // 超出上下文窗口的早期消息由长记忆系统兜底，不再生成滚动摘要。
  // 以下方法保留仅为兼容已有数据，运行时不应再调用。

  /** @deprecated 已废弃，超窗口消息由长记忆系统兜底 */
  async upsertSummary(data: CreateSummaryInput): Promise<ThreadSummaryRow> {
    const existing = await this.db
      .select()
      .from(threadSummaries)
      .where(eq(threadSummaries.threadId, data.threadId))
      .limit(1)

    if (existing.length > 0) {
      const rows = await this.db
        .update(threadSummaries)
        .set({
          content: data.content,
          coversMessageIds: JSON.stringify(data.coversMessageIds),
          revision: sql`revision + 1`,
          isStale: false,
        })
        .where(eq(threadSummaries.id, existing[0]!.id))
        .returning()
      return rows[0]!
    }

    const rows = await this.db
      .insert(threadSummaries)
      .values({
        threadId: data.threadId,
        content: data.content,
        coversMessageIds: JSON.stringify(data.coversMessageIds),
      })
      .returning()
    return rows[0]!
  }

  /** @deprecated 已废弃，超窗口消息由长记忆系统兜底 */
  async getLatestSummary(threadId: string): Promise<ThreadSummaryRow | undefined> {
    const rows = await this.db
      .select()
      .from(threadSummaries)
      .where(and(eq(threadSummaries.threadId, threadId), eq(threadSummaries.isStale, false)))
      .orderBy(desc(threadSummaries.revision))
      .limit(1)
    return rows[0]
  }

  /** @deprecated 已废弃，超窗口消息由长记忆系统兜底 */
  async markSummaryStale(threadId: string): Promise<void> {
    await this.db
      .update(threadSummaries)
      .set({ isStale: true })
      .where(and(eq(threadSummaries.threadId, threadId), eq(threadSummaries.isStale, false)))
  }

  // ── Scorer 操作（AIOS: 替代 conversation_logs 的 scorer 相关查询） ──

  /**
   * 获取待 Scorer 处理的对话对
   *
   * 返回 pairId 配对的消息（user + assistant），按时间正序。
   * 仅返回 scorer_status='pending' 且 role='assistant' 的消息及其配对的 user 消息。
   *
   * AIOS(Phase5): 新增 threadId + channel 参数，支持按 Thread 分批提炼，
   * 避免不同 Thread 的对话混合在一起导致记忆污染。
   * - threadId 提供：只查该 Thread 的消息
   * - channel 提供：只查该 channel 的消息（通过 threads 表 JOIN）
   *
   * @param agentId   Agent ID
   * @param batchSize 最多返回多少对
   * @param threadId  限定 Thread（可选，不传则查所有 Thread）
   * @param channel   限定 channel（可选，需要 JOIN threads 表）
   */
  async getPendingForScorer(
    agentId: string,
    batchSize: number,
    threadId?: string,
    channel?: ThreadChannel,
  ): Promise<Array<{ userMessage: ThreadMessageRow; assistantMessage: ThreadMessageRow; pairId: string }>> {
    // AIOS(Phase5): 按 threadId 过滤，避免跨 Thread 混批
    const assistantConditions = [
      eq(threadMessages.agentId, agentId),
      eq(threadMessages.role, 'assistant'),
      eq(threadMessages.scorerStatus, 'pending'),
      eq(threadMessages.status, 'active'),
    ]
    if (threadId) {
      assistantConditions.push(eq(threadMessages.threadId, threadId))
    }

    // AIOS(Phase5): 按 channel 过滤——先查该 channel 的所有 threadId，再用 inArray 过滤
    // 不用 JOIN 是因为 JOIN 会让返回类型变成合并行，破坏 ThreadMessageRow 类型
    if (channel) {
      const threadRows = await this.db.select({ id: threads.id }).from(threads).where(eq(threads.channel, channel))
      const threadIds = threadRows.map((r) => r.id)
      if (threadIds.length === 0) return []
      assistantConditions.push(inArray(threadMessages.threadId, threadIds))
    }

    // 先查 pending 的 assistant 消息（带 pairId）
    const pendingAssistant = await this.db
      .select()
      .from(threadMessages)
      .where(and(...assistantConditions))
      .orderBy(threadMessages.timestamp)
      .limit(batchSize)

    if (pendingAssistant.length === 0) return []

    // 按 pairId 查对应的 user 消息
    const pairIds = [...new Set(pendingAssistant.map((m) => m.pairId).filter(Boolean))] as string[]
    if (pairIds.length === 0) return []

    const userMessages = await this.db
      .select()
      .from(threadMessages)
      .where(
        and(
          eq(threadMessages.role, 'user'),
          eq(threadMessages.status, 'active'),
          inArray(threadMessages.pairId, pairIds),
        ),
      )
      .orderBy(threadMessages.timestamp)

    // 构建 pairId → userMessage 映射
    const userMap = new Map<string, ThreadMessageRow>()
    for (const u of userMessages) {
      if (u.pairId) userMap.set(u.pairId, u)
    }

    // 配对返回
    const result: Array<{ userMessage: ThreadMessageRow; assistantMessage: ThreadMessageRow; pairId: string }> = []
    for (const a of pendingAssistant) {
      if (!a.pairId) continue
      const u = userMap.get(a.pairId)
      if (u) {
        result.push({ userMessage: u, assistantMessage: a, pairId: a.pairId })
      }
    }
    return result
  }

  /**
   * 标记对话对的 Scorer 状态
   *
   * 通过 pairId 更新 assistant 消息的 scorer_status。
   * 同时将 scorer 元数据写入 metadataJson（合并已有 metadata）。
   *
   * @param pairId         对话对 ID
   * @param status         新状态（analyzed/failed/skipped）
   * @param metadataPatch  要合并的元数据（如 importance、tags、memoryId 等）
   */
  async updateScorerStatus(
    pairId: string,
    status: 'analyzed' | 'failed' | 'skipped',
    metadataPatch?: Record<string, unknown>,
  ): Promise<void> {
    // 查询当前 assistant 消息
    const msgs = await this.db
      .select()
      .from(threadMessages)
      .where(and(eq(threadMessages.pairId, pairId), eq(threadMessages.role, 'assistant')))
      .limit(1)

    if (msgs.length === 0) return
    const msg = msgs[0]!

    // 合并 metadata
    let metadata: Record<string, unknown> = {}
    try {
      metadata = JSON.parse(msg.metadataJson ?? '{}')
    } catch {
      metadata = {}
    }
    if (metadataPatch) {
      metadata = { ...metadata, ...metadataPatch }
    }

    await this.db
      .update(threadMessages)
      .set({
        scorerStatus: status,
        metadataJson: JSON.stringify(metadata),
      })
      .where(eq(threadMessages.id, msg.id))
  }

  /**
   * 统计 Agent 的待处理对话对数量
   */
  async countPendingForScorer(agentId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(threadMessages)
      .where(
        and(
          eq(threadMessages.agentId, agentId),
          eq(threadMessages.role, 'assistant'),
          eq(threadMessages.scorerStatus, 'pending'),
          eq(threadMessages.status, 'active'),
        ),
      )
    return result[0]?.count ?? 0
  }
}
