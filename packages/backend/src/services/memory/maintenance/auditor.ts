/**
 * Auditor — 记忆一致性审计
 *
 * 检测矛盾记忆、重复记忆、错误/噪音记忆，
 * 通过 LLM 判定后自动清理。
 *
 * 增强功能:
 * 1. 内容哈希去重: 完全重复的记忆直接清理 (不消耗 LLM Token)
 * 2. LLM 审计: 识别矛盾/噪音/过期记忆
 * 3. 安全检查: 只删除本次审计范围内的记忆
 *
 * @module packages/backend/src/services/memory/maintenance/auditor
 */

import type { MemoryRepository } from '../../../repositories/memory.repo'
import type { VectorWriteHelper } from '../../../shared/vectorWriteHelper'
import type { LlmService, ModelConfig } from '../../llm/llmService'
import type { MdpEngine } from '../../prompt/mdpEngine'
import { parseLlmJson } from '../../../shared/llmJsonParser'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('Auditor')

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────

interface AuditorConfig {
  /** 每次审计的最大记忆数 */
  maxBatch: number
  /** 最少记忆数 (太少不值得审计) */
  minBatch: number
  /** 内容哈希去重的最小长度 (太短的内容不做哈希去重) */
  minContentLengthForDedup: number
}

const DEFAULT_CONFIG: AuditorConfig = {
  maxBatch: 100,
  minBatch: 5,
  minContentLengthForDedup: 10,
}

interface AuditorDeps {
  memoryRepo: MemoryRepository
  vectorWriteHelper: VectorWriteHelper
  llmService: LlmService
  getModelConfig: () => Promise<ModelConfig | null>
  mdpEngine: MdpEngine
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class Auditor {
  private deps: AuditorDeps
  private config: AuditorConfig

  constructor(deps: AuditorDeps, config?: Partial<AuditorConfig>) {
    this.deps = deps
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 审计近期记忆
   *
   * 两阶段:
   * 1. 内容哈希去重 (零 LLM 成本)
   * 2. LLM 审计 (矛盾/噪音/过期检测)
   *
   * @returns 清理的记忆总数
   */
  async audit(agentId: string): Promise<number> {
    // 1. 拉取近期记忆
    const { data: memories } = await this.deps.memoryRepo.list({
      agentId,
      page: 1,
      pageSize: this.config.maxBatch,
    })

    if (memories.length < this.config.minBatch) return 0

    let totalCleaned = 0

    // Phase 1: 内容哈希去重 (零成本)
    totalCleaned += await this.deduplicateByContent(memories, agentId)

    // Phase 2: LLM 审计 (需要模型配置)
    totalCleaned += await this.llmAudit(memories, agentId)

    return totalCleaned
  }

  /**
   * Phase 1: 内容哈希去重
   *
   * 完全相同内容的记忆，保留 importance 最高的那条，其余清理。
   * 不消耗任何 LLM Token。
   */
  private async deduplicateByContent(
    memories: Array<{
      id: number
      content: string
      importance: number | null
      type: string | null
      source: string | null
    }>,
    agentId: string,
  ): Promise<number> {
    // 按内容分组
    const contentMap = new Map<string, Array<{ id: number; importance: number }>>()

    for (const m of memories) {
      if (m.content.length < this.config.minContentLengthForDedup) continue

      // 简单指纹: 去除空白后的内容
      const fingerprint = m.content.replace(/\s+/g, ' ').trim().toLowerCase()
      const arr: Array<{ id: number; importance: number }> = contentMap.get(fingerprint) ?? []
      arr.push({ id: m.id, importance: m.importance ?? 1 })
      contentMap.set(fingerprint, arr)
    }

    let cleaned = 0

    for (const duplicates of contentMap.values()) {
      if (duplicates.length < 2) continue

      // 保留 importance 最高的 (相同则保留 ID 最大的 = 最新的)
      duplicates.sort((a, b) => b.importance - a.importance || b.id - a.id)
      const toDelete = duplicates.slice(1) // 第一个保留

      for (const dup of toDelete) {
        try {
          await this.deps.memoryRepo.delete(dup.id)
          await this.deps.vectorWriteHelper.deleteWithFallback(dup.id, agentId, 'desktop')
          cleaned++
        } catch (err) {
          logger.warn(`去重清理 ${dup.id} 失败: ${err}`)
        }
      }
    }

    if (cleaned > 0) {
      logger.info(`内容去重: 清理 ${cleaned} 条重复记忆 (Agent: ${agentId})`)
    }
    return cleaned
  }

  /**
   * Phase 2: LLM 审计
   *
   * 问题类型 (继承 v1):
   * - 矛盾记忆 (互相冲突的事实)
   * - 噪音记忆 (无意义的系统残留)
   * - 过期记忆 (已失效的时间相关事件)
   */
  private async llmAudit(
    memories: Array<{ id: number; content: string; type: string | null }>,
    agentId: string,
  ): Promise<number> {
    const modelConfig = await this.deps.getModelConfig()
    if (!modelConfig) {
      logger.warn('无模型配置，跳过 LLM 审计')
      return 0
    }

    // 构建审计数据 (限制发送量)
    const memData = memories.slice(0, 80).map((m) => ({
      id: m.id,
      content: m.content.slice(0, 200), // 截断，降低 Token
      type: m.type,
    }))

    const systemPrompt = this.deps.mdpEngine.render('tasks/memory/reflection/auditor', {
      memory_data: JSON.stringify(memData, null, 2),
    })

    try {
      const completion = await this.deps.llmService.chat(
        modelConfig,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(memData, null, 2) },
        ],
        { responseFormat: { type: 'json_object' } },
      )

      const raw = completion.choices[0]?.message?.content
      if (!raw) return 0

      // 解析删除列表
      let idsToDelete: number[] = []
      const parsed = parseLlmJson<{ ids: number[]; reasons?: Record<string, string> } | number[]>(
        raw,
      )

      if (Array.isArray(parsed)) {
        idsToDelete = parsed.filter((id): id is number => typeof id === 'number')
      } else if (parsed && 'ids' in parsed && Array.isArray(parsed.ids)) {
        idsToDelete = parsed.ids.filter((id): id is number => typeof id === 'number')
      }

      if (idsToDelete.length === 0) return 0

      // 安全检查: 只删除本次审计范围内的记忆
      const validIds = new Set(memData.map((m) => m.id))
      idsToDelete = idsToDelete.filter((id) => validIds.has(id))

      // 执行清理
      let cleaned = 0
      for (const id of idsToDelete) {
        try {
          const memory = await this.deps.memoryRepo.findById(id)
          if (!memory) continue

          await this.deps.memoryRepo.delete(id)
          await this.deps.vectorWriteHelper.deleteWithFallback(
            id,
            agentId,
            memory.source ?? 'desktop',
          )
          cleaned++

          logger.debug(`已清理: id=${id}, "${memory.content.slice(0, 40)}..."`)
        } catch (err) {
          logger.warn(`清理记忆 ${id} 失败: ${err}`)
        }
      }

      logger.info(`LLM 审计: 清理 ${cleaned}/${idsToDelete.length} 条 (Agent: ${agentId})`)
      return cleaned
    } catch (err) {
      logger.error(`LLM 审计失败: ${err}`)
      return 0
    }
  }
}
