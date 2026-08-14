/**
 * LocalMemoryTaskRunner — 第五阶段 MemoryTaskRunner 本地实现
 *
 * 统一管辖长记忆后台任务的生命周期：
 * - triggerScorer: 异步触发 Scorer 提炼（fire-and-forget，不等待）
 * - runGate: 同步运行 Gate 审核（pending 候选 → accept/reject → 写 CanonicalMemory）
 * - runMaintenance: 调用 MaintenanceService（简化版，返回 completed）
 * - recoverPendingTasks: 恢复未完成的 Scorer 批次
 *
 * 任务状态管理：维护 status 记录 + cancelFlags，支持取消检测。
 *
 * @module packages/backend/src/services/memory/localMemoryTaskRunner
 */

import type { ScorerService } from './scorerService'
import type { MemoryGate } from './memoryGate'
import type { CanonicalMemoryRepository } from '../../repositories/canonicalMemory.repo'
import type { MemoryCandidateRepository } from '../../repositories/memoryCandidate.repo'
import type { ThreadRepository } from '../../repositories/thread.repo'
import type { LocalMemoryProvider } from './localMemoryProvider'
import type { MaintenanceService } from './maintenance/maintenanceService'
import type {
  MemoryTaskRunner,
  MemoryTaskType,
  MemoryTaskStatus,
  MemoryTaskResult,
} from './memoryTaskRunner'
import type { AddMemoryInput, MemoryProvenance } from './memoryProvider'
import { createLogger } from '../../lib/logger'

const logger = createLogger('LocalMemoryTaskRunner')

// ─────────────────────────────────────────────
// LocalMemoryTaskRunner
// ─────────────────────────────────────────────

export class LocalMemoryTaskRunner implements MemoryTaskRunner {
  /** 任务状态 */
  private status: Record<MemoryTaskType, MemoryTaskStatus> = {
    scorer: 'idle',
    gate: 'idle',
    maintenance: 'idle',
  }

  /** 取消标志（runGate/runMaintenance 循环中检测） */
  private cancelFlags: Record<MemoryTaskType, boolean> = {
    scorer: false,
    gate: false,
    maintenance: false,
  }

  constructor(
    private scorerService: ScorerService,
    private memoryGate: MemoryGate,
    private canonicalMemoryRepo: CanonicalMemoryRepository,
    private memoryCandidateRepo: MemoryCandidateRepository,
    private memoryProvider: LocalMemoryProvider,
    private maintenanceService: MaintenanceService,
    private threadRepo: ThreadRepository,
  ) {}

  /**
   * 触发 Scorer 提炼（异步，不等待）
   *
   * 在对话结束后由 ChatRouter 调用。
   * 设置 status='running'，后台执行 scorerService.checkAndProcess，完成后更新 status。
   *
   * AIOS(Phase5): threadId + channel 透传给 ScorerService，支持按 Thread 分批提炼。
   */
  async triggerScorer(threadId: string, agentId: string, channel: string): Promise<void> {
    // 已在运行则跳过（避免重叠批次）
    if (this.status.scorer === 'running') {
      logger.debug(
        `Scorer 已在运行，跳过本次触发 (agent=${agentId}, thread=${threadId}, channel=${channel})`,
      )
      return
    }

    this.cancelFlags.scorer = false
    this.status.scorer = 'running'

    // fire-and-forget：不 await，后台执行
    void this.runScorerInBackground(agentId, threadId, channel).catch((err) => {
      logger.error(`Scorer 后台任务异常: ${err}`)
      this.status.scorer = 'failed'
    })
  }

  /** Scorer 后台执行（更新 status） */
  private async runScorerInBackground(
    agentId: string,
    threadId: string,
    channel: string,
  ): Promise<void> {
    try {
      await this.scorerService.checkAndProcess(agentId, threadId, channel)
      if (this.cancelFlags.scorer) {
        this.status.scorer = 'idle'
        logger.info('Scorer 已被取消')
        return
      }
      this.status.scorer = 'completed'
      logger.info('Scorer 批次已完成')
    } catch (err) {
      logger.error(`Scorer 批次失败: ${err}`)
      this.status.scorer = 'failed'
    }
  }

