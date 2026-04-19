/**
 * ContextualRetriever — PEDSA v2 统一认知检索管线
 *
 * 7 步编排:
 *   1. ContextRNN 更新 (h_t → h_{t+1})
 *   2. ClusterRouter 路由 (h_t → active_clusters)
 *   3. TriviumDB searchAdvanced 超召回 (3×topK)
 *   4. Context-aware 重排 (vecSim + contextAffinity + quality + importance)
 *   5. 多样性过滤 (MMR / DPP fallback)
 *   6. 时间链闪回 (prevId/nextId 上下文补充)
 *   7. 返回结果 + 注册反馈回调
 *
 * TriviumDB 内核已实现 PPR + FISTA + DPP，
 * 本模块仅做 TS 侧的编排、路由、context-aware 后处理。
 *
 * @see 10_MEMORY_SYSTEM.md §14.3
 * @module packages/backend/src/services/retrieval/contextualRetriever
 */

import type { VectorRepository } from '../../repositories/vector.repo'
import type { MemoryRepository } from '../../repositories/memory.repo'
import type { EmbeddingProvider } from '../embedding/embeddingService'
import type { JsSearchConfig } from 'triviumdb'
import type { ContextRnn } from './contextRnn'
import type { ClusterRouter } from './clusterRouter'
import type { RetrievalFeedback, InjectedMemory } from './retrievalFeedback'
import {
  contextAwareRerank,
  diversityFilter,
  type RetrievalCandidate,
  type RankedCandidate,
} from './dpDiversity'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ContextualRetriever')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 检索请求 */
export interface CognitiveSearchRequest {
  /** 查询文本 */
  query: string
  /** Agent ID */
  agentId: string
  /** 记忆来源 */
  source?: string
  /** 最终返回条数 */
  topK?: number
  /** 超召回倍率 (默认 3) */
  overRecallMultiplier?: number
  /** 闪回范围 (默认 2) */
  flashbackRange?: number
  /** 是否启用 FISTA 残差寻隐 */
  enableSparseResidual?: boolean
  /** 是否启用 DPP 多样性 */
  enableDpp?: boolean
  /** PPR 回跳概率 */
  teleportAlpha?: number
}

/** 检索结果 (附带 cluster 标签) */
export interface CognitiveSearchResult {
  /** 最终检索到的记忆列表 */
  memories: RankedCandidate[]
  /** 闪回上下文记忆 */
  flashbackMemories: FlashbackMemory[]
  /** 路由到的活跃 cluster 信息 */
  activeClusters: Array<{ clusterId: number; label: string; affinity: number }>
  /** 本次注入的记忆列表 (用于后续反馈采集) */
  injectedForFeedback: InjectedMemory[]
  /** 检索耗时 (ms) */
  durationMs: number
}

/** 闪回记忆 */
interface FlashbackMemory {
  id: number
  content: string
  timestamp: number
  direction: 'prev' | 'next'
}

/** 按模式的 RAG 限制 (10_MEMORY_SYSTEM.md §11.5) */
const RAG_LIMITS: Record<string, number> = {
  desktop: 8,
  social: 0,
  work: 5,
  group_chat: 3,
  mobile: 5,
  scheduler: 3,
}

// ─────────────────────────────────────────────
// 依赖
// ─────────────────────────────────────────────

