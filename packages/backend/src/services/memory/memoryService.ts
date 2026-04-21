/**
 * 记忆 Service — 核心 CRUD 编排
 *
 * 纯业务编排层：协调 MemoryRepo + VectorWriteHelper 完成记忆的增删改。
 * 不直接操作 Drizzle 或 TriviumDB。
 *
 * @module packages/backend/src/services/memory/memoryService
 */

import type {
  MemoryRepository,
  CreateMemoryInput,
  UpdateMemoryInput,
} from '../../repositories/memory.repo'
import type { VectorWriteHelper } from '../../shared/vectorWriteHelper'
import type { VectorRepository } from '../../repositories/vector.repo'
import { createLogger } from '../../lib/logger'

const logger = createLogger('MemoryService')

// Drizzle 推的行类型
type MemoryRow = Awaited<ReturnType<MemoryRepository['findById']>>

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class MemoryService {
  constructor(
    private memoryRepo: MemoryRepository,
    private vectorRepo: VectorRepository,
    private vectorWriteHelper: VectorWriteHelper,
  ) {}

  /**
   * 创建记忆 + 向量写入 + 时间链串联
   *
   * 完整流程:
   * 1. SQLite 写入
   * 2. 向量生成 + TriviumDB 写入 (失败入补偿队列)
   * 3. 建立时间链 (temporal edge)
   * 4. 建立文本索引 (BM25)
   */
  async create(data: CreateMemoryInput): Promise<NonNullable<MemoryRow>> {
    // 1. SQLite 写入
    const memory = await this.memoryRepo.create(data)
    logger.debug(`记忆已创建: id=${memory.id}`, { type: data.type, source: data.source })

    // 2. 向量写入 (含补偿)
    await this.vectorWriteHelper.upsertWithFallback({
      memoryId: memory.id,
      content: memory.content,
      tags: memory.tags ?? undefined,
      metadata: {
        agentId: memory.agentId,
        importance: memory.importance,
        type: memory.type,
        source: memory.source,
        timestamp: memory.timestamp,
      },
      agentId: memory.agentId,
      source: memory.source ?? 'desktop',
    })

    // 3. 时间链串联
    if (data.prevId) {
      await this.vectorRepo.link(
        data.prevId,
        memory.id,
        'temporal',
        0.2,
        memory.agentId,
        memory.source ?? 'desktop',
      )
      // 更新前一条记忆的 nextId
      await this.memoryRepo.update(data.prevId, { nextId: memory.id })
    } else {
      // 自动查找时间链尾部
      const latest = await this.memoryRepo.findLatest(memory.agentId)
      if (latest && latest.id !== memory.id) {
        await this.vectorRepo.link(
          latest.id,
          memory.id,
          'temporal',
          0.2,
          memory.agentId,
          memory.source ?? 'desktop',
        )
        await this.memoryRepo.update(latest.id, { nextId: memory.id })
        await this.memoryRepo.update(memory.id, { prevId: latest.id })
      }
    }

    // 4. 文本索引 (用于 BM25 混合检索)
    await this.vectorRepo.indexText(
      memory.id,
      memory.content,
      memory.agentId,
      memory.source ?? 'desktop',
    )

    return memory
  }

  /** 获取单条记忆 */
  async getById(id: number): Promise<MemoryRow> {
    return this.memoryRepo.findById(id)
  }

  /** 分页列表 */
  async list(params: {
    agentId: string
    page?: number
    pageSize?: number
    type?: string
    source?: string
  }) {
    return this.memoryRepo.list(params)
  }

  /** 更新记忆内容 (同步更新向量) */
  async update(id: number, data: UpdateMemoryInput, agentId: string): Promise<MemoryRow> {
    const updated = await this.memoryRepo.update(id, data)
    if (!updated) throw new Error(`记忆 ${id} 不存在`)

    // 如果内容变更，需要重新生成向量
    if (data.content) {
      await this.vectorWriteHelper.upsertWithFallback({
        memoryId: id,
        content: data.content,
        tags: data.tags ?? updated.tags ?? undefined,
        metadata: {
          agentId,
          importance: updated.importance,
          type: updated.type,
          source: updated.source,
        },
        agentId,
        source: updated.source ?? 'desktop',
      })
    }

    return updated
  }

  /** 删除记忆 (同步删除向量) */
  async delete(id: number, agentId: string, source: string = 'desktop'): Promise<void> {
    // 先取记忆信息，用于修复时间链
    const memory = await this.memoryRepo.findById(id)
    if (!memory) return

    // 修复时间链
    if (memory.prevId) {
      await this.memoryRepo.update(memory.prevId, { nextId: memory.nextId ?? undefined })
    }
    if (memory.nextId) {
      await this.memoryRepo.update(memory.nextId, { prevId: memory.prevId ?? undefined })
    }

    // 删除 SQLite 行
    await this.memoryRepo.delete(id)

    // 删除向量 (含补偿)
    await this.vectorWriteHelper.deleteWithFallback(id, agentId, source)

    logger.debug(`记忆已删除: id=${id}`)
  }

  /** 按消息时间戳删除 (同步清理向量) */
  async deleteByMsgTimestamp(msgTimestamp: string, agentId: string): Promise<void> {
    // 先查出受影响的记忆 ID
    const affected = await this.memoryRepo.findByMsgTimestamp(msgTimestamp, agentId)

    // 删除 SQLite 行
    await this.memoryRepo.deleteByMsgTimestamp(msgTimestamp, agentId)

    // 同步删除向量
    for (const memory of affected) {
      await this.vectorWriteHelper.deleteWithFallback(
        memory.id,
        agentId,
        memory.source ?? 'desktop',
      )
    }

    if (affected.length > 0) {
      logger.debug(`按 msgTimestamp 删除了 ${affected.length} 条记忆`)
    }
  }

  /**
   * 获取记忆图谱数据
   *
   * 返回节点 (记忆) + 连线 (关联关系) 的 force-directed graph 数据。
   */
  async getGraph(agentId: string, limit = 100) {
    // 1. 查出最新的 N 条记忆
    const result = await this.memoryRepo.list({ agentId, page: 1, pageSize: limit })
    const memories = result.data

    // 2. 构建节点
    const nodes = memories.map((m) => ({
      id: m.id,
      name: String(m.id),
      value: m.importance ?? 5,
      category: m.type ?? 'event',
      sentiment: m.sentiment ?? 'neutral',
      full_content: m.content,
    }))

    // 3. 收集所有连线 (temporal + 语义关联)
    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges: Array<{
      source: number
      target: number
      value: number
      relation_type: string
    }> = []

    // 利用时间链构建 temporal 连线
    for (const m of memories) {
      if (m.nextId && nodeIds.has(m.nextId)) {
        edges.push({
          source: m.id,
          target: m.nextId,
          value: 1,
          relation_type: 'temporal',
        })
      }
    }

    logger.debug(`图谱数据: ${nodes.length} 节点, ${edges.length} 连线`)

    return { nodes, edges }
  }

  /** 增加访问计数 */
  async markAccessed(id: number): Promise<void> {
    await this.memoryRepo.incrementAccessCount(id)
  }
}
