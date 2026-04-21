/**
 * 记忆 Repository
 *
 * SQLite 记忆节点表 (memory_nodes) 的数据访问层。
 * Service 层通过本 Repo 操作记忆，不直接接触 Drizzle ORM。
 *
 * @module packages/backend/src/repositories/memory.repo
 */

import { eq, desc, asc, and, sql, inArray, lt, ne, gte } from 'drizzle-orm'
import { memoryNodes } from '../database/schema'
import type { DrizzleDb } from '../database'

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 创建记忆的输入 */
export interface CreateMemoryInput {
  content: string
  agentId: string
  tags?: string
  clusters?: string
  importance?: number
  baseImportance?: number
  sentiment?: string
  type?: string
  source?: string
  msgTimestamp?: string
  prevId?: number
}

/** 更新记忆的输入 (全部可选) */
export interface UpdateMemoryInput {
  content?: string
  tags?: string
  clusters?: string
  importance?: number
  baseImportance?: number
  accessCount?: number
  lastAccessed?: string
  sentiment?: string
  type?: string
  prevId?: number
  nextId?: number
}

/** 列表查询参数 */
export interface ListMemoriesParams {
  agentId: string
  page?: number
  pageSize?: number
  type?: string
  source?: string
}

// Drizzle 推导的行类型
type MemoryRow = typeof memoryNodes.$inferSelect

// ─────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────

export class MemoryRepository {
  constructor(private db: DrizzleDb) {}

  /** 创建一条记忆，返回完整行 */
  async create(data: CreateMemoryInput): Promise<MemoryRow> {
    const rows = await this.db
      .insert(memoryNodes)
      .values({
        content: data.content,
        agentId: data.agentId,
        tags: data.tags ?? '',
        clusters: data.clusters,
        importance: data.importance ?? 1,
        baseImportance: data.baseImportance ?? 1.0,
        sentiment: data.sentiment ?? 'neutral',
        type: data.type ?? 'event',
        source: data.source ?? 'desktop',
        msgTimestamp: data.msgTimestamp,
        prevId: data.prevId,
      })
      .returning()
    return rows[0]!
  }

  /** 按 ID 查询 */
  async findById(id: number): Promise<MemoryRow | undefined> {
    return this.db.select().from(memoryNodes).where(eq(memoryNodes.id, id)).get()
  }

  /** 按 ID 列表批量查询 */
  async findByIds(ids: number[]): Promise<MemoryRow[]> {
    if (ids.length === 0) return []
    return this.db.select().from(memoryNodes).where(inArray(memoryNodes.id, ids)).all()
  }

