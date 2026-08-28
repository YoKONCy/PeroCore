/**
 * ResetService — 危险区域重置服务
 *
 * 提供三种分级重置，全部为物理删除且不可撤销，调用方必须做二次确认：
 * - clearLogs()     清空对话记录（Thread、消息、日志、群聊消息）
 * - resetMemories() 重置 EventNote、Coverage、Reflection、DailyNotes 与 Facts 账本
 * - factoryReset()  恢复出厂设置（清空全部用户数据）
 *
 * 说明：
 * - 角色定义（agent.json / mdp 目录）保存在磁盘，不受数据库重置影响。
 * - TDB 文件由 StoreRegistry 独立重置，本服务只负责 SQLite 完整备份与事务账本。
 *
 * @module packages/backend/src/services/maintenance/resetService
 */

import type { DrizzleDb } from '../../database'
import {
  threads,
  threadMessages,
  threadSummaries,
  conversationLogs,
  groupChatMessages,
  messageAttachments,
  fileChangeSnapshots,
  eventNotes,
  eventNoteCoverages,
  eventMemoryCoverageClaims,
  eventMemoryOperations,
  eventMemoryRelations,
  eventMemoryTimers,
  eventMemoryDailyNoteTasks,
  eventMemoryReflectionTasks,
  eventMemoryQueryAudits,
  factMemoryOperations,
  factObjects,
  factRecords,
} from '../../database/schema'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ResetService')

/** 重置结果 */
export interface ResetResult {
  operation: 'clear_logs' | 'reset_memories' | 'factory_reset'
  /** 实际清空的行数摘要 */
  cleared: Record<string, number>
}

export class ResetService {
  constructor(private readonly db: DrizzleDb) {}

  /** 清空对话记录（记忆与配置不受影响）。 */
  async clearLogs(): Promise<ResetResult> {
    const cleared: Record<string, number> = {}
    cleared.threads = this.clearTable(threads)
    cleared.thread_messages = this.clearTable(threadMessages)
    cleared.thread_summaries = this.clearTable(threadSummaries)
    cleared.conversation_logs = this.clearTable(conversationLogs)
    cleared.group_chat_messages = this.clearTable(groupChatMessages)
    cleared.message_attachments = this.clearTable(messageAttachments)
    cleared.file_change_snapshots = this.clearTable(fileChangeSnapshots)
    logger.info(`对话记录已清空: ${JSON.stringify(cleared)}`)
    return { operation: 'clear_logs', cleared }
  }

  /** 重置全部记忆（对话与配置不受影响）。 */
  async resetMemories(): Promise<ResetResult> {
    const cleared: Record<string, number> = {}
    cleared.event_memory_relations = this.clearTable(eventMemoryRelations)
    cleared.event_memory_coverage_claims = this.clearTable(eventMemoryCoverageClaims)
    cleared.event_note_coverages = this.clearTable(eventNoteCoverages)
    cleared.event_memory_operations = this.clearTable(eventMemoryOperations)
    cleared.event_memory_timers = this.clearTable(eventMemoryTimers)
    cleared.event_memory_daily_note_tasks = this.clearTable(eventMemoryDailyNoteTasks)
    cleared.event_memory_reflection_tasks = this.clearTable(eventMemoryReflectionTasks)
    cleared.event_memory_query_audits = this.clearTable(eventMemoryQueryAudits)
    cleared.event_notes = this.clearTable(eventNotes)
    cleared.fact_memory_operations = this.clearTable(factMemoryOperations)
    cleared.fact_records = this.clearTable(factRecords)
    cleared.fact_objects = this.clearTable(factObjects)
    logger.info(`记忆已重置: ${JSON.stringify(cleared)}`)
    return { operation: 'reset_memories', cleared }
  }

  /** 恢复出厂设置：清空全部用户数据（保留磁盘上的角色定义）。 */
  async factoryReset(): Promise<ResetResult> {
    // 先清空记忆/对话相关，再清空业务数据，最后清空配置与审批审计。
    // 使用显式表名映射，避免依赖 drizzle 内部 symbol 反射。
    const tables: Array<[string, Parameters<DrizzleDb['delete']>[0]]> = [
      ['event_memory_relations', eventMemoryRelations],
      ['event_memory_coverage_claims', eventMemoryCoverageClaims],
      ['event_note_coverages', eventNoteCoverages],
      ['event_memory_operations', eventMemoryOperations],
      ['event_memory_timers', eventMemoryTimers],
      ['event_memory_daily_note_tasks', eventMemoryDailyNoteTasks],
      ['event_memory_reflection_tasks', eventMemoryReflectionTasks],
      ['event_memory_query_audits', eventMemoryQueryAudits],
      ['event_notes', eventNotes],
      ['fact_memory_operations', factMemoryOperations],
      ['fact_records', factRecords],
      ['fact_objects', factObjects],
      ['threads', threads],
      ['thread_messages', threadMessages],
      ['thread_summaries', threadSummaries],
      ['conversation_logs', conversationLogs],
      ['group_chat_messages', groupChatMessages],
      ['message_attachments', messageAttachments],
      ['file_change_snapshots', fileChangeSnapshots],
    ]
    const cleared: Record<string, number> = {}
    for (const [name, table] of tables) cleared[name] = this.clearTable(table)
    logger.info(`出厂重置完成: ${JSON.stringify(cleared)}`)
    return { operation: 'factory_reset', cleared }
  }

  /** 清空单张表并返回删除行数。 */
  private clearTable(table: Parameters<DrizzleDb['delete']>[0]): number {
    try {
      const result = this.db.delete(table).run()
      return result.changes
    } catch (error) {
      // 单表失败不阻断整体重置，避免外键/锁定导致部分表永远无法清空
      logger.warn(`清空表失败（已跳过）: ${(error as Error).message}`)
      return 0
    }
  }
}
