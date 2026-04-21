/**
 * DreamAssociator — 梦境/联想关联 + 孤独记忆修复
 *
 * 在记忆之间建立跨时间的语义关联边。
 *
 * 功能:
 * 1. 梦境关联: 对近期记忆做语义检索，建立跨时间联想边
 * 2. LLM 关系判定: 调用 LLM 判断两条记忆是否有深层关联
 * 3. 孤独记忆修复: 检测无关联边的记忆，尝试将其织入关系网
 *
 * 注意: TriviumDB 三层原子联删，删节点时自动断边，无需手动清理悬挂边。
 *
 * @module packages/backend/src/services/memory/maintenance/dreamAssociator
 */

import type { MemorySearchService } from '../memorySearch'
import type { VectorRepository } from '../../../repositories/vector.repo'
import type { MemoryRepository } from '../../../repositories/memory.repo'
import type { LlmService, ModelConfig } from '../../llm/llmService'
import type { MdpEngine } from '../../prompt/mdpEngine'
import { parseLlmJson } from '../../../shared/llmJsonParser'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('DreamAssociator')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

interface DreamDeps {
  memorySearch: MemorySearchService
  vectorRepo: VectorRepository
  memoryRepo: MemoryRepository
  llmService: LlmService
  getModelConfig: () => Promise<ModelConfig | null>
  mdpEngine: MdpEngine
}

/** DreamAssociator 配置 */
interface DreamConfig {
  /** 梦境锚点数量 */
  anchorCount: number
  /** 每个锚点最多检索的候选数 */
  candidatesPerAnchor: number
  /** 语义检索最小分数 */
  minScore: number
  /** 最小时间间隔 (毫秒): 低于此值不建边 (避免和 temporal 边重复) */
  minTimeGapMs: number
  /** 是否启用 LLM 关系判定 (关闭后只做纯向量关联) */
  enableLlmJudgment: boolean
  /** 孤独记忆扫描数量 */
  lonelyMemoryLimit: number
}

const DEFAULT_CONFIG: DreamConfig = {
  anchorCount: 16,
  candidatesPerAnchor: 4,
  minScore: 0.78,
  minTimeGapMs: 6 * 60 * 60 * 1000, // 6 小时
  enableLlmJudgment: true,
  lonelyMemoryLimit: 8,
}

