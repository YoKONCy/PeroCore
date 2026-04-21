/**
 * 记忆检索 Service — 语义搜索 + 逻辑闪回
 *
 * 封装 TriviumDB 的多种检索策略，提供统一的检索入口。
 * 后续 PEDSA 的 ContextualRetriever 将替换此 Service 的核心检索逻辑。
 *
 * @module packages/backend/src/services/memory/memorySearch
 */

import type { VectorRepository } from '../../repositories/vector.repo'
import type { MemoryRepository } from '../../repositories/memory.repo'
import type { EmbeddingProvider } from '../embedding/embeddingService'
import type { JsSearchHit, JsSearchConfig } from 'triviumdb'
import { createLogger } from '../../lib/logger'

const logger = createLogger('MemorySearch')

/** 检索结果 (附带 SQLite 元数据) */
export interface MemorySearchResult {
  /** 记忆 ID */
  id: number
  /** 记忆内容 */
  content: string
  /** 向量相似度得分 */
  score: number
  /** 标签 */
  tags: string
  /** 重要性 */
  importance: number
  /** 来源 */
  source: string
  /** 类型 */
  type: string
  /** 时间戳 */
  timestamp: number
}

/** 检索参数 */
export interface SearchParams {
  query: string
  agentId: string
  source?: string
  topK?: number
  expandDepth?: number
  minScore?: number
}

/** 高级检索参数 (PEDSA 准备) */
export interface AdvancedSearchParams extends SearchParams {
  config?: JsSearchConfig
}

/** 按模式的 RAG 限制 */
const RAG_LIMITS: Record<string, { memories: number; flashback: number }> = {
  desktop: { memories: 8, flashback: 3 },
  social: { memories: 0, flashback: 0 },
  work: { memories: 5, flashback: 2 },
  group_chat: { memories: 3, flashback: 1 },
  mobile: { memories: 5, flashback: 2 },
  scheduler: { memories: 3, flashback: 0 },
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class MemorySearchService {
  constructor(
    private vectorRepo: VectorRepository,
    private memoryRepo: MemoryRepository,
    private embeddingService: EmbeddingProvider,
  ) {}

  /**
   * 标准语义检索
   *
   * 文本 → 向量化 → TriviumDB 检索 → 关联 SQLite 元数据
   */
  async search(params: SearchParams): Promise<MemorySearchResult[]> {
    const { query, agentId, source = 'desktop', topK = 5, expandDepth = 2, minScore = 0.3 } = params
    const ragLimit = RAG_LIMITS[source] ?? RAG_LIMITS.desktop!

    // 按模式限制检索数量
    const effectiveTopK = Math.min(topK, ragLimit.memories)
    if (effectiveTopK <= 0) return []

    // 文本 → 向量
    const queryVector = await this.embeddingService.embedOne(query)
    if (!queryVector.length) {
      logger.warn('Embedding 为空，跳过检索')
      return []
    }

    // TriviumDB 检索
    const hits = await this.vectorRepo.search(
      queryVector,
      agentId,
      source,
      effectiveTopK,
      expandDepth,
      minScore,
    )

    return this.enrichResults(hits, agentId)
  }

  /**
   * 高级认知管线检索 (PEDSA 入口)
   *
   * 使用 TriviumDB 的 searchAdvanced API，支持：
   * - FISTA 残差寻隐
   * - PPR 图扩散
   * - DPP 多样性采样
   */
  async searchAdvanced(params: AdvancedSearchParams): Promise<MemorySearchResult[]> {
    const { query, agentId, source = 'desktop', config } = params

    const queryVector = await this.embeddingService.embedOne(query)
    if (!queryVector.length) return []

    const hits = await this.vectorRepo.searchAdvanced(queryVector, agentId, source, config)

    return this.enrichResults(hits, agentId)
  }

  /**
   * 混合检索 (向量 + 文本 BM25)
   */
  async searchHybrid(params: SearchParams): Promise<MemorySearchResult[]> {
    const { query, agentId, source = 'desktop', topK = 5, expandDepth = 2, minScore = 0.3 } = params

    const queryVector = await this.embeddingService.embedOne(query)
    if (!queryVector.length) return []

    const hits = await this.vectorRepo.searchHybrid(
      queryVector,
      query,
      agentId,
      source,
      topK,
      expandDepth,
      minScore,
    )

    return this.enrichResults(hits, agentId)
  }

  /**
   * 逻辑闪回 — 沿时间链展开上下文
   *
   * 从锚点记忆出发，沿 prevId / nextId 链展开前后文。
   * 用于为检索命中的记忆补充上下文信息。
   */
  async flashback(
    anchorId: number,
    _agentId: string,
    range: number = 3,
  ): Promise<MemorySearchResult[]> {
    const anchor = await this.memoryRepo.findById(anchorId)
    if (!anchor) return []

    const contextIds: number[] = []

    // 向前展开
    let prevId = anchor.prevId
    for (let i = 0; i < range && prevId; i++) {
      contextIds.push(prevId)
      const prev = await this.memoryRepo.findById(prevId)
      prevId = prev?.prevId ?? null
    }

    // 向后展开
    let nextId = anchor.nextId
    for (let i = 0; i < range && nextId; i++) {
      contextIds.push(nextId)
      const next = await this.memoryRepo.findById(nextId)
      nextId = next?.nextId ?? null
    }

    if (contextIds.length === 0) return []

    const rows = await this.memoryRepo.findByIds(contextIds)
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      score: 0, // 闪回结果无检索得分
      tags: row.tags ?? '',
      importance: row.importance ?? 1,
      source: row.source ?? 'desktop',
      type: row.type ?? 'event',
      timestamp: row.timestamp,
    }))
  }

  // ── 内部方法 ──

  /**
   * 将 TriviumDB 检索结果关联 SQLite 元数据
   */
  private async enrichResults(
    hits: JsSearchHit[],
    _agentId: string,
  ): Promise<MemorySearchResult[]> {
    if (hits.length === 0) return []

    const ids = hits.map((h) => h.id)
    const rows = await this.memoryRepo.findByIds(ids)
    const rowMap = new Map(rows.map((r) => [r.id, r]))

    return hits
      .map((hit) => {
        const row = rowMap.get(hit.id)
        if (!row) return null
        return {
          id: hit.id,
          content: row.content,
          score: hit.score,
          tags: row.tags ?? '',
          importance: row.importance ?? 1,
          source: row.source ?? 'desktop',
          type: row.type ?? 'event',
          timestamp: row.timestamp,
        }
      })
      .filter((r): r is MemorySearchResult => r !== null)
  }
}
