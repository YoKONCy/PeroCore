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
}
