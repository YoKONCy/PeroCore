/**
 * RetirementPolicy — 低价值记忆退役
 *
 * 根据 importance、age、access_count、type 等指标，
 * 将低价值旧记忆标记为 retired。
 *
 * TriviumDB 三层原子联删自动处理向量+边清理。
 *
 * 策略 (v1 _handle_maintenance_boundary 增强):
 * 1. 时间窗口: 超过 N 天的低重要性记忆
 * 2. 容量边界: event 类型超过 1000 条时清理最旧的
 * 3. 类型豁免: preference/promise 永不退役
 * 4. 软退役: type → 'retired', 不物理删除
 *
 * @module packages/backend/src/services/memory/maintenance/retirementPolicy
 */

import type { MemoryRepository } from '../../../repositories/memory.repo'
import type { VectorWriteHelper } from '../../../shared/vectorWriteHelper'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('Retirement')

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────

interface RetirementConfig {
  /** 低重要性阈值 (<=此值才考虑退役) */
  importanceThreshold: number
  /** 时间窗口: 超过此天数的低重要性记忆才退役 */
  ageDays: number
  /** 容量边界: event 记忆超过此数量时触发边界清理 */
  eventCapacity: number
  /** 边界清理每次最多处理的数量 */
  boundaryBatch: number
  /** 永不退役的记忆类型 */
  exemptTypes: string[]
  /** 日常退役每次最多处理数量 */
  maxBatch: number
}

const DEFAULT_CONFIG: RetirementConfig = {
  importanceThreshold: 2,
  ageDays: 30,
  eventCapacity: 1000,
  boundaryBatch: 100,
  exemptTypes: ['preference', 'promise', 'summary', 'reflection'],
  maxBatch: 50,
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class RetirementPolicy {
  private config: RetirementConfig

  constructor(
    private memoryRepo: MemoryRepository,
    private vectorWriteHelper: VectorWriteHelper,
    config?: Partial<RetirementConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 执行退役策略
   *
   * @returns 退役的总数量
   */
  async retire(agentId: string): Promise<number> {
    let total = 0

    // 1. 低重要性 + 超时退役
    total += await this.retireByAgeAndImportance(agentId)

    // 2. 容量边界退役 (v1 _handle_maintenance_boundary)
    total += await this.retireByCapacity(agentId)

    return total
  }

  /**
   * 策略1: 低重要性 + 超时退役
   *
   * 条件: importance <= 阈值 AND 超过 N 天 AND 非豁免类型
   */
  private async retireByAgeAndImportance(agentId: string): Promise<number> {
    const cutoffMs = Date.now() - this.config.ageDays * 24 * 60 * 60 * 1000

    const candidates = await this.memoryRepo.findRetirementCandidates(
      agentId,
      this.config.importanceThreshold,
      this.config.maxBatch,
    )

    if (candidates.length === 0) return 0

    let retired = 0
    for (const memory of candidates) {
      // 类型豁免
      if (this.config.exemptTypes.includes(memory.type ?? '')) continue

      // 时间窗口
      if (memory.timestamp > cutoffMs) continue

      try {
        // 软退役: 标记为 retired
        await this.memoryRepo.update(memory.id, { type: 'retired' })
        // 从向量库移除 (TriviumDB 三层联删自动清边)
        await this.vectorWriteHelper.deleteWithFallback(
          memory.id,
          agentId,
          memory.source ?? 'desktop',
        )
        retired++
      } catch (err) {
        logger.warn(`退役记忆 ${memory.id} 失败: ${err}`)
      }
    }

    if (retired > 0) {
      logger.info(`时间退役: ${retired} 条 (Agent: ${agentId})`)
    }
    return retired
  }

  /**
   * 策略2: 容量边界退役 (v1 _handle_maintenance_boundary)
   *
   * 当 event 类型记忆超过 1000 条时，
   * 清理最旧的低重要性记忆 (offset 1000 之后的)。
   */
  private async retireByCapacity(agentId: string): Promise<number> {
    // 统计 event 类型总数
    const eventCount = await this.memoryRepo.countByType(agentId, 'event')
    if (eventCount <= this.config.eventCapacity) return 0

    logger.info(`容量超限: ${eventCount} event 记忆 (上限 ${this.config.eventCapacity})`)

    // 查找超出边界的最旧记忆
    const overflow = await this.memoryRepo.findOverflowMemories(
      agentId,
      'event',
      this.config.eventCapacity,
      this.config.boundaryBatch,
    )

    let retired = 0
    for (const memory of overflow) {
      // 类型豁免检查 (理论上这里都是 event，但以防万一)
      if (this.config.exemptTypes.includes(memory.type ?? '')) continue

      // 高重要性保留
      if ((memory.importance ?? 1) >= 5) continue

      try {
        await this.memoryRepo.update(memory.id, { type: 'retired' })
        await this.vectorWriteHelper.deleteWithFallback(
          memory.id,
          agentId,
          memory.source ?? 'desktop',
        )
        retired++
      } catch (err) {
        logger.warn(`边界退役 ${memory.id} 失败: ${err}`)
      }
    }

    if (retired > 0) {
      logger.info(`容量退役: ${retired} 条 (Agent: ${agentId})`)
    }
    return retired
  }
}
