/**
 * lonelyScan — 孤独记忆扫描
 *
 * `periodic_lonely_scan_check`:
 * - 扫描长时间未被检索命中的记忆 (孤岛记忆)
 * - 触发 ReflectionOrchestrator 对孤岛记忆进行整合/退役
 * - 避免记忆库中积累大量无用记忆降低检索质量
 *
 * 周期: 每小时
 *
 * @see Reflection 子系统
 * @module packages/backend/src/lifecycle/cron/lonelyScan
 */

import type { MemoryRepository } from '../../repositories/memory.repo'
import { createLogger } from '../../lib/logger'

const logger = createLogger('CronLonelyScan')

/** 孤独阈值: 超过 N 天未被检索命中 */
const LONELY_THRESHOLD_DAYS = 30

/** 每次扫描的最大数量 */
const MAX_SCAN_BATCH = 50

export interface LonelyScanDeps {
  memoryRepo: MemoryRepository
  /** 当前活跃 Agent ID */
  activeAgentId: string
}

/**
 * 执行孤独记忆扫描
 *
 * 查找超过 LONELY_THRESHOLD_DAYS 天未被检索命中的记忆，
 * 标记为 "lonely" 状态供后续 Reflection 处理。
 */
export async function runLonelyScan(deps: LonelyScanDeps): Promise<LonelyScanResult> {
  const { memoryRepo, activeAgentId } = deps
  const thresholdMs = Date.now() - LONELY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000

  try {
    // 查询长期未命中的记忆
    const lonelyMemories = await memoryRepo.findLonelyMemories(
      activeAgentId,
      thresholdMs,
      MAX_SCAN_BATCH,
    )

    if (lonelyMemories.length === 0) {
      return { scanned: 0, markedLonely: 0 }
    }

    // 标记为孤独状态 (Reflection 下次运行时会处理)
    let markedCount = 0
    for (const mem of lonelyMemories) {
      try {
        await memoryRepo.updateMetadata(mem.id, { lonely: true })
        markedCount++
      } catch {
        // 静默跳过单条失败
      }
    }

    if (markedCount > 0) {
      logger.info(`孤独记忆扫描完成: 标记 ${markedCount}/${lonelyMemories.length} 条`)
    }

    return { scanned: lonelyMemories.length, markedLonely: markedCount }
  } catch (err) {
    logger.error(`孤独记忆扫描失败: ${err}`)
    return { scanned: 0, markedLonely: 0, error: String(err) }
  }
}

/** 扫描结果 */
export interface LonelyScanResult {
  scanned: number
  markedLonely: number
  error?: string
}
