/**
 * API Embedding Provider — OpenAI 兼容
 *
 * 支持 OpenAI / SiliconFlow / DashScope 等所有走 /v1/embeddings 的服务商。
 * 含批量分片、超时保护、AppError 错误处理。
 *
 * @module packages/backend/src/services/embedding/providers/apiProvider
 */

import { AppError } from '../../../lib/appError'
import { createLogger } from '../../../lib/logger'
import type { EmbeddingProvider, EmbeddingConfig } from '../embeddingService'

const logger = createLogger('ApiEmbeddingProvider')

/** 单次最大批量大小 (大多数 API 限制 2048 条) */
const MAX_BATCH_SIZE = 256

export class ApiEmbeddingProvider implements EmbeddingProvider {
  constructor(private config: EmbeddingConfig) {}

  /**
   * 批量向量化
   *
   * 超过 MAX_BATCH_SIZE 时自动分片。
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    // 分片
    const results: number[][] = []
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE)
      const vectors = await this.embedBatch(batch)
      results.push(...vectors)
    }

    return results
  }

  /** 单文本向量化 */
  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.embed([text])
    return vec ?? []
  }

  /** 获取向量维度 */
  getDimension(): number {
    return this.config.dimension
  }

  // ── 内部方法 ──

  /** 执行一次批量 Embedding API 请求 */
  private async embedBatch(texts: string[]): Promise<number[][]> {
    const url = `${this.config.apiBase.replace(/\/$/, '')}/embeddings`

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          input: texts,
          model: this.config.model,
          dimensions: this.config.dimension,
        }),
        signal: AbortSignal.timeout(60_000),
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new AppError('EMBEDDING_ERROR', {
          message: 'Embedding API 请求超时 (60s)',
          data: { provider: 'api', model: this.config.model },
        })
      }
      throw new AppError('EMBEDDING_ERROR', {
        message: `Embedding 网络错误: ${err instanceof Error ? err.message : String(err)}`,
        data: { provider: 'api', model: this.config.model },
      })
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '(无法读取响应)')
      const code = response.status === 429 ? 'LLM_RATE_LIMITED' : 'EMBEDDING_ERROR'

      logger.error(`Embedding API 失败`, {
        status: response.status,
        body: errBody.slice(0, 300),
        model: this.config.model,
      })

      throw new AppError(code, {
        message: `Embedding API 错误 (${response.status}): ${errBody.slice(0, 200)}`,
        data: { provider: 'api', model: this.config.model, status: response.status },
      })
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>
    }

    // 按 index 排序确保顺序正确
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
  }
}
