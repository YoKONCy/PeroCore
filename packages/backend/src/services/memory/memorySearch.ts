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

// ─────────────────────────────────────────────
// Pattern Search fallback 辅助函数
// ─────────────────────────────────────────────

/**
 * CJK 字符范围正则（中日韩统一表意文字 + 平假名 + 片假名 + 谚文）
 *
 * 用于识别需要 bigram 模糊匹配的 CJK 文本。
 */
const CJK_REGEX = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g

/**
 * 从原始查询中提取 Pattern Search 所需的 terms
 *
 * 规则：
 * 1. 按空白与常见标点切分得到 tokens
 * 2. 对 CJK 文本提取 bigrams（相邻两字），避免单字过宽召回
 * 3. 对 ASCII 短词（<3 字符）保留，BM25 对短词召回不足
 * 4. 对 ASCII 长词（>=3 字符）不纳入 pattern search（BM25 已能处理）
 *
 * @param query 原始用户查询
 * @returns 去重后的 terms 列表（CJK bigrams + ASCII 短词）
 */
function extractPatternTerms(query: string): string[] {
  const terms = new Set<string>()

  // 按空白和中英文标点切分
  const tokens = query.split(/[\s,，。.!！?？;；:：、""''""'']+/)
  for (const token of tokens) {
    if (!token) continue

    // 检测是否含 CJK 字符
    const cjkMatches = token.match(CJK_REGEX)
    if (cjkMatches && cjkMatches.length > 0) {
      // CJK 文本：提取 bigrams（按 CJK 字符顺序，跳过非 CJK 字符）
      // 例如 "小猫娘代码" → ["小猫", "猫娘", "娘代", "代码"]
      const cjkChars = cjkMatches
      for (let i = 0; i < cjkChars.length - 1; i++) {
        terms.add(cjkChars[i]! + cjkChars[i + 1]!)
      }
      // 单字 CJK 也保留（如查询仅为 "猫"）
      if (cjkChars.length === 1) {
        terms.add(cjkChars[0]!)
      }
    } else if (token.length < 3) {
      // ASCII 短词（<3 字符）：BM25 召回不足，交给 pattern search
      terms.add(token)
    }
    // ASCII 长词（>=3 字符）不纳入，BM25 已能处理
  }

  return Array.from(terms)
}

/** RRF 融合的单路结果（id + score） */
interface RrfItem {
  id: number
  score: number
}

/**
 * Reciprocal Rank Fusion (RRF) 多路召回融合
 *
 * 公式：fused_score(d) = sum_over_lists( 1 / (k + rank_i(d)) )
 *
 * - k=60 是经典经验值，缓解高排名项的得分垄断
 * - 各路列表内部按 score 倒序作为 rank
 * - 未出现在某路的项，该路贡献为 0
 *
 * @param lists 多路召回结果列表
 * @param k RRF 常数，默认 60
 * @returns 融合后按得分倒序排列的结果
 */
function rrfFuse(lists: RrfItem[][], k = 60): RrfItem[] {
  const scoreMap = new Map<number, number>()

  for (const list of lists) {
    // 该路按 score 倒序确定 rank
    const ranked = [...list].sort((a, b) => b.score - a.score)
    ranked.forEach((item, rank) => {
      const contribution = 1.0 / (k + rank + 1)
      scoreMap.set(item.id, (scoreMap.get(item.id) ?? 0) + contribution)
    })
  }

  return Array.from(scoreMap.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}

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
  /**
   * 基准测试模式（AIOS 第八阶段新增）
   *
   * 开启后：
   * - 跳过 RAG_LIMITS 限制（允许 topK > 8）
   * - 默认 expandDepth=0（禁用图谱扩散，避免噪声污染召回）
   * - 默认 minScore=0（不做相似度过滤，交由评估脚本处理）
   *
   * 适用于 BEIR/MTEB/LongMemEval 等 IR benchmark 评测。
   * 生产环境（陪伴对话）不要开启此模式。
   */
  benchmarkMode?: boolean
}

/** 高级检索参数 (PEDSA 准备) */
export interface AdvancedSearchParams extends SearchParams {
  config?: JsSearchConfig
}

