import { t as __t } from '../../../lib/i18n'
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
import { upstreamHttpError, upstreamWebPage } from '../../../lib/upstreamHttpError'
import { retryAfterMilliseconds } from '../../llm/retryPolicy'
import type { EmbeddingProvider, EmbeddingConfig } from '../embeddingService'

const logger = createLogger('ApiEmbeddingProvider')

/** 单次最大批量大小 (大多数 API 限制 2048 条) */
const MAX_BATCH_SIZE = 256

export class ApiEmbeddingProvider implements EmbeddingProvider {
  /** AIOS 第八阶段：配置完整性标记 */
  private readonly _isAvailable: boolean
  private cooldown?: { retryAt: number; error: AppError }
  private recoveryPending = false
  private requestSequence = 0
  private settledSequence = 0

  constructor(private config: EmbeddingConfig) {
    this._isAvailable = Boolean(config.apiBase && config.apiKey && config.model)
  }

  /** Embedding 是否可用（配置完整） */
  get isAvailable(): boolean {
    return this._isAvailable
  }

  /**
   * 批量向量化
   *
   * 超过 MAX_BATCH_SIZE 时自动分片。
   */
  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return []

    // 分片
    const results: number[][] = []
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE)
      signal?.throwIfAborted()
      const vectors = await this.embedBatch(batch, signal)
      results.push(...vectors)
    }

    return results
  }

  /** 单文本向量化 */
  async embedOne(text: string, signal?: AbortSignal): Promise<number[]> {
    const [vec] = await this.embed([text], signal)
    return vec ?? []
  }

  /** 获取向量维度 */
  getDimension(): number {
    return this.config.dimension
  }

  // ── 内部方法 ──

  /** 冷却期间快速失败，到期后只放行一个恢复探测。 */
  private async embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    signal?.throwIfAborted()
    const failure = this.cooldown
    if (failure && (failure.retryAt > Date.now() || this.recoveryPending)) {
      const remaining = Math.max(0, failure.retryAt - Date.now())
      const stage = this.recoveryPending
        ? '向量服务恢复探测进行中，已暂停并发请求'
        : `向量服务冷却中，约 ${Math.max(1, Math.ceil(remaining / 1000))} 秒后可重试`
      throw new AppError(failure.error.code, {
        message: `${stage}；${failure.error.message}`,
        data: {
          ...(failure.error.data as object),
          cooldown: true,
          retryAt: failure.retryAt,
          retryAfter: remaining,
          retryable: false,
        },
      })
    }
    const recovering = Boolean(failure)
    if (recovering) this.recoveryPending = true
    const sequence = ++this.requestSequence
    try {
      const vectors = await this.requestBatch(texts, signal)
      signal?.throwIfAborted()
      if (sequence >= this.settledSequence) {
        this.settledSequence = sequence
        const previous = this.cooldown
        this.cooldown = undefined
        if (previous)
          logger.info(__t('logs.embedding', '向量服务已恢复，后续请求恢复正常'), {
            model: this.config.model,
          })
      }
      return vectors
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (error instanceof Error && error.name === 'AbortError') throw error
      const failure =
        error instanceof AppError
          ? error
          : new AppError('EMBEDDING_ERROR', {
              message: 'Embedding API 返回了无法解析的响应，请检查服务商接口',
              data: { kind: 'invalid_response' },
            })
      if (sequence >= this.settledSequence) {
        this.settledSequence = sequence
        const data = failure.data as
          | { status?: number; kind?: string; retryAfter?: number; rayId?: string }
          | undefined
        const hardFailure =
          ['challenge', 'html', 'invalid_response'].includes(data?.kind ?? '') ||
          data?.status === 401 ||
          data?.status === 403
        const duration = hardFailure
          ? 300_000
          : Math.max(
              1_000,
              Math.min(30 * 60_000, data?.retryAfter ?? (data?.status === 429 ? 60_000 : 30_000)),
            )
        const alreadyCooling = this.cooldown && this.cooldown.retryAt > Date.now()
        const retryAt = Math.max(this.cooldown?.retryAt ?? 0, Date.now() + duration)
        this.cooldown = { retryAt, error: failure }
        if (!alreadyCooling) {
          logger.warn(__t('logs.embedding', '向量服务暂不可用，已进入请求冷却'), {
            model: this.config.model,
            status: data?.status,
            kind: data?.kind,
            retrySeconds: Math.ceil(duration / 1000),
            reason: failure.message,
            rayId: data?.rayId,
          })
        }
      }
      throw failure
    } finally {
      if (recovering) this.recoveryPending = false
    }
  }

  /** 只做一次真实请求；冷却和恢复探测由外层统一控制，不生成占位零向量。 */
  private async requestBatch(texts: string[], signal?: AbortSignal): Promise<number[][]> {
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
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
          : AbortSignal.timeout(60_000),
      })
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new AppError('EMBEDDING_ERROR', {
          message: 'Embedding API 请求超时 (60s)',
          data: { provider: 'api', model: this.config.model, kind: 'network' },
        })
      }
      throw new AppError('EMBEDDING_ERROR', {
        message: `Embedding 网络错误: ${err instanceof Error ? err.message : String(err)}`,
        data: { provider: 'api', model: this.config.model, kind: 'network' },
      })
    }

    if (!response.ok || upstreamWebPage(response)) {
      const errBody = await response.text().catch(() => '(无法读取响应)')
      const code = response.status === 429 ? 'LLM_RATE_LIMITED' : 'EMBEDDING_ERROR'
      const error = upstreamHttpError(response, errBody, 'Embedding API', code)
      throw new AppError(code, {
        message: error.message,
        data: {
          ...(error.data as object),
          provider: 'api',
          model: this.config.model,
          retryAfter: retryAfterMilliseconds(response.headers?.get('retry-after') ?? null),
        },
      })
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>
    }

    // 按 index 排序确保顺序正确
    if (!json || !Array.isArray(json.data) || json.data.length !== texts.length)
      throw new AppError('EMBEDDING_ERROR', {
        message: 'Embedding 返回的向量数量不正确',
        data: { kind: 'invalid_response' },
      })
    if (json.data.some((item) => !item || !Number.isInteger(item.index)))
      throw new AppError('EMBEDDING_ERROR', {
        message: 'Embedding 返回的向量序号不正确',
        data: { kind: 'invalid_response' },
      })
    const sorted = json.data.sort((a, b) => a.index - b.index)
    for (const [index, item] of sorted.entries()) {
      if (
        item.index !== index ||
        !Array.isArray(item.embedding) ||
        item.embedding.length !== this.config.dimension ||
        item.embedding.some((value) => !Number.isFinite(value))
      )
        throw new AppError('EMBEDDING_ERROR', {
          message: `Embedding 向量无效：配置 ${this.config.dimension} 维，实际 ${item.embedding?.length ?? 0} 维，请检查向量模型配置`,
          data: {
            kind: 'invalid_response',
            expectedDimension: this.config.dimension,
            actualDimension: Array.isArray(item.embedding) ? item.embedding.length : 0,
          },
        })
    }
    return sorted.map((item) => item.embedding)
  }
}