  /** 分页列表查询 */
  async list(params: ListMemoriesParams): Promise<{ data: MemoryRow[]; total: number }> {
    const { agentId, page = 1, pageSize = 20, type, source } = params
    const conditions = [eq(memoryNodes.agentId, agentId)]

    if (type) conditions.push(eq(memoryNodes.type, type))
    if (source) conditions.push(eq(memoryNodes.source, source))

    const where = conditions.length === 1 ? conditions[0] : and(...conditions)

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(memoryNodes)
        .where(where)
        .orderBy(desc(memoryNodes.timestamp))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .all(),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(memoryNodes)
        .where(where)
        .get(),
    ])

    return { data, total: countResult?.count ?? 0 }
  }

  /** 更新记忆 */
  async update(id: number, data: UpdateMemoryInput): Promise<MemoryRow | undefined> {
    const [row] = await this.db
      .update(memoryNodes)
      .set(data)
      .where(eq(memoryNodes.id, id))
      .returning()
    return row
  }

  /** 删除记忆 */
  async delete(id: number): Promise<void> {
    await this.db.delete(memoryNodes).where(eq(memoryNodes.id, id))
  }

  /** 批量删除 */
  async deleteMany(ids: number[]): Promise<void> {
    if (ids.length === 0) return
    await this.db.delete(memoryNodes).where(inArray(memoryNodes.id, ids))
  }

  /** 获取最新的一条记忆 (时间链尾部) */
  async findLatest(agentId: string): Promise<MemoryRow | undefined> {
    return this.db
      .select()
      .from(memoryNodes)
      .where(eq(memoryNodes.agentId, agentId))
      .orderBy(desc(memoryNodes.timestamp))
      .limit(1)
      .get()
  }

  /** 按 Agent 获取未标注的记忆 (Reflection 用) */
  async findUntagged(agentId: string, limit = 30): Promise<MemoryRow[]> {
    return this.db
      .select()
      .from(memoryNodes)
      .where(and(eq(memoryNodes.agentId, agentId), eq(memoryNodes.tags, '')))
      .orderBy(asc(memoryNodes.timestamp))
      .limit(limit)
      .all()
  }

  /** 增加访问计数 */
  async incrementAccessCount(id: number): Promise<void> {
    await this.db
      .update(memoryNodes)
      .set({
        accessCount: sql`${memoryNodes.accessCount} + 1`,
        lastAccessed: sql`datetime('now', 'localtime')`,
      })
      .where(eq(memoryNodes.id, id))
  }

  /** 按 msgTimestamp 查询 (用于删除前获取 ID) */
  async findByMsgTimestamp(msgTimestamp: string, agentId: string): Promise<MemoryRow[]> {
    return this.db
      .select()
      .from(memoryNodes)
      .where(and(eq(memoryNodes.msgTimestamp, msgTimestamp), eq(memoryNodes.agentId, agentId)))
      .all()
  }

  /** 按 msgTimestamp 删除 (用于删除某条对话关联的记忆) */
  async deleteByMsgTimestamp(msgTimestamp: string, agentId: string): Promise<void> {
    await this.db
      .delete(memoryNodes)
      .where(and(eq(memoryNodes.msgTimestamp, msgTimestamp), eq(memoryNodes.agentId, agentId)))
  }

  /** 获取低重要性的旧记忆 (退役策略用) */
  async findRetirementCandidates(
    agentId: string,
    importanceThreshold: number,
    limit = 50,
  ): Promise<MemoryRow[]> {
    return this.db
      .select()
      .from(memoryNodes)
      .where(
        and(
          eq(memoryNodes.agentId, agentId),
          lt(memoryNodes.importance, importanceThreshold),
          ne(memoryNodes.type, 'reflection'),
          ne(memoryNodes.type, 'summary'),
        ),
      )
      .orderBy(asc(memoryNodes.importance), asc(memoryNodes.timestamp))
      .limit(limit)
      .all()
  }

  /** 获取可整合的候选记忆 (Consolidator 用)
   * 条件: 超过 cutoffMs 时间戳 + 低重要性 + event 类型
   */
  async findConsolidationCandidates(
    agentId: string,
    cutoffMs: number,
    importanceThreshold: number,
    limit = 100,
  ): Promise<MemoryRow[]> {
    return this.db
      .select()
      .from(memoryNodes)
      .where(
        and(
          eq(memoryNodes.agentId, agentId),
          eq(memoryNodes.type, 'event'),
          lt(memoryNodes.timestamp, cutoffMs),
          lt(memoryNodes.importance, importanceThreshold),
        ),
      )
      .orderBy(asc(memoryNodes.timestamp))
      .limit(limit)
      .all()
  }

  /** 获取今日新增的记忆数 (Reflection 降本决策用) */
  async countTodayMemories(agentId: string): Promise<number> {
    const todayStartMs = new Date().setHours(0, 0, 0, 0)
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(memoryNodes)
      .where(and(eq(memoryNodes.agentId, agentId), gte(memoryNodes.timestamp, todayStartMs)))
      .get()
    return result?.count ?? 0
  }

  /**
   * 更新检索质量分数 (PEDSA 反馈闭环)
   *
   * @param delta 增量 (正=有用, 负=无效)
   */
  async updateRetrievalQuality(id: number, delta: number): Promise<void> {
    await this.db
      .update(memoryNodes)
      .set({
        retrievalQuality: sql`COALESCE(${memoryNodes.retrievalQuality}, 0.0) + ${delta}`,
      })
      .where(eq(memoryNodes.id, id))
  }

  /** 按标签模糊搜索 */
  async findByTags(agentId: string, tag: string, limit = 20): Promise<MemoryRow[]> {
    return this.db
      .select()
      .from(memoryNodes)
      .where(
        and(eq(memoryNodes.agentId, agentId), sql`${memoryNodes.tags} LIKE ${'%' + tag + '%'}`),
      )
      .orderBy(desc(memoryNodes.timestamp))
      .limit(limit)
      .all()
  }

  /** 统计某时间戳之后的记忆数 (Reflection 降本决策用) */
  async countSince(agentId: string, sinceMs: number): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(memoryNodes)
      .where(and(eq(memoryNodes.agentId, agentId), gte(memoryNodes.timestamp, sinceMs)))
      .get()
    return result?.count ?? 0
  }

  /** 列出所有不重复的 Agent ID */
  async listDistinctAgentIds(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ agentId: memoryNodes.agentId })
      .from(memoryNodes)
      .all()
    return rows.map((r) => r.agentId).filter(Boolean)
  }

  /** 统计某类型的记忆总数 */
  async countByType(agentId: string, type: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(memoryNodes)
      .where(and(eq(memoryNodes.agentId, agentId), eq(memoryNodes.type, type)))
      .get()
    return result?.count ?? 0
  }

  /** 获取超出容量边界的旧记忆 (RetirementPolicy 容量退役用) */
  async findOverflowMemories(
    agentId: string,
    type: string,
    offset: number,
    limit: number,
  ): Promise<MemoryRow[]> {
    return this.db
      .select()
      .from(memoryNodes)
      .where(and(eq(memoryNodes.agentId, agentId), eq(memoryNodes.type, type)))
      .orderBy(desc(memoryNodes.timestamp))
      .offset(offset)
      .limit(limit)
      .all()
  }

  /**
   * 查找孤独记忆 (长期未被检索命中)
   *
   * 条件: accessCount === 0 且 timestamp < thresholdMs
   * 用于 lifecycle/cron/lonelyScan。
   */
  async findLonelyMemories(agentId: string, thresholdMs: number, limit = 50): Promise<MemoryRow[]> {
    return this.db
      .select()
      .from(memoryNodes)
      .where(
        and(
          eq(memoryNodes.agentId, agentId),
          eq(memoryNodes.accessCount, 0),
          lt(memoryNodes.timestamp, thresholdMs),
          ne(memoryNodes.type, 'reflection'),
          ne(memoryNodes.type, 'summary'),
        ),
      )
      .orderBy(asc(memoryNodes.timestamp))
      .limit(limit)
      .all()
  }

  /**
   * 更新记忆元数据 (JSON 扩展字段)
   *
   * 将 metadata 合并写入 clusters 字段 (临时方案，后续可扩展 schema)。
   */
  async updateMetadata(id: number, metadata: Record<string, unknown>): Promise<void> {
    const existing = await this.findById(id)
    if (!existing) return

    // 合并到 clusters 字段 (JSON 序列化)
    let currentMeta: Record<string, unknown> = {}
    if (existing.clusters) {
      try {
        currentMeta = JSON.parse(existing.clusters)
      } catch {
        /* 忽略解析失败 */
      }
    }

    const merged = { ...currentMeta, ...metadata }
    await this.db
      .update(memoryNodes)
      .set({ clusters: JSON.stringify(merged) })
      .where(eq(memoryNodes.id, id))
  }
}
