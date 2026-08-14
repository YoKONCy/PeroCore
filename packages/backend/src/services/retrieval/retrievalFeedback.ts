/**
 * RetrievalFeedback — 检索反馈闭环
 *
 * LLM 回复后，通过 Jaccard 共现词匹配判定注入的记忆是否被使用，
 * 反馈给 retrieval_quality 字段和 ContextRNN 训练系统。
 *
 * 零 Token 开销 — 不需要 LLM 二次判定。
 *
 * @module packages/backend/src/services/retrieval/retrievalFeedback
 */

import type { MemoryRepository } from '../../repositories/memory.repo'
import type { TrainingSample } from '@infos/nit-runtime'
import type { ContextRnn } from './contextRnn'
import { minGruTrain } from '@infos/nit-runtime'
import { createLogger } from '../../lib/logger'

const logger = createLogger('RetrievalFeedback')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 反馈信号 */
export interface FeedbackSignal {
  /** 记忆 ID */
  memoryId: number
  /** 是否被 LLM 引用 */
  isPositive: boolean
  /** Jaccard 相似度 (0~1，调试用) */
  jaccardScore: number
}

/** 反馈配置 */
export interface FeedbackConfig {
  /** positive 判定阈值 (Jaccard ≥ 此值即为 positive) */
  positiveThreshold: number
  /** positive 时 retrieval_quality 增量 */
  positiveDelta: number
  /** negative 时 retrieval_quality 衰减 (负数) */
  negativeDelta: number
  /** 积累多少条反馈后触发 RNN 训练 */
  trainBatchSize: number
}

const DEFAULT_CONFIG: FeedbackConfig = {
  positiveThreshold: 0.15,
  positiveDelta: 0.1,
  negativeDelta: -0.05,
  trainBatchSize: 20,
}

