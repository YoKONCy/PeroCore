/**
 * Reflection 编排器
 *
 * 周期性维护任务的总调度器 (10_MEMORY_SYSTEM.md §7)。
 * 协调 7 个子模块按顺序执行: 标注 → 整合 → 审计 → 退役 → 梦境关联 → 图谱维护。
 *
 * 增强功能 (v1 run_maintenance 移植):
 * - 降本决策: 今日新增记忆 < 阈值时跳过 LLM 密集型步骤
 * - 多 Agent 循环: 扫描全部已启用 Agent
 * - 进度广播: 通过 GatewayHub 推送维护进度
 * - 异常隔离: 单步失败不中断后续步骤
 *
 * @module packages/backend/src/services/memory/maintenance/reflectionOrchestrator
 */

import type { Consolidator } from './consolidator'
import type { Tagger } from './tagger'
import type { Auditor } from './auditor'
import type { RetirementPolicy } from './retirementPolicy'
import type { DreamAssociator } from './dreamAssociator'
import type { GraphGardener } from './graphGardener'
import type { MemoryRepository } from '../../../repositories/memory.repo'
import type { GatewayHub } from '../../gateway/gatewayHub'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('Reflection')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 单 Agent 的 Reflection 结果 */
export interface AgentReflectionResult {
  agentId: string
  tagged: number
  consolidated: number
  audited: number
  retired: number
  dreamLinked: number
  graphEdges: number
  skippedReason?: string
}

/** Reflection 总运行结果 */
export interface ReflectionResult {
  agents: AgentReflectionResult[]
  totalDurationMs: number
  skippedByThreshold: number
}

/** Reflection 配置 */
export interface ReflectionConfig {
  /** 最短运行间隔 (毫秒), 默认 6h */
  minIntervalMs: number
  /** 每次标注的最大记忆数 */
  maxTagBatch: number
  /** 每批用 LLM 处理的记忆数 (§11.3) */
  tagBatchSize: number
  /** 降本阈值: 今日新增记忆 < 此值则跳过 LLM 密集型步骤 */
  costSavingThreshold: number
  /** 整合最大轮次 (对应 v1 的 for _ in range(3)) */
  maxConsolidateRounds: number
}

const DEFAULT_CONFIG: ReflectionConfig = {
  minIntervalMs: 6 * 60 * 60 * 1000,
  maxTagBatch: 30,
  tagBatchSize: 10,
  costSavingThreshold: 5,
  maxConsolidateRounds: 3,
}

// ─────────────────────────────────────────────
// 依赖
// ─────────────────────────────────────────────

export interface ReflectionDeps {
  tagger: Tagger
  consolidator: Consolidator
  auditor: Auditor
  retirementPolicy: RetirementPolicy
  dreamAssociator: DreamAssociator
  graphGardener: GraphGardener
  memoryRepo: MemoryRepository
  gateway?: GatewayHub
}

// ─────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────

export class ReflectionOrchestrator {
  private config: ReflectionConfig
  private deps: ReflectionDeps
  private lastRunTime = 0
  private running = false