  /**
   * 运行 Gate 审核（同步等待结果）
   *
   * 流程：
   * 1. 查询 pending 候选（按 agentId 过滤，若未提供则查全部）
   * 2. 对每条候选，取该 Agent 的 active CanonicalMemory 列表
   * 3. 调 gate.review(candidate, existingMemories)
   * 4. accept → 构造 AddMemoryInput 调 memoryProvider.add()，更新候选 status=accepted
   *    reject/skip → 更新候选 status=rejected
   * 5. 循环中检测 cancelFlags.gate，提前退出
   */
  async runGate(agentId?: string): Promise<MemoryTaskResult> {
    const startTime = Date.now()
    this.cancelFlags.gate = false
    this.status.gate = 'running'

    let processedCount = 0
    let createdCount = 0

    try {
      // 查询 pending 候选
      const candidates = agentId
        ? await this.memoryCandidateRepo.findPendingByAgent(agentId)
        : await this.memoryCandidateRepo.findPending()

      if (candidates.length === 0) {
        this.status.gate = 'completed'
        return this.buildResult('gate', 'completed', 0, 0, startTime)
      }

      // 按 agentId 分组，避免重复查询已有记忆
      const agentGroups = new Map<string, typeof candidates>()
      for (const c of candidates) {
        const group = agentGroups.get(c.agentId) ?? []
        group.push(c)
        agentGroups.set(c.agentId, group)
      }

      for (const [agent, groupCandidates] of agentGroups) {
        // 检测取消
        if (this.cancelFlags.gate) {
          logger.info('Gate 审核已被取消，提前退出')
          break
        }

        // 取该 Agent 的 active CanonicalMemory（用于去重比对）
        const existingMemories = await this.canonicalMemoryRepo.findByAgentId(agent, {
          status: 'active',
        })

        for (const candidate of groupCandidates) {
          if (this.cancelFlags.gate) break

          const decision = this.memoryGate.review(candidate, existingMemories)
          processedCount++

          if (decision.decision === 'accept') {
            try {
              // 构造 AddMemoryInput，provenance 从候选反推
              const originThread = candidate.originThreadId
                ? await this.threadRepo.getThread(candidate.originThreadId)
                : undefined
              const provenance: MemoryProvenance = {
                originThreadId: candidate.originThreadId,
                originMessageIds: candidate.originMessageIds,
                originChannel: originThread?.channel ?? 'desktop',
                createdFrom: 'gate',
                createdAt: candidate.createdAt,
              }
              const input: AddMemoryInput = {
                agentId: candidate.agentId,
                content: candidate.summary,
                type: candidate.suggestedType,
                importance: candidate.importance,
                confidence: candidate.confidence,
                tags: candidate.evidenceRefs,
                provenance,
              }

              const canonical = await this.memoryProvider.add(input)
              createdCount++

              // 将新记忆加入 existingMemories，供后续候选去重比对
              existingMemories.push(canonical)

              await this.memoryCandidateRepo.updateStatus(candidate.id, 'accepted')
              logger.debug(`候选 ${candidate.id} 已接受 → CanonicalMemory ${canonical.id}`)
            } catch (err) {
              logger.error(`候选 ${candidate.id} 接受失败: ${err}`)
              await this.memoryCandidateRepo.updateStatus(candidate.id, 'rejected')
            }
          } else if (decision.decision === 'reject') {
            await this.memoryCandidateRepo.updateStatus(candidate.id, 'rejected')
            logger.debug(`候选 ${candidate.id} 已拒绝: ${decision.reason}`)
          } else {
            // skip/merge：暂标记 rejected（merge 未来扩展）
            await this.memoryCandidateRepo.updateStatus(candidate.id, 'rejected')
            logger.debug(`候选 ${candidate.id} 决策=${decision.decision}，标记 rejected`)
          }
        }
      }

      this.status.gate = 'completed'
      return this.buildResult('gate', 'completed', processedCount, createdCount, startTime)
    } catch (err) {
      logger.error(`Gate 审核失败: ${err}`)
      this.status.gate = 'failed'
      return this.buildResult(
        'gate',
        'failed',
        processedCount,
        createdCount,
        startTime,
        String(err),
      )
    }
  }

  /**
   * 运行维护任务（同步等待结果）
   *
   * 简化版：调用 maintenanceService.getStatus 验证可用性，返回 completed。
   * 未来可扩展为调用 Consolidator/Auditor/GraphGardener 等具体维护任务。
   */
  async runMaintenance(_agentId?: string): Promise<MemoryTaskResult> {
    const startTime = Date.now()
    this.cancelFlags.maintenance = false
    this.status.maintenance = 'running'

    try {
      if (this.cancelFlags.maintenance) {
        this.status.maintenance = 'idle'
        return this.buildResult('maintenance', 'idle', 0, 0, startTime)
      }

      // 调用 getStatus 验证 MaintenanceService 可用（未来扩展为实际维护任务）
      await this.maintenanceService.getStatus()

      this.status.maintenance = 'completed'
      return this.buildResult('maintenance', 'completed', 0, 0, startTime)
    } catch (err) {
      logger.error(`维护任务失败: ${err}`)
      this.status.maintenance = 'failed'
      return this.buildResult('maintenance', 'failed', 0, 0, startTime, String(err))
    }
  }

  /**
   * 恢复未完成的 Scorer 任务
   *
   * 在服务启动时调用，处理上次崩溃未完成的批次。
   */
  async recoverPendingTasks(agentId?: string): Promise<void> {
    const id = agentId ?? 'pero'
    try {
      await this.scorerService.recoverPendingTasks(id)
      logger.info(`Scorer 待恢复任务已处理 (agent=${id})`)
    } catch (err) {
      logger.error(`Scorer 任务恢复失败: ${err}`)
    }
  }

  /** 获取当前任务状态 */
  getTaskStatus(taskType: MemoryTaskType): MemoryTaskStatus {
    return this.status[taskType]
  }

  /** 取消正在运行的任务 */
  async cancelTask(taskType: MemoryTaskType): Promise<void> {
    this.cancelFlags[taskType] = true
    logger.info(`已请求取消任务: ${taskType}`)
  }

  // ── 内部方法 ──

  /** 构造 MemoryTaskResult */
  private buildResult(
    taskType: MemoryTaskType,
    status: MemoryTaskStatus,
    processedCount: number,
    createdCount: number,
    startTime: number,
    error?: string,
  ): MemoryTaskResult {
    return {
      taskType,
      status,
      processedCount,
      createdCount,
      durationMs: Date.now() - startTime,
      ...(error !== undefined && { error }),
    }
  }
}
