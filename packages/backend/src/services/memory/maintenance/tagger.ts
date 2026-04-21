/**
 * Tagger — 记忆反思标注器
 *
 * 合并了原 importance_tagger + memory_consolidator 的 LLM 调用:
 * 一次调用同时完成"独立评估 (tags/importance/clusters)" 和 "聚类合并建议"。
 *
 * 输出两部分:
 * - evaluations: 每条记忆的标签/重要性/类型修正
 * - merge_groups: 可合并的记忆组 (Consolidator 可直接消费)
 *
 * @module packages/backend/src/services/memory/maintenance/tagger
 */

import type { MemoryRepository } from '../../../repositories/memory.repo'
import type { VectorWriteHelper } from '../../../shared/vectorWriteHelper'
import type { LlmService, ModelConfig } from '../../llm/llmService'
import type { MdpEngine } from '../../prompt/mdpEngine'
import { parseLlmJson } from '../../../shared/llmJsonParser'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('Tagger')

const BATCH_SIZE = 10

// ─────────────────────────────────────────────
// 输出类型
// ─────────────────────────────────────────────

/** 单条记忆的评估结果 */
export interface TagEvaluation {
  importance: number
  tags: string[]
  clusters: string[]
  suggestedType: string | null
}

/** 合并建议 (聚类) */
export interface MergeGroup {
  ids_to_merge: number[]
  new_content: string
  tags: string[]
  importance: number
}

/** LLM 的完整反思输出 */
interface ReflectionOutput {
  evaluations: Record<string, TagEvaluation>
  merge_groups: MergeGroup[]
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class Tagger {
  constructor(
    private memoryRepo: MemoryRepository,
    private vectorWriteHelper: VectorWriteHelper,
    private llmService: LlmService,
    private getModelConfig: () => Promise<ModelConfig | null>,
    private mdpEngine: MdpEngine,
  ) {}

  /**
   * 批量标注未标注的记忆
   *
   * 使用合并模板 memory_reflection 一次调用完成:
   * 1. 每条记忆的独立评估 (importance/tags/clusters/类型修正)
   * 2. 聚类合并建议 (merge_groups)
   *
   * @returns { tagged: 标注数, mergeGroups: 合并建议 }
   */
  async tagUntaggedMemories(
    agentId: string,
    maxCount: number = 30,
  ): Promise<{ tagged: number; mergeGroups: MergeGroup[] }> {
    const untagged = await this.memoryRepo.findUntagged(agentId, maxCount)
    if (untagged.length === 0) return { tagged: 0, mergeGroups: [] }

    const modelConfig = await this.getModelConfig()
    if (!modelConfig) {
      logger.warn('无模型配置，跳过标注')
      return { tagged: 0, mergeGroups: [] }
    }

    logger.info(`发现 ${untagged.length} 条未标注记忆 (Agent: ${agentId})`)
    let tagged = 0
    const allMergeGroups: MergeGroup[] = []

    for (let i = 0; i < untagged.length; i += BATCH_SIZE) {
      const batch = untagged.slice(i, i + BATCH_SIZE)
      try {
        const result = await this.reflectBatch(batch, modelConfig)

        // 应用评估结果
        for (const [idStr, evaluation] of Object.entries(result.evaluations)) {
          const memoryId = Number(idStr)
          if (Number.isNaN(memoryId)) continue
          await this.applyEvaluation(memoryId, evaluation, agentId)
          tagged++
        }

        // 收集合并建议
        if (result.merge_groups?.length) {
          allMergeGroups.push(...result.merge_groups)
        }

        logger.debug(
          `批次 ${Math.floor(i / BATCH_SIZE) + 1} 完成: ${Object.keys(result.evaluations).length} 评估, ${result.merge_groups?.length ?? 0} 合并建议`,
        )
      } catch (err) {
        logger.error(`反思批次失败: ${err}`)
      }
    }

    logger.info(
      `标注完成: ${tagged}/${untagged.length} 条, ${allMergeGroups.length} 个合并建议 (Agent: ${agentId})`,
    )
    return { tagged, mergeGroups: allMergeGroups }
  }

  /**
   * 批量反思 — 一次 LLM 调用完成评估 + 聚类
   */
  private async reflectBatch(
    memories: Array<{ id: number; content: string; type: string | null }>,
    modelConfig: ModelConfig,
  ): Promise<ReflectionOutput> {
    const memorySummary = memories
      .map((m) => `[ID:${m.id}] [类型:${m.type}] ${m.content}`)
      .join('\n---\n')

    // 使用合并模板
    const systemPrompt = this.mdpEngine.render('tasks/memory/reflection/memory_reflection', {
      agent_name: 'AI',
      memory_data: memorySummary,
    })

    const completion = await this.llmService.chat(
      modelConfig,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: memorySummary },
      ],
      { temperature: 0.2, responseFormat: { type: 'json_object' } },
    )

    const raw = completion.choices[0]?.message?.content
    if (!raw) return { evaluations: {}, merge_groups: [] }

    const parsed = parseLlmJson<ReflectionOutput>(raw)
    return parsed ?? { evaluations: {}, merge_groups: [] }
  }

  /**
   * 应用评估结果到记忆
   */
  private async applyEvaluation(
    memoryId: number,
    evaluation: TagEvaluation,
    agentId: string,
  ): Promise<void> {
    const tagsStr = evaluation.tags.join(',')
    const clustersStr = evaluation.clusters.join(',')

    const updateData: Record<string, unknown> = {
      tags: tagsStr,
      clusters: clustersStr,
      importance: Math.max(1, Math.min(10, evaluation.importance)),
    }

    // 类型修正 (仅允许安全的类型升级)
    const safeTypes = ['preference', 'promise', 'fact']
    if (evaluation.suggestedType && safeTypes.includes(evaluation.suggestedType)) {
      updateData.type = evaluation.suggestedType
    }

    await this.memoryRepo.update(memoryId, updateData)

    // 如果有新标签，触发向量重编码 (标签加权)
    if (tagsStr) {
      const memory = await this.memoryRepo.findById(memoryId)
      if (memory) {
        try {
          await this.vectorWriteHelper.upsertWithFallback({
            memoryId: memory.id,
            content: memory.content,
            tags: tagsStr,
            metadata: {
              agentId,
              importance: updateData.importance as number,
              type: (updateData.type as string) ?? memory.type,
              tags: tagsStr,
            },
            agentId,
            source: memory.source ?? 'desktop',
          })
        } catch (err) {
          logger.debug(`向量重编码跳过: ${err}`)
        }
      }
    }
  }
}
