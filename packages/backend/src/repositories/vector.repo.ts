/**
 * 向量 Repository
 *
 * TriviumDB 的数据访问封装。
 * 通过 MemoryStoreRegistry 获取物理隔离的 Store 实例。
 *
 * @module packages/backend/src/repositories/vector.repo
 */

import type { JsSearchHit, JsSearchConfig, JsNodeView } from 'triviumdb'
import type { MemoryStoreRegistry } from './storeRegistry'
import { createLogger } from '../lib/logger'

const logger = createLogger('VectorRepo')

// ─────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────

export class VectorRepository {
  constructor(private storeRegistry: MemoryStoreRegistry) {}

  /**
   * 写入/更新向量节点
   *
   * 使用 insertWithId 以 memoryId 作为 TriviumDB 节点 ID，
   * 确保 SQLite 和 TriviumDB 之间的 ID 一致性。
   */
  async upsert(
    memoryId: number,
    vector: number[],
    payload: Record<string, unknown>,
    agentId: string,
    source: string = 'desktop',
  ): Promise<void> {
    const store = this.storeRegistry.getStoreBySource(agentId, source)

    // 如果已存在则先更新向量和 payload
    const existing = store.get(memoryId)
    if (existing) {
      store.updateVector(memoryId, vector)
      store.updatePayload(memoryId, payload)
    } else {
      store.insertWithId(memoryId, vector, payload)
    }
  }

  /**
   * 建立节点间的有向边 (时间链、语义关联等)
   */
  async link(
    srcId: number,
    dstId: number,
    label: string = 'temporal',
    weight: number = 1.0,
    agentId: string = 'pero',
    source: string = 'desktop',
  ): Promise<void> {
    const store = this.storeRegistry.getStoreBySource(agentId, source)
    store.link(srcId, dstId, label, weight)
  }

  /**
   * 混合检索：向量锚定 + 图谱扩散
   */
  async search(
    queryVector: number[],
    agentId: string,
    source: string = 'desktop',
    topK: number = 5,
    expandDepth: number = 2,
    minScore: number = 0.3,
  ): Promise<JsSearchHit[]> {
    const store = this.storeRegistry.getStoreBySource(agentId, source)
    return store.search(queryVector, topK, expandDepth, minScore)
  }

  /**
   * 认知管线高级检索 (PEDSA 入口)
   */
  async searchAdvanced(
    queryVector: number[],
    agentId: string,
    source: string = 'desktop',
    config?: JsSearchConfig,
  ): Promise<JsSearchHit[]> {
    const store = this.storeRegistry.getStoreBySource(agentId, source)
    return store.searchAdvanced(queryVector, config)
  }

  /**
   * 向量 + 文本双路混合检索
   */
  async searchHybrid(
    queryVector: number[],
    queryText: string,
    agentId: string,
    source: string = 'desktop',
    topK: number = 5,
    expandDepth: number = 2,
    minScore: number = 0.3,
  ): Promise<JsSearchHit[]> {
    const store = this.storeRegistry.getStoreBySource(agentId, source)
    return store.searchHybrid(queryVector, queryText, topK, expandDepth, minScore)
  }

  /** 获取节点信息 */
  async get(
    memoryId: number,
    agentId: string,
    source: string = 'desktop',
  ): Promise<JsNodeView | null> {
    const store = this.storeRegistry.getStoreBySource(agentId, source)
    return store.get(memoryId)
  }

  /** 删除向量节点 */
  async delete(memoryId: number, agentId: string, source: string = 'desktop'): Promise<void> {
    const store = this.storeRegistry.getStoreBySource(agentId, source)
    try {
      store.delete(memoryId)
    } catch (err) {
      // 节点不存在时静默处理
      logger.debug(`向量节点 ${memoryId} 不存在，跳过删除`)
    }
  }

  /** 建立 BM25 文本索引 */
  async indexText(
    memoryId: number,
    text: string,
    agentId: string,
    source: string = 'desktop',
  ): Promise<void> {
    const store = this.storeRegistry.getStoreBySource(agentId, source)
    store.indexText(memoryId, text)
  }

  /** 建立关键词索引 */
  async indexKeyword(
    memoryId: number,
    keyword: string,
    agentId: string,
    source: string = 'desktop',
  ): Promise<void> {
    const store = this.storeRegistry.getStoreBySource(agentId, source)
    store.indexKeyword(memoryId, keyword)
  }

  /** 重编译文本索引 */
  async buildTextIndex(agentId: string, source: string = 'desktop'): Promise<void> {
    const store = this.storeRegistry.getStoreBySource(agentId, source)
    store.buildTextIndex()
  }

  /** 获取邻居节点 */
  async neighbors(
    memoryId: number,
    agentId: string,
    source: string = 'desktop',
    depth: number = 1,
  ): Promise<number[]> {
    const store = this.storeRegistry.getStoreBySource(agentId, source)
    return store.neighbors(memoryId, depth)
  }

  // ── 日记 Store 操作 ──

  /** 写入日记向量节点 */
  async upsertDiary(
    nodeId: number,
    vector: number[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    const store = this.storeRegistry.getDiaryStore()
    const existing = store.get(nodeId)
    if (existing) {
      store.updateVector(nodeId, vector)
      store.updatePayload(nodeId, payload)
    } else {
      store.insertWithId(nodeId, vector, payload)
    }
  }

  /** 日记 Store 检索 */
  async searchDiary(queryVector: number[], topK: number = 5): Promise<JsSearchHit[]> {
    const store = this.storeRegistry.getDiaryStore()
    return store.search(queryVector, topK, 1, 0.3)
  }

  /** 日记 Store 建边 */
  async linkDiary(
    srcId: number,
    dstId: number,
    label: string,
    weight: number = 1.0,
  ): Promise<void> {
    const store = this.storeRegistry.getDiaryStore()
    store.link(srcId, dstId, label, weight)
  }
}
