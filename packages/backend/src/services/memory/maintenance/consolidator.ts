/**
 * Consolidator — 记忆整合器
 *
 * 两种工作模式:
 * 1. **被动模式** (applyMergeGroups): 接收 Tagger 反思输出的合并建议，直接执行
 * 2. **主动模式** (consolidate): 独立查找候选记忆，调 LLM 生成合并结果
 *
 * 合并后 Orchestrator 优先使用被动模式，节省 LLM 调用。
 *
 * @module packages/backend/src/services/memory/maintenance/consolidator
 */

import type { MemoryRepository } from '../../../repositories/memory.repo'
import type { VectorRepository } from '../../../repositories/vector.repo'
import type { VectorWriteHelper } from '../../../shared/vectorWriteHelper'
import type { LlmService, ModelConfig } from '../../llm/llmService'
import type { MdpEngine } from '../../prompt/mdpEngine'
import type { MergeGroup } from './tagger'
import { parseLlmJson } from '../../../shared/llmJsonParser'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('Consolidator')

/** 整合配置 */
interface ConsolidatorConfig {
  /** 回看天数: 超过此天数的低重要性记忆才参与主动整合 */
  lookbackDays: number
  /** 重要性阈值: 低于此值才参与主动整合 */
  importanceThreshold: number
  /** 单组最少记忆数 (太少不值得整合) */
  minGroupSize: number
  /** 每次最多处理的组数 */
  maxGroups: number
}

const DEFAULT_CONFIG: ConsolidatorConfig = {
  lookbackDays: 3,
  importanceThreshold: 4,
  minGroupSize: 3,
  maxGroups: 5,
}

/** LLM 整合输出 */
interface ConsolidatedOutput {
  summary: string
  importance: number
}

/** Repo 推导的记忆行类型 */
type _MemoryRow = Awaited<ReturnType<MemoryRepository['findById']>>
type MemoryRowDefined = NonNullable<_MemoryRow>

interface ConsolidatorDeps {
  memoryRepo: MemoryRepository
  vectorRepo: VectorRepository
  vectorWriteHelper: VectorWriteHelper
  llmService: LlmService
  getModelConfig: () => Promise<ModelConfig | null>
  mdpEngine: MdpEngine
}

export class Consolidator {
  private deps: ConsolidatorDeps
  private config: ConsolidatorConfig

