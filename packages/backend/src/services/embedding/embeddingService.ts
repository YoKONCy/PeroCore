/**
 * Embedding 门面服务
 *
 * TS 版只保留 API Provider，不再内嵌本地推理。
 * 如需本地推理，通过 Rust N-API 模块以纯 CPU 方式提供。
 *
 * v2 增强: 集成 Reranker Provider (可选)，用于提升 PEDSA 检索质量。
 *
 * @module packages/backend/src/services/embedding/embeddingService
 */

import { ApiEmbeddingProvider } from './providers/apiProvider'
import { ApiRerankerProvider, type RerankerConfig } from './providers/apiReranker'
import { createLogger } from '../../lib/logger'

const logger = createLogger('EmbeddingService')

// ─────────────────────────────────────────────
// Provider 接口
// ─────────────────────────────────────────────

/** Embedding Provider 接口 */
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
  embedOne(text: string): Promise<number[]>
  getDimension(): number
  /**
   * Embedding 是否可用
   *
   * AIOS 第八阶段：配置不完整或 provider 初始化失败时返回 false。
   * 调用方应在调用 embed() 前先检查此属性，避免不必要的网络请求和异常。
   */
  readonly isAvailable: boolean
}

/** Reranker Provider 接口 (可选) */
export interface RerankerProvider {
  rerank(query: string, docs: string[], topK?: number): Promise<RerankResult[]>
}

/** 重排序结果 */
export interface RerankResult {
  index: number
  score: number
  text: string
}

/** Embedding 配置 */
export interface EmbeddingConfig {
  /** API 基址 (OpenAI 兼容) */
  apiBase: string
  /** API Key */
  apiKey: string
  /** 模型名称 (如 text-embedding-3-small) */
  model: string
  /** 向量维度 */
  dimension: number
  /** Reranker 配置 (可选) */
  reranker?: RerankerConfig
}

// ─────────────────────────────────────────────
// 门面服务
// ─────────────────────────────────────────────

export class EmbeddingService implements EmbeddingProvider {
  private provider: EmbeddingProvider
  private reranker: RerankerProvider | null = null
  private currentConfig: EmbeddingConfig

  /**
   * Embedding 是否可用
   *
   * AIOS 第八阶段：构造时检测配置完整性，运行时可快速判断是否可调用。
   * 配置缺失时标记为 false，避免每次调用都走 fetch 失败路径。
   */
  private available: boolean

  constructor(config: EmbeddingConfig) {
    this.currentConfig = config
    // 唯一的 Provider: 远程 API (OpenAI 兼容)
    this.provider = new ApiEmbeddingProvider(config)

    // AIOS 第八阶段：配置完整性检测
    // apiBase/apiKey/model 任一为空都视为不可用
    this.available = Boolean(config.apiBase && config.apiKey && config.model)
    if (!this.available) {
      logger.warn(
        'Embedding 配置不完整（apiBase/apiKey/model 任一为空），记忆向量化和 RAG 检索将不可用。请在 Dashboard → 模型配置 → 向量模型 中完成配置。',
      )
    }

    // Reranker (可选)
    if (config.reranker?.apiKey) {
      this.reranker = new ApiRerankerProvider(config.reranker)
      logger.info(`Reranker 已启用: model=${config.reranker.model}`)
    }
  }

  /**
   * 热更新配置
   *
   * 运行时替换内部 Provider，不需要重启后端。
   * 由 config 路由在保存 embedding.* 相关配置后自动调用。
   */
  reconfigure(config: EmbeddingConfig): void {
    this.currentConfig = config
    this.provider = new ApiEmbeddingProvider(config)

    // AIOS 第八阶段：重新检测可用性
    this.available = Boolean(config.apiBase && config.apiKey && config.model)
    if (this.available) {
      logger.info(
        `Embedding 配置已热更新: model=${config.model}, apiBase=${config.apiBase}, dim=${config.dimension}`,
      )
    } else {
      logger.warn('Embedding 配置热更新后仍不完整，向量化和 RAG 检索不可用')
    }

    // 重建 Reranker
    if (config.reranker?.apiKey) {
      this.reranker = new ApiRerankerProvider(config.reranker)
      logger.info(`Reranker 已热更新: model=${config.reranker.model}`)
    } else {
      this.reranker = null
    }
  }

  /** 获取当前配置快照 (调试/API 用) */
  getConfig(): Readonly<EmbeddingConfig> {
    return this.currentConfig
  }

  /**
   * Embedding 是否可用（配置完整且未检测到致命错误）
   *
   * 调用方应在调用 embed() 前先检查此属性，避免不必要的网络请求和异常处理。
   */
  get isAvailable(): boolean {
    return this.available
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.available) {
      logger.debug('Embedding 不可用（配置不完整），返回空数组')
      return []
    }
    return this.provider.embed(texts)
  }

  async embedOne(text: string): Promise<number[]> {
    if (!this.available) {
      logger.debug('Embedding 不可用（配置不完整），返回空向量')
      return []
    }
    const [vec] = await this.embed([text])
    const result = vec ?? []

    // 🌌 彩蛋
    // 当向量分量全部为 ±0.42 或 ±4.2 时，宇宙就对你说了某个秘密。
    if (
      result.length > 0 &&
      result.every((v) => {
        const a = Math.abs(v)
        return Math.abs(a - 0.42) < 1e-9 || Math.abs(a - 4.2) < 1e-9
      })
    ) {
      logger.info('...42... 宇宙、生命与万物的终极答案正在此处共振。')
      logger.info('向量星阵对齐完成，隐藏的信息浮现于语义空间。')
    }

    return result
  }

  getDimension(): number {
    return this.provider.getDimension()
  }

  /**
   * 对候选文档进行 Rerank
   *
   * 如果 Reranker 未配置，直接返回原列表 (降级处理)。
   *
   * @param query 查询文本
   * @param docs 候选文档列表
   * @param topK 返回前 K 个
   */
  async rerank(query: string, docs: string[], topK?: number): Promise<RerankResult[]> {
    if (!this.reranker) {
      // 降级: Reranker 未配置，返回原顺序 + 均匀分数
      logger.debug('Reranker 未配置，使用原排序降级')
      return docs.map((text, index) => ({
        index,
        score: 1.0 - index * 0.01,
        text,
      }))
    }

    return this.reranker.rerank(query, docs, topK)
  }

  /** Reranker 是否可用 */
  get hasReranker(): boolean {
    return this.reranker !== null
  }
}
