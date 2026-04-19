/**
 * GraphGardener — 图谱边维护
 *
 * 多类型边建设 (semantic/entity/thematic) + 统计。
 * 继承 v1 ReflectionService.build_ontology_graph() 的核心逻辑，
 * 结合 10_MEMORY_SYSTEM.md §14.6.3 的多类型边规范。
 *
 * 边类型:
 * - temporal: save_memory 自动创建，本模块不处理
 * - semantic: batch 内记忆两两比较，余弦 > 0.75 建边
 * - entity:   共享同名实体的记忆间建边
 * - thematic: 共享相同 cluster 的记忆间建边
 * - dream:    DreamAssociator 负责，本模块不处理
 *
 * 注意: TriviumDB 三层原子联删，删节点自动清边，无需手动清理悬挂边。
 *
 * @module packages/backend/src/services/memory/maintenance/graphGardener
 */

import type { MemoryRepository } from '../../../repositories/memory.repo'
import type { VectorRepository } from '../../../repositories/vector.repo'
import type { VectorWriteHelper } from '../../../shared/vectorWriteHelper'
import type { LlmService, ModelConfig } from '../../llm/llmService'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('GraphGardener')

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────

interface GardenerConfig {
  /** 每次处理的最大记忆数 */
  maxBatch: number
  /** semantic 边的余弦相似度阈值 */
  semanticThreshold: number
  /** semantic 边权重范围 */
  semanticWeightMin: number
  semanticWeightMax: number
  /** entity 边权重 */
  entityWeight: number
  /** thematic 边权重 */
  thematicWeight: number
  /** 相同 tag 出现在超过此数量的记忆中则视为通用标签，跳过 */
  maxTagMemories: number
}

const DEFAULT_CONFIG: GardenerConfig = {
  maxBatch: 40,
  semanticThreshold: 0.75,
  semanticWeightMin: 0.5,
  semanticWeightMax: 1.0,
  entityWeight: 0.4,
  thematicWeight: 0.3,
  maxTagMemories: 10,
}

interface GardenerDeps {
  memoryRepo: MemoryRepository
  vectorRepo: VectorRepository
  vectorWriteHelper: VectorWriteHelper
  llmService: LlmService
  getModelConfig: () => Promise<ModelConfig | null>
}