  constructor(deps: ConsolidatorDeps, config?: Partial<ConsolidatorConfig>) {
    this.deps = deps
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ─────────────────────────────────────────
  // 被动模式: 应用 Tagger 的合并建议
  // ─────────────────────────────────────────

  /**
   * 应用外部提供的合并建议 (来自 Tagger 的 memory_reflection 输出)
   *
   * 不消耗 LLM Token — Tagger 已经在一次调用中生成了合并建议。
   *
   * @returns 合并的记忆数
   */
  async applyMergeGroups(agentId: string, mergeGroups: MergeGroup[]): Promise<number> {
    if (mergeGroups.length === 0) return 0

    let totalMerged = 0

    for (const group of mergeGroups) {
      if (group.ids_to_merge.length < 2) continue

      try {
        const merged = await this.applyMerge(agentId, group)
        totalMerged += merged
      } catch (err) {
        logger.error(`应用合并建议失败 (ids=${group.ids_to_merge}): ${err}`)
      }
    }

    if (totalMerged > 0) {
      logger.info(`被动整合完成: ${totalMerged} 条 (Agent: ${agentId})`)
    }
    return totalMerged
  }

  /**
   * 应用单个合并建议
   */
  private async applyMerge(agentId: string, group: MergeGroup): Promise<number> {
    // 验证所有 ID 存在
    const memories: MemoryRowDefined[] = []
    for (const id of group.ids_to_merge) {
      const mem = await this.deps.memoryRepo.findById(id)
      if (mem) memories.push(mem)
    }

    if (memories.length < 2) return 0

    const tagsStr = group.tags?.join(',') ?? 'summary,consolidated'
    const newImportance = Math.max(1, Math.min(10, group.importance ?? 5))

    // 创建 summary 记忆
    const summaryMemory = await this.deps.memoryRepo.create({
      content: group.new_content,
      agentId,
      tags: tagsStr,
      importance: newImportance,
      baseImportance: newImportance,
      sentiment: 'neutral',
      type: 'summary',
      source: 'system',
    })

    // 向量写入
    await this.deps.vectorWriteHelper.upsertWithFallback({
      memoryId: summaryMemory.id,
      content: group.new_content,
      tags: tagsStr,
      metadata: { agentId, importance: newImportance, type: 'summary', source: 'system' },
      agentId,
      source: 'desktop',
    })

    // 修复时间链
    await this.repairTimeChain(memories, summaryMemory.id)

    // 图谱边继承
    await this.inheritEdges(memories, summaryMemory.id, agentId)

    // 归档原始记忆
    for (const m of memories) {
      await this.deps.memoryRepo.update(m.id, { type: 'archived_event' })
      await this.deps.vectorWriteHelper.deleteWithFallback(m.id, agentId, m.source ?? 'desktop')
    }

    logger.info(
      `合并: ${memories.length} 条 → ID ${summaryMemory.id}: "${group.new_content.slice(0, 50)}..."`,
    )
    return memories.length
  }

  // ─────────────────────────────────────────
  // 主动模式: 独立查找候选并调 LLM (兜底)
  // ─────────────────────────────────────────

  /**
   * 主动整合低重要性陈旧记忆
   *
   * 仅在被动模式无法覆盖时使用 (如历史积压的旧记忆)。
   *
   * @returns 整合的记忆数
   */
  async consolidate(agentId: string): Promise<number> {
    const cutoffMs = Date.now() - this.config.lookbackDays * 24 * 60 * 60 * 1000

    const candidates = await this.deps.memoryRepo.findConsolidationCandidates(
      agentId,
      cutoffMs,
      this.config.importanceThreshold,
    )

    if (candidates.length < this.config.minGroupSize) return 0

    const modelConfig = await this.deps.getModelConfig()
    if (!modelConfig) {
      logger.warn('无模型配置，跳过主动整合')
      return 0
    }

    const groups = this.groupByDate(candidates)
    let totalConsolidated = 0
    let groupCount = 0

    for (const [dateKey, group] of groups) {
      if (group.length < this.config.minGroupSize) continue
      if (groupCount >= this.config.maxGroups) break

      try {
        const result = await this.consolidateGroup(agentId, dateKey, group, modelConfig)
        totalConsolidated += result
        groupCount++
      } catch (err) {
        logger.error(`主动整合 ${dateKey} 失败: ${err}`)
      }
    }

    return totalConsolidated
  }

  /** 主动整合: 单个日期分组 (调 LLM) */
  private async consolidateGroup(
    agentId: string,
    dateKey: string,
    group: MemoryRowDefined[],
    modelConfig: ModelConfig,
  ): Promise<number> {
    logger.info(`主动整合 ${dateKey} 的 ${group.length} 条记忆`)

    const memText = group.map((m) => `[ID:${m.id}] ${m.content}`).join('\n')

    // 使用合并后的 memory_reflection 模板
    const systemPrompt = this.deps.mdpEngine.render('tasks/memory/reflection/memory_reflection', {
      agent_name: 'AI',
      memory_data: memText,
    })

    const completion = await this.deps.llmService.chat(
      modelConfig,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `日期: ${dateKey}\n\n${memText}` },
      ],
      { temperature: 0.3, responseFormat: { type: 'json_object' } },
    )

    const raw = completion.choices[0]?.message?.content
    if (!raw) return 0

    const parsed = parseLlmJson<ConsolidatedOutput>(raw)
    if (!parsed?.summary) return 0

