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

  constructor(config: EmbeddingConfig) {
    this.currentConfig = config
    // 唯一的 Provider: 远程 API (OpenAI 兼容)
    this.provider = new ApiEmbeddingProvider(config)

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
    logger.info(
      `Embedding 配置已热更新: model=${config.model}, apiBase=${config.apiBase}, dim=${config.dimension}`,
    )

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

  async embed(texts: string[]): Promise<number[][]> {
    return this.provider.embed(texts)
  }

  async embedOne(text: string): Promise<number[]> {
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
      console.log('\n🌌 [System] ...42... 宇宙、生命与万物的终极答案正在此处共振。')
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