/** LLM 关系判定结果 */
interface RelationJudgment {
  has_relation: boolean
  type?: string
  description?: string
  strength?: number
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class DreamAssociator {
  private deps: DreamDeps
  private config: DreamConfig

  constructor(deps: DreamDeps, config?: Partial<DreamConfig>) {
    this.deps = deps
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 执行梦境关联 + 孤独记忆修复
   *
   * @returns 新建的关联边总数
   */
  async associate(agentId: string): Promise<number> {
    let linked = 0

    // 1. 梦境关联
    linked += await this.dreamAndLink(agentId)

    // 2. 孤独记忆修复
    linked += await this.rescueLonelyMemories(agentId)

    return linked
  }

  /**
   * 梦境关联: 对近期记忆做语义检索，建立跨时间联想边
   */
  private async dreamAndLink(agentId: string): Promise<number> {
    const { data: latest } = await this.deps.memoryRepo.list({
      agentId,
      page: 1,
      pageSize: 40,
    })
    if (latest.length < 2) return 0

    const anchors = latest.slice(0, this.config.anchorCount)
    let linked = 0
    const processedPairs = new Set<string>()

    for (const anchor of anchors) {
      if (!anchor.content?.trim()) continue
      if (anchor.type === 'retired') continue

      const source = anchor.source ?? 'desktop'
      const hits = await this.deps.memorySearch.search({
        query: anchor.content,
        agentId,
        source,
        topK: this.config.candidatesPerAnchor,
        expandDepth: 1,
        minScore: this.config.minScore,
      })

      for (const hit of hits) {
        if (hit.id === anchor.id) continue
        if (hit.type === 'retired') continue

        // 避免重复处理同一对
        const pairKey = [Math.min(anchor.id, hit.id), Math.max(anchor.id, hit.id)].join('-')
        if (processedPairs.has(pairKey)) continue
        processedPairs.add(pairKey)

        // 仅跨时间关联
        const timeGap = Math.abs((anchor.timestamp ?? 0) - (hit.timestamp ?? 0))
        if (timeGap < this.config.minTimeGapMs) continue

        // 决定是否使用 LLM 判定
        let label = 'dream'
        let weight = Math.max(0.4, Math.min(1, hit.score))

        if (this.config.enableLlmJudgment) {
          const relation = await this.analyzeRelation(anchor, hit)
          if (relation) {
            label = relation.type ?? 'dream'
            weight = Math.max(0.1, Math.min(1.0, relation.strength ?? 0.5))
          } else {
            // LLM 判定无关联，使用纯向量阈值建弱边
            if (hit.score < 0.85) continue // 向量相似度不够高则跳过
            label = 'dream'
          }
        }

        try {
          await this.deps.vectorRepo.link(anchor.id, hit.id, label, weight, agentId, source)
          linked++
        } catch (err) {
          logger.debug(`建边失败 (${anchor.id}→${hit.id}): ${err}`)
        }
      }
    }

    if (linked > 0) {
      logger.debug(`梦境关联完成: ${linked} 条 (Agent: ${agentId})`)
    }
    return linked
  }

  /**
   * 孤独记忆修复
   *
   * 检测图谱中无连接边的孤立记忆，为其寻找至少一个关联。
   * 注意: TriviumDB 的节点如果没有 link，neighbors() 返回空数组，
   * 但节点本身和向量仍然存在 (只是图谱层面孤立)。
   */
  private async rescueLonelyMemories(agentId: string): Promise<number> {
    const { data: recent } = await this.deps.memoryRepo.list({
      agentId,
      page: 1,
      pageSize: 100,
    })

    // 筛选孤立记忆: 在 TriviumDB 图谱层面没有邻居
    const lonelyMemories: Array<{
      id: number
      content: string
      source: string
      timestamp: number
    }> = []

    for (const mem of recent) {
      if (mem.type === 'retired') continue
      if (lonelyMemories.length >= this.config.lonelyMemoryLimit) break

      try {
        const source = mem.source ?? 'desktop'
        const neighbors = await this.deps.vectorRepo.neighbors(mem.id, agentId, source, 1)
        if (neighbors.length === 0) {
          lonelyMemories.push({
            id: mem.id,
            content: mem.content,
            source: mem.source ?? 'desktop',
            timestamp: mem.timestamp,
          })
        }
      } catch {
        // 节点可能不在 TriviumDB 中 (补偿队列还没处理)
      }
    }

    if (lonelyMemories.length === 0) return 0

    logger.debug(`发现 ${lonelyMemories.length} 条孤独记忆 (Agent: ${agentId})`)
    let rescued = 0

    for (const lonely of lonelyMemories) {
      // 语义检索寻找候选关联
      const hits = await this.deps.memorySearch.search({
        query: lonely.content,
        agentId,
        source: lonely.source,
        topK: 5,
        minScore: 0.65, // 孤独记忆降低阈值，增加匹配机会
      })

      for (const hit of hits) {
        if (hit.id === lonely.id) continue

        // 尝试 LLM 判定
        if (this.config.enableLlmJudgment) {
          const relation = await this.analyzeRelation(
            { content: lonely.content, timestamp: lonely.timestamp },
            { content: hit.content ?? '', timestamp: hit.timestamp ?? 0 },
          )
          if (!relation) continue

          try {
            await this.deps.vectorRepo.link(
              lonely.id,
              hit.id,
              relation.type ?? 'rescued',
              Math.max(0.1, Math.min(1.0, relation.strength ?? 0.5)),
              agentId,
              lonely.source,
            )
            rescued++
            break // 找到一个连接就够了
          } catch (err) {
            logger.debug(`孤独记忆建边失败: ${err}`)
          }
        } else {
          // 无 LLM 时直接用向量相似度
          try {
            await this.deps.vectorRepo.link(
              lonely.id,
              hit.id,
              'rescued',
              Math.max(0.4, Math.min(1, hit.score)),
              agentId,
              lonely.source,
            )
            rescued++
            break
          } catch {
            // 静默
          }
        }
      }
    }

    if (rescued > 0) {
      logger.info(`孤独记忆修复: ${rescued}/${lonelyMemories.length} 条 (Agent: ${agentId})`)
    }
    return rescued
  }

  /**
   * LLM 关系判定
   *
   * 让 LLM 分析两条记忆之间是否存在深层关联。
   */
  private async analyzeRelation(
    m1: { content: string; timestamp?: number },
    m2: { content: string; timestamp?: number },
  ): Promise<RelationJudgment | null> {
    const modelConfig = await this.deps.getModelConfig()
    if (!modelConfig) return null

    const prompt = this.deps.mdpEngine.render('tasks/memory/reflection/dream_associator', {
      memory_a: m1.content,
      memory_b: m2.content,
    })

    try {
      const completion = await this.deps.llmService.chat(
        modelConfig,
        [{ role: 'user', content: prompt }],
        { temperature: 0.1 },
      )

      const raw = completion.choices[0]?.message?.content
      if (!raw) return null

      const data = parseLlmJson<RelationJudgment>(raw)
      if (data?.has_relation) return data
      return null
    } catch (err) {
      logger.debug(`关系判定失败: ${err}`)
      return null
    }
  }
}
