/**
 * Tagger — 未标注记忆的批量标注 + 重要性评分
 *
 * 每 10 条合并为 1 次 LLM 调用 (§11.3)。
 *
 * 输出:
 * - tags: 标签列表
 * - clusters: 主题分类
 * - importance: 重要性评分 (1-10)
 * - type: 记忆类型修正 (event/fact/preference/promise)
 *
 * @module packages/backend/src/services/memory/maintenance/tagger
 */

import type { MemoryRepository } from '../../../repositories/memory.repo'
import type { VectorWriteHelper } from '../../../shared/vectorWriteHelper'
import type { LlmService, ModelConfig } from '../../llm/llmService'
import { parseLlmJson } from '../../../shared/llmJsonParser'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('Tagger')

const BATCH_SIZE = 10

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 单条标注结果 */
interface TagResult {
  memoryId: number
  tags: string[]
  clusters: string[]
  importance: number
  /** 类型修正: LLM 可以建议将 event 修正为 preference/promise 等 */
  suggestedType?: string
}

/** 批量标注的 LLM 输出 */
interface BatchTagOutput {
  results: TagResult[]
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
  ) {}

  /**
   * 批量标注未标注的记忆
   *
   * 流程 (继承 v1 _tag_and_cluster_memories):
   * 1. 查找 importance==1 OR clusters 为空的记忆
   * 2. 每 10 条一批送 LLM
   * 3. 更新 tags, clusters, importance, type
   * 4. 如果 tags 更新了，触发向量重编码 (加权标签)
   *
   * @returns 成功标注的数量
   */
  async tagUntaggedMemories(agentId: string, maxCount: number = 30): Promise<number> {
    const untagged = await this.memoryRepo.findUntagged(agentId, maxCount)
    if (untagged.length === 0) return 0

    const modelConfig = await this.getModelConfig()
    if (!modelConfig) {
      logger.warn('无模型配置，跳过标注')
      return 0
    }

    logger.info(`发现 ${untagged.length} 条未标注记忆 (Agent: ${agentId})`)
    let tagged = 0

    for (let i = 0; i < untagged.length; i += BATCH_SIZE) {
      const batch = untagged.slice(i, i + BATCH_SIZE)
      try {
        const results = await this.tagBatch(batch, modelConfig)
        for (const result of results) {
          await this.applyTagResult(result, agentId)
          tagged++
        }

        logger.debug(`批次 ${Math.floor(i / BATCH_SIZE) + 1} 标注完成: ${results.length} 条`)
      } catch (err) {
        logger.error(`标注批次失败: ${err}`)
      }
    }

    logger.info(`标注完成: ${tagged}/${untagged.length} 条 (Agent: ${agentId})`)
    return tagged
  }

  /**
   * 批量标注一组记忆
   */
  private async tagBatch(
    memories: Array<{ id: number; content: string; type: string | null }>,
    modelConfig: ModelConfig,
  ): Promise<TagResult[]> {
    const memorySummary = memories
      .map((m) => `[ID:${m.id}] [类型:${m.type}] ${m.content}`)
      .join('\n---\n')

    const systemPrompt = [
      '你是一个记忆标注专家。请为以下每条记忆进行分析:',
      '',
      '对每条记忆:',
      '1. 分配 2-5 个标签 (tags): 描述记忆的关键主题',
      '2. 归入 1-2 个思维簇 (clusters): 如"日常生活","技术学习","情感交流"',
      '3. 评估重要性 (importance): 1-10, 其中:',
      '   - 1-2: 日常闲聊、打招呼',
      '   - 3-4: 普通事件、一般性话题',
      '   - 5-6: 有信息量的对话、偏好表达',
      '   - 7-8: 重要事件、承诺、关键偏好',
      '   - 9-10: 极其重要的人生事件、核心价值观',
      '4. 如果记忆当前类型为 event 但实际是偏好/承诺/事实，建议修正 (suggestedType)',
      '',
      '输出 JSON:',
      '{ "results": [{ "memoryId": 123, "tags": ["标签1"], "clusters": ["分类"], "importance": 5, "suggestedType": null }] }',
    ].join('\n')

    const completion = await this.llmService.chat(
      modelConfig,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: memorySummary },
      ],
      { temperature: 0.2, responseFormat: { type: 'json_object' } },
    )

    const raw = completion.choices[0]?.message?.content
    if (!raw) return []

    const parsed = parseLlmJson<BatchTagOutput>(raw)
    if (parsed?.results) return parsed.results

    // 兼容: LLM 可能直接返回数组
    const arr = parseLlmJson<TagResult[]>(raw)
    return arr ?? []
  }

  /**
   * 应用标注结果到记忆
   */
  private async applyTagResult(result: TagResult, agentId: string): Promise<void> {
    const tagsStr = result.tags.join(',')
    const clustersStr = result.clusters.join(',')

    // 构建更新数据
    const updateData: Record<string, unknown> = {
      tags: tagsStr,
      clusters: clustersStr,
      importance: Math.max(1, Math.min(10, result.importance)),
    }

    // 类型修正 (仅允许安全的类型升级)
    const safeTypes = ['preference', 'promise', 'fact']
    if (result.suggestedType && safeTypes.includes(result.suggestedType)) {
      updateData.type = result.suggestedType
    }

    await this.memoryRepo.update(result.memoryId, updateData)

    // 如果有新标签，触发向量重编码 (标签加权)
    if (tagsStr) {
      const memory = await this.memoryRepo.findById(result.memoryId)
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