/** 图谱维护统计 */
export interface GardenerStats {
  semanticEdges: number
  entityEdges: number
  thematicEdges: number
  total: number
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class GraphGardener {
  private deps: GardenerDeps
  private config: GardenerConfig

  constructor(deps: GardenerDeps, config?: Partial<GardenerConfig>) {
    this.deps = deps
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 执行图谱边维护
   *
   * @returns 新建的边数
   */
  async maintain(agentId: string): Promise<number> {
    const stats: GardenerStats = { semanticEdges: 0, entityEdges: 0, thematicEdges: 0, total: 0 }

    // 1. Semantic 边: 近期记忆 pairwise 对比
    stats.semanticEdges = await this.buildSemanticEdges(agentId)

    // 2. Entity 边: 共享实体的记忆间建边
    stats.entityEdges = await this.buildEntityEdges(agentId)

    // 3. Thematic 边: 共享相同 cluster 的记忆间建边
    stats.thematicEdges = await this.buildThematicEdges(agentId)

    stats.total = stats.semanticEdges + stats.entityEdges + stats.thematicEdges

    if (stats.total > 0) {
      logger.info(
        `图谱维护完成: semantic=${stats.semanticEdges}, entity=${stats.entityEdges}, ` +
          `thematic=${stats.thematicEdges}, total=${stats.total} (Agent: ${agentId})`,
      )
    }

    return stats.total
  }

  /**
   * 构建语义边
   *
   * 利用 TriviumDB 内置的 search(expandDepth=0) 做纯向量检索，
   * 比手动 O(n²) 余弦高效得多 (TriviumDB 内有 BQ 索引加速)。
   */
  private async buildSemanticEdges(agentId: string): Promise<number> {
    const { data: recent } = await this.deps.memoryRepo.list({
      agentId,
      page: 1,
      pageSize: this.config.maxBatch,
    })

    if (recent.length < 2) return 0

    let edgesBuilt = 0

    // 对每条记忆，用 TriviumDB 自身的向量检索找相似记忆
    // expandDepth=0 → 纯向量检索，无图扩散
    for (const mem of recent) {
      const source = mem.source ?? 'desktop'
      const node = await this.deps.vectorRepo.get(mem.id, agentId, source)
      if (!node?.vector?.length) continue

      // TriviumDB search: 内核直接做余弦比较 (BQ加速)
      const hits = await this.deps.vectorRepo.search(
        node.vector,
        agentId,
        source,
        6, // 多取几个，第一个是自己
        0, // expandDepth=0: 纯向量，无图扩散
        this.config.semanticThreshold,
      )

      for (const hit of hits) {
        if (hit.id === mem.id) continue // 排除自身

        // 映射相似度到权重
        const weight = this.mapToWeight(
          hit.score,
          this.config.semanticThreshold,
          1.0,
          this.config.semanticWeightMin,
          this.config.semanticWeightMax,
        )

        try {
          // 双向建边
          await this.deps.vectorRepo.link(mem.id, hit.id, 'semantic', weight, agentId, source)
          await this.deps.vectorRepo.link(hit.id, mem.id, 'semantic', weight, agentId, source)
          edgesBuilt += 2
        } catch {
          // 静默处理 (可能已有边)
        }
      }
    }

    return edgesBuilt
  }

  /**
   * 构建实体边
   *
   * 扫描带 tags 的记忆，共享相同 tag 的记忆间建边。
   */
  private async buildEntityEdges(agentId: string): Promise<number> {
    const { data: memories } = await this.deps.memoryRepo.list({
      agentId,
      page: 1,
      pageSize: this.config.maxBatch,
    })

    const tagToMemories = new Map<string, number[]>()
    for (const m of memories) {
      if (!m.tags) continue
      const tags = m.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
      for (const tag of tags) {
        const arr = tagToMemories.get(tag) ?? []
        arr.push(m.id)
        tagToMemories.set(tag, arr)
      }
    }

    let edgesBuilt = 0

    for (const [_tag, memIds] of tagToMemories) {
      if (memIds.length < 2 || memIds.length > this.config.maxTagMemories) continue

      for (let i = 0; i < memIds.length; i++) {
        for (let j = i + 1; j < memIds.length; j++) {
          try {
            await this.deps.vectorRepo.link(
              memIds[i]!, memIds[j]!,
              'entity', this.config.entityWeight, agentId, 'desktop',
            )
            edgesBuilt++
          } catch {
            // 静默处理
          }
        }
      }
    }

    return edgesBuilt
  }

  /**
   * 构建主题边 (Thematic)
   *
   * 与 entity 边类似，但基于 clusters 字段。
   * cluster 代表更高层的主题分类 (如"日常生活","技术学习")。
   */
  private async buildThematicEdges(agentId: string): Promise<number> {
    const { data: memories } = await this.deps.memoryRepo.list({
      agentId,
      page: 1,
      pageSize: this.config.maxBatch,
    })

    const clusterToMemories = new Map<string, number[]>()
    for (const m of memories) {
      if (!m.clusters) continue
      const clusters = m.clusters.split(',').map((c: string) => c.trim()).filter(Boolean)
      for (const cluster of clusters) {
        const arr = clusterToMemories.get(cluster) ?? []
        arr.push(m.id)
        clusterToMemories.set(cluster, arr)
      }
    }

    let edgesBuilt = 0

    for (const [_cluster, memIds] of clusterToMemories) {
      // cluster 通常比 tag 更广汇聚，上限放宽
      if (memIds.length < 2 || memIds.length > 20) continue

      for (let i = 0; i < memIds.length; i++) {
        for (let j = i + 1; j < memIds.length; j++) {
          try {
            await this.deps.vectorRepo.link(
              memIds[i]!, memIds[j]!,
              'thematic', this.config.thematicWeight, agentId, 'desktop',
            )
            edgesBuilt++
          } catch {
            // 静默处理
          }
        }
      }
    }

    return edgesBuilt
  }



  /** 线性映射 */
  private mapToWeight(
    value: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number,
  ): number {
    const ratio = (value - inMin) / (inMax - inMin)
    return outMin + ratio * (outMax - outMin)
  }
}
