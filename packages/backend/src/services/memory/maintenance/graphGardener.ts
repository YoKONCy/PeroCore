/**
 * GraphGardener — 图谱边维护
 *
 * 多类型边建设 (semantic/entity/thematic) + 统计。
 *.build_ontology_graph() 的核心逻辑，
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
import type { MdpEngine } from '../../prompt/mdpEngine'
import { parseLlmJson } from '../../../shared/llmJsonParser'
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
  mdpEngine: MdpEngine
  getModelConfig: () => Promise<ModelConfig | null>
}

/** 图谱维护统计 */
export interface GardenerStats {
  semanticEdges: number
  entityEdges: number
  thematicEdges: number
  atomizedEntities: number
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
    const stats: GardenerStats = {
      semanticEdges: 0,
      entityEdges: 0,
      thematicEdges: 0,
      atomizedEntities: 0,
      total: 0,
    }

    // 1. Semantic 边: 近期记忆 pairwise 对比
    stats.semanticEdges = await this.buildSemanticEdges(agentId)

    // 2. Entity 边: 共享实体的记忆间建边
    stats.entityEdges = await this.buildEntityEdges(agentId)

    // 3. Thematic 边: 共享相同 cluster 的记忆间建边
    stats.thematicEdges = await this.buildThematicEdges(agentId)

    // 4. 原子化实体提取: 用 LLM (graph_builder.md) 从近期记忆中提取结构化实体 + 关系
    stats.atomizedEntities = await this.buildAtomizedEntities(agentId)

    stats.total =
      stats.semanticEdges + stats.entityEdges + stats.thematicEdges + stats.atomizedEntities

    if (stats.total > 0) {
      logger.info(
        `图谱维护完成: semantic=${stats.semanticEdges}, entity=${stats.entityEdges}, ` +
          `thematic=${stats.thematicEdges}, atomized=${stats.atomizedEntities}, total=${stats.total} (Agent: ${agentId})`,
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
      const tags = m.tags
        .split(',')
        .map((t: string) => t.trim())
        .filter(Boolean)
      for (const tag of tags) {
        const arr = tagToMemories.get(tag) ?? []
        arr.push(m.id)
        tagToMemories.set(tag, arr)
      }
    }

    let edgesBuilt = 0

    for (const memIds of tagToMemories.values()) {
      if (memIds.length < 2 || memIds.length > this.config.maxTagMemories) continue

      for (let i = 0; i < memIds.length; i++) {
        for (let j = i + 1; j < memIds.length; j++) {
          try {
            await this.deps.vectorRepo.link(
              memIds[i]!,
              memIds[j]!,
              'entity',
              this.config.entityWeight,
              agentId,
              'desktop',
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
      const clusters = m.clusters
        .split(',')
        .map((c: string) => c.trim())
        .filter(Boolean)
      for (const cluster of clusters) {
        const arr = clusterToMemories.get(cluster) ?? []
        arr.push(m.id)
        clusterToMemories.set(cluster, arr)
      }
    }

    let edgesBuilt = 0

    for (const memIds of clusterToMemories.values()) {
      // cluster 通常比 tag 更广汇聚，上限放宽
      if (memIds.length < 2 || memIds.length > 20) continue

      for (let i = 0; i < memIds.length; i++) {
        for (let j = i + 1; j < memIds.length; j++) {
          try {
            await this.deps.vectorRepo.link(
              memIds[i]!,
              memIds[j]!,
              'thematic',
              this.config.thematicWeight,
              agentId,
              'desktop',
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
   * 原子化实体提取 (graph_builder.md)
   *
   * 用 LLM 从近期记忆中提取结构化实体并建立图谱关系。
   * 使用反思模型驱动，与 Scorer 分离，避免每次对话都调 LLM 做图谱。
   */
  private async buildAtomizedEntities(agentId: string): Promise<number> {
    const modelConfig = await this.deps.getModelConfig()
    if (!modelConfig) return 0

    const { data: recent } = await this.deps.memoryRepo.list({
      agentId,
      page: 1,
      pageSize: this.config.maxBatch,
    })

    if (recent.length === 0) return 0

    // 批量收集事件数据
    const eventsJson = JSON.stringify(
      recent.map((m) => ({
        id: m.id,
        content: m.content,
        tags:
          m.tags
            ?.split(',')
            .map((t: string) => t.trim())
            .filter(Boolean) ?? [],
      })),
    )

    try {
      const prompt = this.deps.mdpEngine.render('tasks/memory/scorer/graph_builder', {
        events_json: eventsJson,
      })

      const completion = await this.deps.llmService.chat(
        modelConfig,
        [
          { role: 'system', content: prompt },
          { role: 'user', content: '请分析上述事件并输出实体和关系。' },
        ],
        { responseFormat: { type: 'json_object' } },
      )

      const raw = completion.choices[0]?.message?.content
      if (!raw) return 0

      interface GraphResult {
        new_entities?: Array<{ name: string; type: string }>
        relations?: Array<{ event_id: number; entity: string; rel: string; weight: number }>
      }

      const parsed = parseLlmJson<GraphResult>(raw)
      if (!parsed) return 0

      let count = 0

      // 写入实体关键词索引
      if (parsed.new_entities?.length) {
        for (const entity of parsed.new_entities) {
          // 找到包含此实体的所有事件，为它们建立关键词索引
          for (const mem of recent) {
            const source = mem.source ?? 'desktop'
            try {
              await this.deps.vectorRepo.indexKeyword(
                mem.id,
                `atom_${entity.name}`,
                agentId,
                source,
              )
              count++
            } catch {
              // 幂等操作，静默处理
            }
          }
        }
      }

      // 写入关系边
      if (parsed.relations?.length) {
        for (const rel of parsed.relations) {
          const targetMem = recent.find((m) => m.id === rel.event_id)
          if (!targetMem) continue

          try {
            // 从事件向实体方向建边 (event → entity_keyword)
            await this.deps.vectorRepo.indexKeyword(
              rel.event_id,
              `rel_${rel.rel}_${rel.entity}`,
              agentId,
              targetMem.source ?? 'desktop',
            )
            count++
          } catch {
            // 静默处理
          }
        }
      }

      if (count > 0) {
        logger.debug(
          `原子化实体提取完成: ${parsed.new_entities?.length ?? 0} 实体, ${parsed.relations?.length ?? 0} 关系`,
        )
      }

      return count
    } catch (err) {
      logger.warn(`原子化实体提取失败 (非致命): ${err}`)
      return 0
    }
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