export interface ContextualRetrieverDeps {
  vectorRepo: VectorRepository
  memoryRepo: MemoryRepository
  embeddingService: EmbeddingProvider
  contextRnn: ContextRnn
  clusterRouter: ClusterRouter
  retrievalFeedback: RetrievalFeedback
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class ContextualRetriever {
  private deps: ContextualRetrieverDeps

  constructor(deps: ContextualRetrieverDeps) {
    this.deps = deps
  }

  /**
   * PEDSA v2 统一检索入口
   *
   * 7 步管线: RNN更新 → 簇路由 → 超召回 → 重排 → 去冗余 → 闪回 → 返回
   */
  async search(req: CognitiveSearchRequest): Promise<CognitiveSearchResult> {
    const startMs = Date.now()

    const {
      query,
      agentId,
      source = 'desktop',
      topK = 5,
      overRecallMultiplier = 3,
      flashbackRange = 2,
      enableSparseResidual = false,
      enableDpp = false,
      teleportAlpha = 0.15,
    } = req

    // RAG 限制
    const ragLimit = RAG_LIMITS[source] ?? RAG_LIMITS.desktop!
    const effectiveTopK = Math.min(topK, ragLimit)
    if (effectiveTopK <= 0) {
      return emptyResult(startMs)
    }

    // ── Step 1: 文本 → 向量化 ──
    const queryVector = await this.deps.embeddingService.embedOne(query)
    if (!queryVector.length) {
      logger.warn('Embedding 为空，跳过检索')
      return emptyResult(startMs)
    }

    // ── Step 2: ContextRNN 更新 ──
    const mode = source === 'social' || source === 'group_chat' ? 'social' : 'main'
    this.deps.contextRnn.update(agentId, mode, queryVector)

    // ── Step 3: Cluster 路由 ──
    const activeClusters = this.deps.clusterRouter.routeByContext(agentId, mode)

    // ── Step 4: TriviumDB searchAdvanced 超召回 ──
    const searchConfig: JsSearchConfig = {
      topK: effectiveTopK * overRecallMultiplier,
      expandDepth: 2,
      minScore: 0.2,
      teleportAlpha,
      enableAdvancedPipeline: true,
      enableSparseResidual,
      enableDpp,
      enableRefractoryFatigue: true,
    }

    const hits = await this.deps.vectorRepo.searchAdvanced(
      queryVector,
      agentId,
      source,
      searchConfig,
    )

    if (hits.length === 0) {
      return emptyResult(startMs, activeClusters)
    }

    // ── Step 5: 关联 SQLite 元数据 + 构建候选集 ──
    const hitIds = hits.map((h) => h.id)
    const rows = await this.deps.memoryRepo.findByIds(hitIds)
    const rowMap = new Map(rows.map((r) => [r.id, r]))

    // 获取 embedding (用于 context affinity 计算)
    const candidates: RetrievalCandidate[] = []
    for (const hit of hits) {
      const row = rowMap.get(hit.id)
      if (!row) continue

      // 从 TriviumDB 获取节点 embedding
      const node = await this.deps.vectorRepo.get(hit.id, agentId, source)

      candidates.push({
        id: hit.id,
        vecSim: hit.score,
        content: row.content,
        embedding: node?.vector ?? null,
        retrievalQuality: row.retrievalQuality ?? 0,
        tags: row.tags ?? '',
        importance: row.importance ?? 1,
        source: row.source ?? 'desktop',
        type: row.type ?? 'event',
        timestamp: row.timestamp,
        clusterId: this.deps.clusterRouter.getNodeCluster(agentId, hit.id),
      })
    }

    // ── Step 6: Context-aware 重排 ──
    const contextBias = this.deps.contextRnn.generateBias(agentId, mode)
    const reranked = contextAwareRerank(candidates, contextBias, {
      topK: effectiveTopK * 2, // 留余量给多样性过滤
    })

    // ── Step 7: 多样性过滤 ──
    const diverse = diversityFilter(reranked, 0.92, effectiveTopK)

    // ── Step 8: 闪回 ──
    const flashbackMemories = await this.buildFlashback(diverse, flashbackRange)

    // ── 构建反馈回调数据 ──
    const hiddenState = this.deps.contextRnn.getHiddenState(agentId, mode)
    const queryEmb = new Float32Array(queryVector)
    const injectedForFeedback: InjectedMemory[] = diverse.map((m) => ({
      id: m.id,
      content: m.content,
      queryEmbedding: queryEmb,
      hiddenState: new Float32Array(hiddenState),
    }))

    const durationMs = Date.now() - startMs
    logger.info(
      `PEDSA v2 检索完成: ${diverse.length} 记忆 + ${flashbackMemories.length} 闪回 ` +
        `(${durationMs}ms, clusters=${activeClusters.length}, Agent=${agentId})`,
    )

    return {
      memories: diverse,
      flashbackMemories,
      activeClusters: activeClusters.map((c) => ({
        clusterId: c.clusterId,
        label: c.label,
        affinity: c.affinity,
      })),
      injectedForFeedback,
      durationMs,
    }
  }

  /**
   * LLM 回复后调用: 采集反馈信号
   *
   * 应在对话管线中、LLM 回复完成后调用。
   */
  async onLlmReply(
    injectedMemories: InjectedMemory[],
    llmReply: string,
  ): Promise<void> {
    if (injectedMemories.length === 0) return

    const signals = this.deps.retrievalFeedback.collectSignals(injectedMemories, llmReply)
    await this.deps.retrievalFeedback.applyFeedback(signals, injectedMemories)
  }

  // ── 内部方法 ──

  /**
   * 为 top 结果构建时间链闪回上下文
   */
  private async buildFlashback(
    memories: RankedCandidate[],
    range: number,
  ): Promise<FlashbackMemory[]> {
    if (range <= 0 || memories.length === 0) return []

    const flashbacks: FlashbackMemory[] = []
    const seenIds = new Set(memories.map((m) => m.id))

    // 只对 top-3 记忆做闪回 (避免太多 DB 查询)
    const anchors = memories.slice(0, 3)

    for (const anchor of anchors) {
      const row = await this.deps.memoryRepo.findById(anchor.id)
      if (!row) continue

      // 向前
      let prevId = row.prevId
      for (let i = 0; i < range && prevId; i++) {
        if (seenIds.has(prevId)) break
        const prev = await this.deps.memoryRepo.findById(prevId)
        if (!prev) break
        flashbacks.push({
          id: prev.id,
          content: prev.content,
          timestamp: prev.timestamp,
          direction: 'prev',
        })
        seenIds.add(prev.id)
        prevId = prev.prevId
      }

      // 向后
      let nextId = row.nextId
      for (let i = 0; i < range && nextId; i++) {
        if (seenIds.has(nextId)) break
        const next = await this.deps.memoryRepo.findById(nextId)
        if (!next) break
        flashbacks.push({
          id: next.id,
          content: next.content,
          timestamp: next.timestamp,
          direction: 'next',
        })
        seenIds.add(next.id)
        nextId = next.nextId
      }
    }

    return flashbacks
  }
}

// ─────────────────────────────────────────────
// 辅助
// ─────────────────────────────────────────────

function emptyResult(
  startMs: number,
  activeClusters: Array<{ clusterId: number; label: string; affinity: number }> = [],
): CognitiveSearchResult {
  return {
    memories: [],
    flashbackMemories: [],
    activeClusters,
    injectedForFeedback: [],
    durationMs: Date.now() - startMs,
  }
}
