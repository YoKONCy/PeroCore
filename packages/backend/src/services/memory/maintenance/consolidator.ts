/**
 * Consolidator — 记忆整合
 *
 * 检测低重要性陈旧记忆 → LLM 合并摘要 → 归档原始记忆。
 * 继承 v1 ReflectionService.consolidate_memories() 的核心逻辑，
 * 重复的向量写入/补偿模式改由 VectorWriteHelper 统一处理。
 *
 * @module packages/backend/src/services/memory/maintenance/consolidator
 */

import type { MemoryRepository } from '../../../repositories/memory.repo'
import type { VectorRepository } from '../../../repositories/vector.repo'
import type { VectorWriteHelper } from '../../../shared/vectorWriteHelper'
import type { LlmService, ModelConfig } from '../../llm/llmService'
import { parseLlmJson } from '../../../shared/llmJsonParser'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('Consolidator')

/** 整合配置 */
interface ConsolidatorConfig {
  /** 回看天数: 超过此天数的低重要性记忆才参与整合 */
  lookbackDays: number
  /** 重要性阈值: 低于此值才参与整合 */
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
}

export class Consolidator {
  private deps: ConsolidatorDeps
  private config: ConsolidatorConfig

  constructor(deps: ConsolidatorDeps, config?: Partial<ConsolidatorConfig>) {
    this.deps = deps
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 整合低重要性陈旧记忆
   *
   * 流程 (继承 v1 consolidate_memories):
   * 1. 查找候选记忆 (超时 + 低重要性)
   * 2. 按日期分组
   * 3. 每组调 LLM 生成摘要
   * 4. 创建 summary 记忆 + 归档原始记忆
   * 5. 修复时间链
   *
   * @returns 整合的记忆数
   */
  async consolidate(agentId: string): Promise<number> {
    const cutoffMs = Date.now() - this.config.lookbackDays * 24 * 60 * 60 * 1000

    // 1. 查找候选记忆
    const candidates = await this.deps.memoryRepo.findConsolidationCandidates(
      agentId,
      cutoffMs,
      this.config.importanceThreshold,
    )

    if (candidates.length < this.config.minGroupSize) return 0

    const modelConfig = await this.deps.getModelConfig()
    if (!modelConfig) {
      logger.warn('无模型配置，跳过整合')
      return 0
    }

    // 2. 按日期分组
    const groups = this.groupByDate(candidates)
    let totalConsolidated = 0

    // 3. 逐组处理
    let groupCount = 0
    for (const [dateKey, group] of groups) {
      if (group.length < this.config.minGroupSize) continue
      if (groupCount >= this.config.maxGroups) break

      try {
        const result = await this.consolidateGroup(agentId, dateKey, group, modelConfig)
        totalConsolidated += result
        groupCount++
      } catch (err) {
        logger.error(`整合 ${dateKey} 失败: ${err}`)
      }
    }

    return totalConsolidated
  }

  /**
   * 整合单个日期分组
   */
  private async consolidateGroup(
    agentId: string,
    dateKey: string,
    group: MemoryRowDefined[],
    modelConfig: ModelConfig,
  ): Promise<number> {
    logger.info(`正在整合 ${dateKey} 的 ${group.length} 条记忆`)

    // 调 LLM 生成摘要
    const memText = group.map((m) => `- ${m.content}`).join('\n')
    const systemPrompt = [
      `你是一个记忆整理助手。请将以下 ${group.length} 条碎片记忆整合为一段简洁的总结。`,
      `输出 JSON: { "summary": "整合后的内容", "importance": 1-10 }`,
    ].join('\n')

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

    // 创建 summary 记忆
    const avgImportance = Math.round(group.reduce((s, m) => s + (m.importance ?? 1), 0) / group.length)
    const newImportance = Math.min(10, Math.max(parsed.importance ?? avgImportance, avgImportance + 1))

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

    // 向量写入
    await this.deps.vectorWriteHelper.upsertWithFallback({
      memoryId: summaryMemory.id,
      content: parsed.summary,
      tags: 'summary,consolidated',
      metadata: {
        agentId,
        importance: newImportance,
        type: 'summary',
        source: 'system',
      },
      agentId,
      source: 'desktop',
    })

    // 修复时间链: 原始组 [A→B→...→D] → 变为 [prev→S→next]
    const firstMem = group[0]!
    const lastMem = group[group.length - 1]!

    if (firstMem.prevId) {
      await this.deps.memoryRepo.update(firstMem.prevId, { nextId: summaryMemory.id })
      await this.deps.memoryRepo.update(summaryMemory.id, { prevId: firstMem.prevId })
    }
    if (lastMem.nextId) {
      await this.deps.memoryRepo.update(lastMem.nextId, { prevId: summaryMemory.id })
      await this.deps.memoryRepo.update(summaryMemory.id, { nextId: lastMem.nextId })
    }

    // 归档原始记忆 (不物理删除)
    for (const m of group) {
      await this.deps.memoryRepo.update(m.id, { type: 'archived_event' })
      await this.deps.vectorWriteHelper.deleteWithFallback(m.id, agentId, m.source ?? 'desktop')
    }

    logger.info(`已整合 ${group.length} 条记忆 → ID ${summaryMemory.id}: "${parsed.summary.slice(0, 50)}..."`)
    return group.length
  }

  private groupByDate(
    memories: MemoryRowDefined[],
  ): Map<string, MemoryRowDefined[]> {
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
