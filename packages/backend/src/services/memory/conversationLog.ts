/**
 * 对话日志 Service
 *
 * 对话日志的业务编排层 (Layer 1: 对话层)。
 * 封装对话对保存、滑动窗口、Scorer 待处理队列等逻辑。
 *
 * @module packages/backend/src/services/memory/conversationLog
 */

import type {
  ConversationLogRepository,
  SaveLogPairInput,
  QueryLogsParams,
} from '../../repositories/conversationLog.repo'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ConversationLog')

/** 对话对保存结果 */
export interface SavePairResult {
  pairId: string
  userLogId: number
  assistantLogId: number
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class ConversationLogService {
  constructor(private logRepo: ConversationLogRepository) {}

  /**
   * 保存一对 (用户 + 助手) 对话日志
   *
   * 自动生成 pairId，用于后续 Scorer 关联。
   */
  async savePair(input: Omit<SaveLogPairInput, 'pairId'>): Promise<SavePairResult> {
    const pairId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const rows = await this.logRepo.savePair({
      ...input,
      pairId,
    })

    const userLog = rows.find((r) => r.role === 'user')
    const assistantLog = rows.find((r) => r.role === 'assistant')

    logger.debug(`对话对已保存: pairId=${pairId}`, {
      session: input.sessionId,
      source: input.source,
    })

    return {
      pairId,
      userLogId: userLog?.id ?? 0,
      assistantLogId: assistantLog?.id ?? 0,
    }
  }

  /**
   * 获取滑动窗口内的对话历史
   *
   * 返回最近 N 条对话 (时间正序)，用于注入 prompt。
   */
  async getContextWindow(
    agentId: string,
    sessionId: string,
    windowSize: number = 20,
  ): Promise<Array<{ role: string; content: string }>> {
    const rows = await this.logRepo.getRecent(agentId, sessionId, windowSize)

    return rows.map((row) => ({
      role: row.role,
      content: row.content,
    }))
  }

  /** 查询对话日志 */
  async query(params: QueryLogsParams) {
    return this.logRepo.query(params)
  }

  /** 获取待 Scorer 处理的对话对 */
  async getPendingForScorer(agentId: string, batchSize: number = 10) {
    return this.logRepo.findPendingPairs(agentId, batchSize)
  }

  /** 标记对话对为已分析 */
  async markAnalyzed(
    pairId: string,
    result: {
      sentiment?: string
      importance?: number
      memoryId?: number
    },
  ): Promise<void> {
    await this.logRepo.updateMeta(pairId, {
      ...result,
      analysisStatus: 'done',
    })
  }

  /** 标记对话对分析失败 */
  async markFailed(pairId: string, error: string): Promise<void> {
    await this.logRepo.updateMeta(pairId, {
      analysisStatus: 'failed',
      lastError: error,
    })
  }

  /** 统计某会话的日志数 */
  async count(agentId: string, sessionId?: string): Promise<number> {
    return this.logRepo.count(agentId, sessionId)
  }

  /** 清除会话 */
  async clearSession(sessionId: string, agentId: string): Promise<void> {
    await this.logRepo.deleteBySession(sessionId, agentId)
    logger.info(`会话已清除: ${sessionId}`)
  }

  /** 编辑消息内容 (P2-7) */
  async updateMessage(id: number, newContent: string): Promise<boolean> {
    const ok = await this.logRepo.updateContent(id, newContent)
    if (ok) logger.debug(`消息已编辑: id=${id}`)
    return ok
  }

  /** 删除单条消息 (P2-7) */
  async deleteMessage(id: number): Promise<boolean> {
    const ok = await this.logRepo.deleteById(id)
    if (ok) logger.debug(`消息已删除: id=${id}`)
    return ok
  }

  /**
   * 通过消息 ID 级联删除整对消息 (用户+助手)
   *
   * 先查找该消息的 pairId，再删除同 pair 的所有消息。
   * 如果消息没有 pairId，则仅删除单条消息。
   *
   * @returns 实际删除的消息数量
   */
  async deleteMessagePair(id: number): Promise<number> {
    const msg = await this.logRepo.findById(id)
    if (!msg) return 0

    if (msg.pairId) {
      const count = await this.logRepo.deleteByPairId(msg.pairId)
      logger.debug(`对话对已删除: pairId=${msg.pairId}, 共 ${count} 条`)
      return count
    }

    // 没有 pairId 的消息，退化为单条删除
    const ok = await this.logRepo.deleteById(id)
    return ok ? 1 : 0
  }

  /** 删除指定 Agent 的所有会话日志 */
  async deleteAllSessions(agentId: string): Promise<number> {
    const logs = await this.logRepo.query({ agentId, limit: 100000 })
    const sessionIds = [...new Set(logs.map((l) => l.sessionId))]
    for (const sid of sessionIds) {
      await this.logRepo.deleteBySession(sid, agentId)
    }
    logger.info(`已删除 ${agentId} 的 ${sessionIds.length} 个会话`)
    return sessionIds.length
  }

  /**
   * 按 sessionId 分组，返回分页的会话摘要列表
   *
   * 将原 chat.router.ts 中的分组/排序/分页逻辑下沉至 Service 层。
   * 返回 PaginatedData 分页结构。
   */
  async listSessionSummaries(params: {
    agentId: string
    source?: string
    page: number
    pageSize: number
  }): Promise<{
    items: SessionSummary[]
    total: number
    page: number
    pageSize: number
    hasMore: boolean
  }> {
    const { agentId, source, page, pageSize } = params
    const offset = (page - 1) * pageSize

    // 多取一些日志用于分组 (分组后数量远小于日志条数)
    const logs = await this.logRepo.query({
      agentId,
      source,
      limit: pageSize * 5,
      offset: 0,
    })

    // 按 sessionId 分组
    const sessionMap = new Map<string, SessionSummary>()

    for (const log of logs) {
      const sid = log.sessionId
      const existing = sessionMap.get(sid)
      const ts = log.timestamp ? new Date(log.timestamp).toISOString() : new Date().toISOString()

      if (!existing) {
        sessionMap.set(sid, {
          sessionId: sid,
          agentId: log.agentId,
          source: log.source,
          messageCount: 1,
          firstMessageAt: ts,
          lastMessageAt: ts,
          preview: log.role === 'user' ? log.content.slice(0, 100) : '',
        })
      } else {
        existing.messageCount++
        if (ts < existing.firstMessageAt) existing.firstMessageAt = ts
        if (ts > existing.lastMessageAt) existing.lastMessageAt = ts
        if (log.role === 'user' && !existing.preview) {
          existing.preview = log.content.slice(0, 100)
        }
      }
    }

    // 按最后消息时间排序 (DESC)
    const allSessions = Array.from(sessionMap.values()).sort((a, b) =>
      b.lastMessageAt.localeCompare(a.lastMessageAt),
    )

    const total = allSessions.length
    const items = allSessions.slice(offset, offset + pageSize)

    return { items, total, page, pageSize, hasMore: offset + pageSize < total }
  }
}

/** 会话摘要 DTO */
export interface SessionSummary {
  sessionId: string
  agentId: string
  source: string
  messageCount: number
  firstMessageAt: string
  lastMessageAt: string
  preview: string
}