    const avgImportance = Math.round(
      group.reduce((s, m) => s + (m.importance ?? 1), 0) / group.length,
    )
    const newImportance = Math.min(
      10,
      Math.max(parsed.importance ?? avgImportance, avgImportance + 1),
    )

    const summaryMemory = await this.deps.memoryRepo.create({
      content: parsed.summary,
      agentId,
      tags: 'summary,consolidated',
      importance: newImportance,
      baseImportance: newImportance,
      sentiment: 'neutral',
      type: 'summary',
      source: 'system',
    })

    await this.deps.vectorWriteHelper.upsertWithFallback({
      memoryId: summaryMemory.id,
      content: parsed.summary,
      tags: 'summary,consolidated',
      metadata: { agentId, importance: newImportance, type: 'summary', source: 'system' },
      agentId,
      source: 'desktop',
    })

    await this.repairTimeChain(group, summaryMemory.id)
    await this.inheritEdges(group, summaryMemory.id, agentId)

    for (const m of group) {
      await this.deps.memoryRepo.update(m.id, { type: 'archived_event' })
      await this.deps.vectorWriteHelper.deleteWithFallback(m.id, agentId, m.source ?? 'desktop')
    }

    logger.info(
      `主动整合 ${group.length} 条 → ID ${summaryMemory.id}: "${parsed.summary.slice(0, 50)}..."`,
    )
    return group.length
  }

  // ─────────────────────────────────────────
  // 共享工具方法
  // ─────────────────────────────────────────

  /** 修复时间链 */
  private async repairTimeChain(group: MemoryRowDefined[], summaryId: number): Promise<void> {
    const firstMem = group[0]!
    const lastMem = group[group.length - 1]!

    if (firstMem.prevId) {
      await this.deps.memoryRepo.update(firstMem.prevId, { nextId: summaryId })
      await this.deps.memoryRepo.update(summaryId, { prevId: firstMem.prevId })
    }
    if (lastMem.nextId) {
      await this.deps.memoryRepo.update(lastMem.nextId, { prevId: summaryId })
      await this.deps.memoryRepo.update(summaryId, { nextId: lastMem.nextId })
    }
  }

  /** 图谱边继承 */
  private async inheritEdges(
    group: MemoryRowDefined[],
    summaryId: number,
    agentId: string,
  ): Promise<void> {
    const groupIds = new Set(group.map((m) => m.id))
    const inheritedPairs = new Set<string>()

    for (const m of group) {
      try {
        const source = m.source ?? 'desktop'
        const neighbors = await this.deps.vectorRepo.neighbors(m.id, agentId, source, 1)
        for (const nbrId of neighbors) {
          if (groupIds.has(nbrId)) continue

          const pairKey = `${summaryId}-${nbrId}`
          if (inheritedPairs.has(pairKey)) continue
          inheritedPairs.add(pairKey)

          try {
            await this.deps.vectorRepo.link(summaryId, nbrId, 'inherited', 0.6, agentId, source)
            await this.deps.vectorRepo.link(nbrId, summaryId, 'inherited', 0.6, agentId, source)
          } catch (linkErr) {
            logger.debug(`图谱边继承失败 (${summaryId}↔${nbrId}): ${linkErr}`)
          }
        }
      } catch {
        // 节点可能不在 TriviumDB 中
      }
    }

    if (inheritedPairs.size > 0) {
      logger.debug(`图谱边继承: ${inheritedPairs.size} 条对外关系迁移到 summary ${summaryId}`)
    }
  }

  /** 按日期分组 */
  private groupByDate(memories: MemoryRowDefined[]): Map<string, MemoryRowDefined[]> {
    const map = new Map<string, MemoryRowDefined[]>()
    for (const m of memories) {
      const date = new Date(m.timestamp).toISOString().split('T')[0] ?? 'unknown'
      const arr = map.get(date) ?? []
      arr.push(m)
      map.set(date, arr)
    }
    return map
  }
}
