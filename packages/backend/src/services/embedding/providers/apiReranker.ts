/**
 * API Reranker Provider — OpenAI/Cohere/Jina 兼容
 *
 * 支持所有走 /v1/rerank 或 /rerank 端点的 Reranker 服务:
 * - Cohere Rerank v3
 * - Jina Reranker
 * - SiliconFlow / DashScope 等国内服务商
 *
 * 含超时保护、AppError 错误处理、top_k 裁剪。
 *
 * @see D27 — Embedding/Reranker/ASR 外部 API 为主
 * @module packages/backend/src/services/embedding/providers/apiReranker
 */

import { AppError } from '../../../lib/appError'
import { createLogger } from '../../../lib/logger'
import type { RerankerProvider, RerankResult } from '../embeddingService'

const logger = createLogger('ApiReranker')

/** Reranker 配置 */
export interface RerankerConfig {
  /** API 基址 (如 https://api.cohere.ai/v2) */
  apiBase: string
  /** API Key */
  apiKey: string
  /** 模型名 (如 rerank-v3.5) */
  model: string
  /** 默认返回的 top-K 数量 */
  defaultTopK: number
}

export class ApiRerankerProvider implements RerankerProvider {
  constructor(private config: RerankerConfig) {
    logger.info(`Reranker 初始化: model=${config.model}, base=${config.apiBase}`)
  }

  /**
   * 对文档列表进行重排序
   *
   * @param query - 查询文本
   * @param docs - 候选文档列表
   * @param topK - 返回前 K 个结果 (默认 config.defaultTopK)
   */
  async rerank(query: string, docs: string[], topK?: number): Promise<RerankResult[]> {
    if (docs.length === 0) return []

    const k = topK ?? this.config.defaultTopK
    const url = `${this.config.apiBase.replace(/\/$/, '')}/rerank`

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          query,
          documents: docs,
          top_n: Math.min(k, docs.length),
          return_documents: true,
        }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new AppError('EXTERNAL_ERROR', {
          message: 'Reranker API 请求超时 (30s)',
          data: { service: 'reranker', model: this.config.model },
        })
      }
      throw new AppError('EXTERNAL_ERROR', {
        message: `Reranker 网络错误: ${err instanceof Error ? err.message : String(err)}`,
        data: { service: 'reranker', model: this.config.model },
      })
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '(无法读取响应)')
      const code = response.status === 429 ? 'RATE_LIMITED' : 'EXTERNAL_ERROR'

      logger.error(`Reranker API 失败`, {
        status: response.status,
        body: errBody.slice(0, 300),
        model: this.config.model,
      })

      throw new AppError(code, {
        message: `Reranker API 错误 (${response.status}): ${errBody.slice(0, 200)}`,
        data: { service: 'reranker', model: this.config.model, status: response.status },
      })
    }

    // 解析响应 (Cohere/Jina 通用格式)
    const json = (await response.json()) as RerankApiResponse

    return json.results.map((r) => ({
      index: r.index,
      score: r.relevance_score,
      text: r.document?.text ?? docs[r.index] ?? '',
    }))
  }
}

// ── 内部类型 (兼容 Cohere/Jina 的响应格式) ──

interface RerankApiResponse {
  results: Array<{
    index: number
    relevance_score: number
    document?: { text: string }
  }>
}
