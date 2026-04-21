/**
 * DPDiversity — Context-aware 重排 + 多样性保障
 *
 * 在 TriviumDB searchAdvanced (内置 PPR + FISTA + DPP) 返回的候选集之上，
 * 叠加 ContextRNN 上下文偏置，实现对话轨迹感知的最终排序。
 *
 * 注意: DPP 核心算法已在 TriviumDB Rust 内核中实现，
 * 本模块**不重复实现** DPP 数学，只做 TS 侧的 context-aware 重排。
 *
 * @module packages/backend/src/services/retrieval/dpDiversity
 */

import { createLogger } from '../../lib/logger'

const logger = createLogger('DPDiversity')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 检索候选 (来自 TriviumDB searchAdvanced) */
export interface RetrievalCandidate {
  /** 记忆 ID */
  id: number
  /** TriviumDB 原始相似度得分 */
  vecSim: number
  /** 记忆内容 (用于反馈采集) */
  content: string
  /** 记忆 embedding (用于 context affinity 计算) */
  embedding: number[] | null
  /** retrieval_quality 历史分数 */
  retrievalQuality: number
  /** 元数据 */
  tags: string
  importance: number
  source: string
  type: string
  timestamp: number
  /** 所属 cluster ID (可选) */
  clusterId?: number
  /** cluster 标签 (可选) */
  clusterLabel?: string
}

/** 重排配置 */
export interface RerankConfig {
  /** 向量相似度权重 α */
  vecSimWeight: number
  /** ContextRNN 亲和度权重 β */
  contextWeight: number
  /** retrieval_quality 奖励权重 γ */
  qualityWeight: number
  /** 重要性奖励权重 δ */
  importanceWeight: number
  /** 最终返回 top-K */
  topK: number
}

const DEFAULT_RERANK_CONFIG: RerankConfig = {
  vecSimWeight: 0.5,
  contextWeight: 0.25,
  qualityWeight: 0.15,
  importanceWeight: 0.1,
  topK: 5,
}

/** 重排后的结果 */
export interface RankedCandidate extends RetrievalCandidate {
  /** 最终综合得分 */
  finalScore: number
  /** ContextRNN 亲和度子分数 */
  contextAffinity: number
}

// ─────────────────────────────────────────────
// 核心函数
// ─────────────────────────────────────────────

/**
 * Context-aware 重排
 *
 * finalScore = α × vecSim
 *            + β × contextAffinity
 *            + γ × retrievalQualityBonus
 *            + δ × importanceBonus
 *
 * @param candidates   TriviumDB 超召回的候选集
 * @param contextBias  ContextRNN 生成的 1536 维偏置向量
 * @param config       重排参数
 * @returns 按 finalScore 降序排列的 top-K 结果
 */
export function contextAwareRerank(
  candidates: RetrievalCandidate[],
  contextBias: Float32Array | null,
  config: Partial<RerankConfig> = {},
): RankedCandidate[] {
  const cfg = { ...DEFAULT_RERANK_CONFIG, ...config }

  if (candidates.length === 0) return []

  // 计算每个候选的 contextAffinity
  const ranked: RankedCandidate[] = candidates.map((c) => {
    // ContextRNN 亲和度: dot(contextBias, embedding)
    let contextAffinity = 0
    if (contextBias && c.embedding?.length) {
      contextAffinity = dotProduct(contextBias, c.embedding)
    }

    // retrieval_quality bonus (归一化到 0~1)
    const qualityBonus = sigmoid(c.retrievalQuality)

    // 重要性 bonus (1-10 归一化到 0~1)
    const importanceBonus = Math.min(c.importance, 10) / 10

    // 综合得分
    const finalScore =
      cfg.vecSimWeight * c.vecSim +
      cfg.contextWeight * contextAffinity +
      cfg.qualityWeight * qualityBonus +
      cfg.importanceWeight * importanceBonus

    return { ...c, finalScore, contextAffinity }
  })

  // 按 finalScore 降序排序
  ranked.sort((a, b) => b.finalScore - a.finalScore)

  // 取 top-K
  const result = ranked.slice(0, cfg.topK)

  if (result.length > 0) {
    logger.debug(
      `重排完成: ${candidates.length} 候选 → ${result.length} 结果 ` +
        `(top1: id=${result[0]!.id}, score=${result[0]!.finalScore.toFixed(3)})`,
    )
  }

  return result
}

/**
 * 简单多样性过滤 (MMR 风格)
 *
 * 在 context-aware 重排后，移除与已选记忆过于相似的候选，
 * 保证返回结果的主题多样性。
 *
 * 注意: 如果 TriviumDB searchAdvanced 已启用 DPP，本函数可选跳过。
 */
export function diversityFilter(
  candidates: RankedCandidate[],
  similarityThreshold: number = 0.92,
  maxResults: number = 5,
): RankedCandidate[] {
  if (candidates.length <= 1) return candidates

  const selected: RankedCandidate[] = [candidates[0]!]

  for (let i = 1; i < candidates.length && selected.length < maxResults; i++) {
    const candidate = candidates[i]!

    // 检查与已选记忆的相似度
    let tooSimilar = false
    for (const sel of selected) {
      if (candidate.embedding && sel.embedding) {
        const sim = cosineSimilarity(candidate.embedding, sel.embedding)
        if (sim > similarityThreshold) {
          tooSimilar = true
          break
        }
      }
    }

    if (!tooSimilar) {
      selected.push(candidate)
    }
  }

  return selected
}

// ─────────────────────────────────────────────
// 辅助数学函数
// ─────────────────────────────────────────────

/** 点积 (Float32Array × number[]) */
function dotProduct(a: Float32Array, b: number[]): number {
  let sum = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    sum += a[i]! * b[i]!
  }
  return sum
}

/** 余弦相似度 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** Sigmoid 激活 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}
