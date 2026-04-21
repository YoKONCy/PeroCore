/**
 * 对话日志 Repository
 *
 * SQLite conversation_logs 表的数据访问层。
 * 对话日志与记忆是不同的领域实体，必须分开。
 *
 * @module packages/backend/src/repositories/conversationLog.repo
 */

import { eq, desc, and, sql } from 'drizzle-orm'
import { conversationLogs } from '../database/schema'
import type { DrizzleDb } from '../database'

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 创建对话日志输入 */
export interface CreateLogInput {
  sessionId: string
  source: string
  role: string
  content: string
  rawContent?: string
  pairId?: string
  agentId: string
  metadataJson?: string
}

/** 对话对 (用户消息 + 助手回复) */
export interface SaveLogPairInput {
  sessionId: string
  source: string
  agentId: string
  userContent: string
  assistantContent: string
  pairId: string
  userRawContent?: string
  assistantRawContent?: string
}

/** 日志查询参数 */
export interface QueryLogsParams {
  sessionId?: string
  agentId: string
  source?: string
  limit?: number
  offset?: number
}

/** Scorer 元数据更新 */
export interface UpdateLogMetaInput {
  sentiment?: string
  importance?: number
  memoryId?: number
  analysisStatus?: string
  retryCount?: number
  lastError?: string
}

// Drizzle 推导行类型
type ConversationLogRow = typeof conversationLogs.$inferSelect

// ─────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────

export class ConversationLogRepository {
  constructor(private db: DrizzleDb) {}

  /** 保存单条日志 */
  async save(data: CreateLogInput): Promise<ConversationLogRow> {
    const rows = await this.db
      .insert(conversationLogs)
      .values({
        sessionId: data.sessionId,
        source: data.source,
        role: data.role,
        content: data.content,
        rawContent: data.rawContent,
        pairId: data.pairId,
        agentId: data.agentId,
        metadataJson: data.metadataJson ?? '{}',
      })
      .returning()
    return rows[0]!
  }

  /** 保存对话对 (用户 + 助手各一条，共享 pairId) */
  async savePair(data: SaveLogPairInput): Promise<ConversationLogRow[]> {
    const rows = await this.db
      .insert(conversationLogs)
      .values([
        {
          sessionId: data.sessionId,
          source: data.source,
          role: 'user',
          content: data.userContent,
          rawContent: data.userRawContent,
          pairId: data.pairId,
          agentId: data.agentId,
        },
        {
          sessionId: data.sessionId,
          source: data.source,
          role: 'assistant',
          content: data.assistantContent,
          rawContent: data.assistantRawContent,
          pairId: data.pairId,
          agentId: data.agentId,
        },
      ])
      .returning()
    return rows
  }

  /** 查询对话日志 */
  async query(params: QueryLogsParams): Promise<ConversationLogRow[]> {
    const { agentId, sessionId, source, limit = 50, offset = 0 } = params
    const conditions = [eq(conversationLogs.agentId, agentId)]

    if (sessionId) conditions.push(eq(conversationLogs.sessionId, sessionId))
    if (source) conditions.push(eq(conversationLogs.source, source))

    const where = conditions.length === 1 ? conditions[0] : and(...conditions)

    return this.db
      .select()
      .from(conversationLogs)
      .where(where)
      .orderBy(desc(conversationLogs.id))
      .limit(limit)
      .offset(offset)
      .all()
  }

  /** 获取最近 N 条对话 (用于滑动窗口) */
  async getRecent(agentId: string, sessionId: string, limit = 20): Promise<ConversationLogRow[]> {
    const rows = await this.db
      .select()
      .from(conversationLogs)
      .where(and(eq(conversationLogs.agentId, agentId), eq(conversationLogs.sessionId, sessionId)))
      .orderBy(desc(conversationLogs.id))
      .limit(limit)
      .all()
    // 反转为时间正序
    return rows.reverse()
  }

  /** 通过 pairId 获取对话对 */
  async findByPairId(pairId: string): Promise<ConversationLogRow[]> {
    return this.db.select().from(conversationLogs).where(eq(conversationLogs.pairId, pairId)).all()
  }

  /** 更新 Scorer 元数据 (sentiment / importance / memoryId 等) */
  async updateMeta(pairId: string, data: UpdateLogMetaInput): Promise<void> {
    await this.db.update(conversationLogs).set(data).where(eq(conversationLogs.pairId, pairId))
  }

  /** 获取待 Scorer 处理的对话对 (analysisStatus = 'pending') */
  async findPendingPairs(agentId: string, limit = 10): Promise<ConversationLogRow[]> {
    return this.db
      .select()
      .from(conversationLogs)
      .where(
        and(
          eq(conversationLogs.agentId, agentId),
          eq(conversationLogs.analysisStatus, 'pending'),
          eq(conversationLogs.role, 'user'),
        ),
      )
      .orderBy(conversationLogs.id)
      .limit(limit)
      .all()
  }

  /** 统计指定条件的日志数 */
  async count(agentId: string, sessionId?: string): Promise<number> {
    const conditions = [eq(conversationLogs.agentId, agentId)]
    if (sessionId) conditions.push(eq(conversationLogs.sessionId, sessionId))
    const where = conditions.length === 1 ? conditions[0] : and(...conditions)

    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(conversationLogs)
      .where(where)
      .get()
    return result?.count ?? 0
  }

  /** 删除指定会话的所有日志 */
  async deleteBySession(sessionId: string, agentId: string): Promise<void> {
    await this.db
      .delete(conversationLogs)
      .where(and(eq(conversationLogs.sessionId, sessionId), eq(conversationLogs.agentId, agentId)))
  }

  /** 编辑消息内容 (P2-7) */
  async updateContent(id: number, newContent: string): Promise<boolean> {
    const result = await this.db
      .update(conversationLogs)
      .set({ content: newContent })
      .where(eq(conversationLogs.id, id))
    return (result as unknown as { changes: number }).changes > 0
  }

  /** 删除单条消息 (P2-7) */
  async deleteById(id: number): Promise<boolean> {
    const result = await this.db.delete(conversationLogs).where(eq(conversationLogs.id, id))
    return (result as unknown as { changes: number }).changes > 0
  }
}
