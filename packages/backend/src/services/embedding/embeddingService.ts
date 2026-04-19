/**
 * Embedding 门面服务
 *
 * TS 版只保留 API Provider，不再内嵌本地推理 (10_MEMORY_SYSTEM.md §5)。
 * 如需本地推理，通过 Rust N-API 模块以纯 CPU 方式提供。
 *
 * @module packages/backend/src/services/embedding/embeddingService
 */

import { ApiEmbeddingProvider } from './providers/apiProvider'

// ─────────────────────────────────────────────
// Provider 接口
// ─────────────────────────────────────────────

/** Embedding Provider 接口 (10_MEMORY_SYSTEM.md §5.2) */
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
}

// ─────────────────────────────────────────────
// 门面服务
// ─────────────────────────────────────────────

export class EmbeddingService implements EmbeddingProvider {
  private provider: EmbeddingProvider

  constructor(config: EmbeddingConfig) {
    // 唯一的 Provider: 远程 API (OpenAI 兼容)
    this.provider = new ApiEmbeddingProvider(config)
  }

  async embed(texts: string[]): Promise<number[][]> {
    return this.provider.embed(texts)
  }

  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.embed([text])
    return vec ?? []
  }

  getDimension(): number {
    return this.provider.getDimension()
  }
}