/** 按模式的 RAG 限制（AIOS 第八阶段：清理 work 残留） */
const RAG_LIMITS: Record<string, { memories: number; flashback: number }> = {
  desktop: { memories: 8, flashback: 3 },
  social: { memories: 0, flashback: 0 },
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
   *
   * benchmarkMode 下跳过 RAG_LIMITS、禁用图谱扩散，用于 IR 评测。
   *
   * AIOS 第八阶段：embedding 不可用时优雅返回空，不抛异常。
   *
   * Pattern Search fallback：
   * - 对短词（<3 字符）和 CJK 文本，BM25 召回不足
   * - 通过 SQLite LIKE 模糊匹配补充召回
   * - 使用 RRF 融合向量召回与 Pattern 召回结果
   */
  async search(params: SearchParams): Promise<MemorySearchResult[]> {
    const {
      query,
      agentId,
      source = 'desktop',
      benchmarkMode = false,
    } = params

    // 基准测试模式：expandDepth=0 禁用图谱扩散，minScore=0 不过滤
    const topK = params.topK ?? (benchmarkMode ? 10 : 5)
    const expandDepth = params.expandDepth ?? (benchmarkMode ? 0 : 2)
    const minScore = params.minScore ?? (benchmarkMode ? 0 : 0.3)

    // 生产模式才按 RAG_LIMITS 限制；基准测试模式放行大 topK
    const effectiveTopK = benchmarkMode
      ? topK
      : Math.min(topK, (RAG_LIMITS[source] ?? RAG_LIMITS.desktop!).memories)
    if (effectiveTopK <= 0) return []

    // AIOS 第八阶段：embedding 不可用时优雅降级
    if (!this.embeddingService.isAvailable) {
      logger.warn('Embedding 不可用，语义检索返回空（请配置向量模型）')
      return []
    }

    // 文本 → 向量
    const queryVector = await this.embeddingService.embedOne(query)
    if (!queryVector.length) {
      logger.warn('Embedding 返回空向量，跳过检索')
      return []
    }

    // TriviumDB 向量检索
    const hits = await this.vectorRepo.search(
      queryVector,
      agentId,
      source,
      effectiveTopK,
      expandDepth,
      minScore,
    )

    // Pattern Search fallback：对短词/CJK 文本补充召回
    // 使用 RRF 融合向量召回与 Pattern 召回，避免短词查询漏召回
    const patternTerms = extractPatternTerms(query)
    if (patternTerms.length > 0) {
      // 候选池取 3 倍 effectiveTopK，给 RRF 融合留出余量
      const patternHits = await this.memoryRepo.patternSearch(
        agentId,
        patternTerms,
        effectiveTopK * 3,
      )
      if (patternHits.length > 0) {
        const vectorItems: RrfItem[] = hits.map((h) => ({ id: h.id, score: h.score }))
        const fused = rrfFuse([vectorItems, patternHits])
        // 取前 effectiveTopK 个，构造伪 JsSearchHit 以复用 enrichResults
        const fusedHits: JsSearchHit[] = fused.slice(0, effectiveTopK).map((item) => ({
          id: item.id,
          score: item.score,
          payload: null,
        }))
        return this.enrichResults(fusedHits, agentId)
      }
    }

    return this.enrichResults(hits, agentId)
  }

  /**
   * 高级认知管线检索 (PEDSA 入口)
   *
   * 使用 TriviumDB 的 searchAdvanced API，支持：
   * - FISTA 残差寻隐
   * - PPR 图扩散
   * - DPP 多样性采样
   *
   * AIOS 第八阶段：embedding 不可用时优雅返回空，不抛异常。
   */
  async searchAdvanced(params: AdvancedSearchParams): Promise<MemorySearchResult[]> {
    const { query, agentId, source = 'desktop', config } = params

    // AIOS 第八阶段：embedding 不可用时优雅降级
    if (!this.embeddingService.isAvailable) {
      logger.warn('Embedding 不可用，高级检索返回空（请配置向量模型）')
      return []
    }

    const queryVector = await this.embeddingService.embedOne(query)
    if (!queryVector.length) return []

    const hits = await this.vectorRepo.searchAdvanced(queryVector, agentId, source, config)

    return this.enrichResults(hits, agentId)
  }

  /**
   * 混合检索 (向量 + 文本 BM25)
   *
   * benchmarkMode 下同样跳过 RAG_LIMITS、禁用图谱扩散。
   *
   * AIOS 第八阶段：embedding 不可用时降级为纯 BM25 检索（传零向量），
   * 让用户在未配置向量模型时仍能通过关键词检索记忆。
   *
   * Pattern Search fallback：
   * - BM25 对短词（<3 字符）和 CJK 文本召回不足
   * - 通过 SQLite LIKE 模糊匹配补充召回
   * - 三路 RRF 融合：向量 + BM25 + Pattern
   */
  async searchHybrid(params: SearchParams): Promise<MemorySearchResult[]> {
    const {
      query,
      agentId,
      source = 'desktop',
      benchmarkMode = false,
    } = params

    const topK = params.topK ?? (benchmarkMode ? 10 : 5)
    const expandDepth = params.expandDepth ?? (benchmarkMode ? 0 : 2)
    const minScore = params.minScore ?? (benchmarkMode ? 0 : 0.3)

    // AIOS 第八阶段：embedding 不可用时降级为纯 BM25
    // 传零向量让 TriviumDB 的向量路返回空，BM25 路仍可工作
    let queryVector: number[]
    if (!this.embeddingService.isAvailable) {
      logger.warn('Embedding 不可用，混合检索降级为纯 BM25（请配置向量模型以获得完整检索能力）')
      queryVector = new Array(this.embeddingService.getDimension()).fill(0)
    } else {
      queryVector = await this.embeddingService.embedOne(query)
      if (!queryVector.length) {
        logger.warn('Embedding 返回空向量，混合检索降级为纯 BM25')
        queryVector = new Array(this.embeddingService.getDimension()).fill(0)
      }
    }

    // TriviumDB 混合检索（向量 + BM25 内部融合）
    const hits = await this.vectorRepo.searchHybrid(
      queryVector,
      query,
      agentId,
      source,
      topK,
      expandDepth,
      minScore,
    )

    // Pattern Search fallback：对短词/CJK 文本补充召回
    // BM25 对短词和 CJK 文本召回不足，LIKE 模糊匹配兜底
    // 三路 RRF 融合：TriviumDB 混合召回 + Pattern 召回
    const patternTerms = extractPatternTerms(query)
    if (patternTerms.length > 0) {
      // 候选池取 3 倍 topK，给 RRF 融合留出余量
      const patternHits = await this.memoryRepo.patternSearch(agentId, patternTerms, topK * 3)
      if (patternHits.length > 0) {
        const hybridItems: RrfItem[] = hits.map((h) => ({ id: h.id, score: h.score }))
        const fused = rrfFuse([hybridItems, patternHits])
        // 取前 topK 个，构造伪 JsSearchHit 以复用 enrichResults
        const fusedHits: JsSearchHit[] = fused.slice(0, topK).map((item) => ({
          id: item.id,
          score: item.score,
          payload: null,
        }))
        return this.enrichResults(fusedHits, agentId)
      }
    }

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
    agentId: string,
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
    // AIOS(Phase5): 防御性过滤——跳过不属于该 agentId 的记忆
    return rows
      .filter((row) => row.agentId === agentId)
      .map((row) => ({
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
   *
   * AIOS(Phase5): 按 agentId 防御性过滤，确保不返回其他 Agent 的记忆。
   * 向量检索已物理隔离（不同 Agent 用不同 tdb），此处为双重保险。
   */
  private async enrichResults(
    hits: JsSearchHit[],
    agentId: string,
  ): Promise<MemorySearchResult[]> {
    if (hits.length === 0) return []

    const ids = hits.map((h) => h.id)
    const rows = await this.memoryRepo.findByIds(ids)
    const rowMap = new Map(rows.map((r) => [r.id, r]))

    return hits
      .map((hit) => {
        const row = rowMap.get(hit.id)
        if (!row) return null
        // AIOS(Phase5): 防御性过滤——跳过不属于该 agentId 的记忆
        if (row.agentId !== agentId) return null
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