  constructor(deps: ReflectionDeps, config?: Partial<ReflectionConfig>) {
    this.deps = deps
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** 是否正在运行 */
  get isRunning(): boolean {
    return this.running
  }

  /**
   * 执行完整的 Reflection 周期
   *
   * 遍历所有 Agent，按依赖顺序执行 6 个子模块。
   * 低活跃 Agent 跳过 LLM 密集型步骤 (降本)。
   */
  async run(agentIds?: string[]): Promise<ReflectionResult> {
    // 频率限制
    const now = Date.now()
    if (now - this.lastRunTime < this.config.minIntervalMs) {
      const hoursLeft = ((this.config.minIntervalMs - (now - this.lastRunTime)) / 3600000).toFixed(1)
      logger.info(`距上次运行不足间隔，跳过 (还需 ${hoursLeft}h)`)
      return { agents: [], totalDurationMs: 0, skippedByThreshold: 0 }
    }

    if (this.running) {
      logger.warn('已有 Reflection 任务在运行，跳过')
      return { agents: [], totalDurationMs: 0, skippedByThreshold: 0 }
    }

    this.running = true
    const startTime = Date.now()

    try {
      // 获取 Agent 列表
      const agents = agentIds ?? await this.discoverAgents()
      logger.info(`Reflection 开始 (Agents: ${agents.join(', ')})`)

      await this.broadcastProgress('started', `开始维护 ${agents.length} 个 Agent`)

      const results: AgentReflectionResult[] = []
      let skippedByThreshold = 0

      for (const agentId of agents) {
        try {
          const result = await this.runForAgent(agentId)
          results.push(result)
          if (result.skippedReason) skippedByThreshold++
        } catch (err) {
          logger.error(`Agent ${agentId} 维护失败: ${err}`)
          results.push(this.emptyAgentResult(agentId, `执行异常: ${err}`))
        }
      }

      const totalDurationMs = Date.now() - startTime
      this.lastRunTime = Date.now()

      // 广播完成
      const summary = results.map((r) => `${r.agentId}: 标${r.tagged} 合${r.consolidated} 审${r.audited} 退${r.retired}`).join(' | ')
      await this.broadcastProgress('completed', `维护完成 (${(totalDurationMs / 1000).toFixed(1)}s): ${summary}`)

      logger.info(`Reflection 完成: 耗时 ${totalDurationMs}ms, ${results.length} Agents`)
      return { agents: results, totalDurationMs, skippedByThreshold }
    } finally {
      this.running = false
    }
  }

  /**
   * 单 Agent 的 Reflection 流程
   */
  private async runForAgent(agentId: string): Promise<AgentReflectionResult> {
    logger.info(`开始维护 Agent: ${agentId}`)
    await this.broadcastProgress('agent_start', `正在维护 ${agentId}`)

    const result = this.emptyAgentResult(agentId)

    // 降本决策: 检查今日新增记忆数 (v1 L474-500)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayNewCount = await this.deps.memoryRepo.countSince(agentId, todayStart.getTime())

    if (todayNewCount < this.config.costSavingThreshold) {
      logger.info(
        `Agent ${agentId} 今日新增 ${todayNewCount} 条 (< ${this.config.costSavingThreshold})，跳过 LLM 密集型步骤`,
      )
      result.skippedReason = `今日新增 ${todayNewCount} 条，低于阈值`

      // 仍执行低成本的退役清理
      try {
        result.retired = await this.deps.retirementPolicy.retire(agentId)
      } catch (err) {
        logger.warn(`退役失败: ${err}`)
      }

      return result
    }

    // 1. 标注 (LLM 密集)
    try {
      await this.broadcastProgress('tagging', `正在标注 ${agentId} 的记忆`)
      result.tagged = await this.deps.tagger.tagUntaggedMemories(agentId, this.config.maxTagBatch)
      logger.debug(`标注完成: ${result.tagged} 条`)
    } catch (err) {
      logger.error(`标注失败: ${err}`)
    }

    // 2. 整合 (LLM 密集, 多轮)
    try {
      await this.broadcastProgress('consolidating', `正在整合 ${agentId} 的记忆`)
      for (let round = 0; round < this.config.maxConsolidateRounds; round++) {
        const merged = await this.deps.consolidator.consolidate(agentId)
        result.consolidated += merged
        if (merged === 0) break
      }
      logger.debug(`整合完成: ${result.consolidated} 条`)
    } catch (err) {
      logger.error(`整合失败: ${err}`)
    }

    // 3. 审计 (LLM 密集)
    try {
      await this.broadcastProgress('auditing', `正在审计 ${agentId} 的记忆`)
      result.audited = await this.deps.auditor.audit(agentId)
      logger.debug(`审计完成: ${result.audited} 条`)
    } catch (err) {
      logger.error(`审计失败: ${err}`)
    }

    // 4. 退役 (低成本)
    try {
      result.retired = await this.deps.retirementPolicy.retire(agentId)
      logger.debug(`退役完成: ${result.retired} 条`)
    } catch (err) {
      logger.warn(`退役失败: ${err}`)
    }

    // 5. 梦境关联 (中等成本, 含 LLM 关系判定)
    try {
      await this.broadcastProgress('dreaming', `正在为 ${agentId} 建立梦境关联`)
      result.dreamLinked = await this.deps.dreamAssociator.associate(agentId)
      logger.debug(`梦境关联完成: ${result.dreamLinked} 条`)
    } catch (err) {
      logger.error(`梦境关联失败: ${err}`)
    }

    // 6. 图谱维护 (中等成本)
    try {
      await this.broadcastProgress('gardening', `正在维护 ${agentId} 的图谱`)
      result.graphEdges = await this.deps.graphGardener.maintain(agentId)
      logger.debug(`图谱维护完成: ${result.graphEdges} 条边`)
    } catch (err) {
      logger.error(`图谱维护失败: ${err}`)
    }

    return result
  }

  /** 自动发现所有已启用的 Agent (从记忆表推导) */
  private async discoverAgents(): Promise<string[]> {
    try {
      const ids = await this.deps.memoryRepo.listDistinctAgentIds()
      return ids.length > 0 ? ids : ['pero']
    } catch {
      return ['pero']
    }
  }

  /** 广播进度 (通过 GatewayHub 推送给前端) */
  private async broadcastProgress(_step: string, message: string): Promise<void> {
    if (!this.deps.gateway) return
    try {
      await this.deps.gateway.pushNotification({
        title: '记忆维护',
        body: message,
        level: 'info',
        source: 'reflection',
        duration: 3000,
      })
    } catch {
      // 广播失败不中断维护流程
    }
  }

  private emptyAgentResult(agentId: string, skippedReason?: string): AgentReflectionResult {
    return {
      agentId,
      tagged: 0,
      consolidated: 0,
      audited: 0,
      retired: 0,
      dreamLinked: 0,
      graphEdges: 0,
      skippedReason,
    }
  }
}