/** 注入到 prompt 的记忆信息 */
export interface InjectedMemory {
  /** 记忆 ID */
  id: number
  /** 记忆内容 */
  content: string
  /** 检索时的查询向量 embedding */
  queryEmbedding?: Float32Array
  /** 检索时的 RNN 隐状态 */
  hiddenState?: Float32Array
  /** 检索时的 CCSA diffusion bias (W_out · h_t)，用于 W_out 训练 */
  contextBias?: Float32Array
  /** 记忆节点的 embedding 向量，用于 W_out 训练的 target */
  memoryEmbedding?: Float32Array
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class RetrievalFeedback {
  private config: FeedbackConfig
  private memoryRepo: MemoryRepository
  private contextRnn: ContextRnn | null

  /** 累积训练样本 (等待 batch 触发) */
  private trainingSamples: TrainingSample[] = []

  /** 历史反馈统计 */
  private stats = {
    totalSignals: 0,
    positiveCount: 0,
    negativeCount: 0,
    trainTriggers: 0,
    lastTrainLoss: 0,
    wOutUpdates: 0, // CCSA: W_out 更新次数
  }

  constructor(
    memoryRepo: MemoryRepository,
    config?: Partial<FeedbackConfig>,
    contextRnn?: ContextRnn,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.memoryRepo = memoryRepo
    this.contextRnn = contextRnn ?? null
  }

  /**
   * 采集反馈信号
   *
   * LLM 回复后，对比注入的记忆内容与 LLM 回复的共现词，
   * 判定每条记忆是 positive 还是negative。
   */
  collectSignals(injectedMemories: InjectedMemory[], llmReply: string): FeedbackSignal[] {
    if (injectedMemories.length === 0 || !llmReply.trim()) return []

    // 预处理 LLM 回复的词集
    const replyTokens = tokenize(llmReply)

    const signals: FeedbackSignal[] = []

    for (const mem of injectedMemories) {
      const memTokens = tokenize(mem.content)

      // Jaccard 相似度
      const jaccardScore = jaccardSimilarity(memTokens, replyTokens)

      // 判定
      const isPositive = jaccardScore >= this.config.positiveThreshold

      signals.push({
        memoryId: mem.id,
        isPositive,
        jaccardScore,
      })
    }

    return signals
  }

  /**
   * 应用反馈信号
   *
   * 1. 更新 retrieval_quality 字段 (SQLite)
   * 2. 积累 RNN 训练样本
   * 3. 达到 batch 阈值时触发训练
   */
  async applyFeedback(
    signals: FeedbackSignal[],
    injectedMemories: InjectedMemory[],
  ): Promise<void> {
    if (signals.length === 0) return

    // 构建 ID → InjectedMemory 映射
    const memMap = new Map(injectedMemories.map((m) => [m.id, m]))

    for (const signal of signals) {
      // 1. 更新 retrieval_quality
      const delta = signal.isPositive ? this.config.positiveDelta : this.config.negativeDelta

      await this.memoryRepo.updateRetrievalQuality(signal.memoryId, delta)

      // 2. 积累训练样本
      const mem = memMap.get(signal.memoryId)
      if (mem?.hiddenState && mem?.queryEmbedding) {
        this.trainingSamples.push({
          hiddenState: mem.hiddenState,
          queryEmbedding: mem.queryEmbedding,
          label: signal.isPositive ? 1 : 0,
        })
      }

      // 2b. CCSA: W_out 在线更新
      // 当携带 contextBias + memoryEmbedding 且有 ContextRnn 实例时，利用反馈信号微调 W_out
      if (mem?.contextBias && mem?.hiddenState && mem?.memoryEmbedding && this.contextRnn) {
        this.contextRnn.updateOutputWeights(
          mem.hiddenState,
          mem.contextBias,
          mem.memoryEmbedding,
          signal.isPositive,
        )
        this.stats.wOutUpdates++
      }

      // 统计
      this.stats.totalSignals++
      if (signal.isPositive) {
        this.stats.positiveCount++
      } else {
        this.stats.negativeCount++
      }
    }

    // 3. 检查是否触发训练
    await this.triggerTrainingIfReady()

    logger.debug(
      `反馈已应用: ${signals.length} 信号 ` +
        `(positive=${signals.filter((s) => s.isPositive).length}, ` +
        `negative=${signals.filter((s) => !s.isPositive).length})`,
    )
  }

  /**
   * 积累够 batch 后触发 minGRU 在线训练
   */
  async triggerTrainingIfReady(): Promise<boolean> {
    if (this.trainingSamples.length < this.config.trainBatchSize) return false

    logger.info(`触发 ContextRNN 在线训练: ${this.trainingSamples.length} 样本`)

    try {
      const loss = minGruTrain(this.trainingSamples, 0.001)

      this.stats.trainTriggers++
      this.stats.lastTrainLoss = loss

      logger.info(`RNN 训练完成: loss=${loss.toFixed(4)}`)
    } catch (err) {
      logger.warn(`RNN 训练失败: ${err}`)
    }

    // 清空样本
    this.trainingSamples = []
    return true
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      pendingSamples: this.trainingSamples.length,
      positiveRate:
        this.stats.totalSignals > 0
          ? ((this.stats.positiveCount / this.stats.totalSignals) * 100).toFixed(1) + '%'
          : 'N/A',
    }
  }
}

// ─────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────

/**
 * 中英文混合分词
 *
 * 简单策略: 按空格/标点分割 + 连续中文字符 2-gram
 */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>()

  // 英文/数字按空格分词
  const words = text.toLowerCase().split(/[\s,，.。!！?？;；:：()（）[]【】{}""'''"]+/)
  for (const w of words) {
    const trimmed = w.trim()
    if (trimmed.length >= 2) {
      tokens.add(trimmed)
    }
  }

  // 中文 2-gram (滑动窗口)
  const cjkChars = text.replace(/[^\u4e00-\u9fff]/g, '')
  for (let i = 0; i < cjkChars.length - 1; i++) {
    tokens.add(cjkChars.slice(i, i + 2))
  }

  return tokens
}

/**
 * Jaccard 相似度
 *
 * |A ∩ B| / |A ∪ B|
 */
function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }

  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}
