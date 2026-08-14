/**
 * 向量写入辅助器
 *
 * 统一向量写入的"写入-失败-补偿"模式。
 * 统一 embedding 生成 → TriviumDB 写入 → 失败入补偿队列的流程。
 *
 * @module packages/backend/src/shared/vectorWriteHelper
 */

import type { VectorRepository } from '../repositories/vector.repo'
import type { VectorSyncRepository } from '../repositories/vectorSync.repo'
import type { EmbeddingProvider } from '../services/embedding/embeddingService'
import { createLogger } from '../lib/logger'

const logger = createLogger('VectorWriteHelper')

// ─────────────────────────────────────────────
// VectorWriteHelper
// ─────────────────────────────────────────────

export class VectorWriteHelper {
  constructor(
    private vectorRepo: VectorRepository,
    private vectorSyncRepo: VectorSyncRepository,
    private embeddingService: EmbeddingProvider,
  ) {}

  /**
   * 生成向量 + 写入 TriviumDB，失败自动入补偿队列
   *
   * Tag 加权：将 tags 前置两次以提升检索时的 tag 权重。
   *
   * AIOS 第八阶段：embedding 不可用时跳过向量写入，
   * 不往补偿队列塞无效数据（补偿队列重试时同样会失败）。
   * 记忆的 SQLite 行和 BM25 索引仍会正常写入，只是无法做向量检索。
   */
  async upsertWithFallback(opts: {
    memoryId: number
    content: string
    tags?: string
    metadata: Record<string, unknown>
    agentId: string
    source?: string
    storeName?: string
  }): Promise<void> {
    // AIOS 第八阶段：embedding 不可用时跳过向量写入
    if (!this.embeddingService.isAvailable) {
      logger.debug(`记忆 ${opts.memoryId} 跳过向量写入（embedding 不可用），仅 SQLite + BM25 可用`)
      return
    }

    // Tag 加权: "料理 美食 料理 美食 今天学了做螺蛳粉..."
    const enriched = opts.tags ? `${opts.tags} ${opts.tags} ${opts.content}` : opts.content

    let vector: number[] | null = null

    try {
      vector = await this.embeddingService.embedOne(enriched)
      if (!vector?.length) throw new Error('embedding 为空')

      await this.vectorRepo.upsert(
        opts.memoryId,
        vector,
        { content: opts.content, ...opts.metadata },
        opts.agentId,
        opts.source ?? 'desktop',
      )
    } catch (err) {
      logger.warn(`向量写入失败，入补偿队列: ${err}`)
      await this.vectorSyncRepo.enqueueUpsert({
        memoryId: opts.memoryId,
        agentId: opts.agentId,
        embedding: vector ?? [],
        payload: opts.metadata,
        storeName: opts.storeName ?? 'main',
      })
    }
  }

  /**
   * 删除向量，失败自动入补偿队列
   */
  async deleteWithFallback(
    memoryId: number,
    agentId: string,
    source: string = 'desktop',
  ): Promise<void> {
    try {
      await this.vectorRepo.delete(memoryId, agentId, source)
    } catch (err) {
      logger.warn(`向量删除失败，入补偿队列: ${err}`)
      await this.vectorSyncRepo.enqueueDelete({ memoryId, agentId })
    }
  }
}
