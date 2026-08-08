/**
 * CanonicalMemory Repository
 *
 * canonical_memories 表的数据访问层（第五阶段长记忆系统）。
 * 与 memory_nodes 表共存（向后兼容），新写入走此表。
 *
 * 设计要点：
 * - provenance 字段以 JSON 字符串存储，读取时反序列化为 MemoryProvenance 对象
 * - supersedes 字段为 JSON 数组字符串
 * - id 使用 UUID（由调用方生成）
 *
 * @module packages/backend/src/repositories/canonicalMemory.repo
 */

import { eq, desc, and, sql, like, inArray } from 'drizzle-orm'
import { canonicalMemories } from '../database/schema'
import type { DrizzleDb } from '../database'
import type {
  CanonicalMemory,
  MemoryProvenance,
  MemoryType,
  MemoryStatus,
} from '../services/memory/memoryProvider'

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 创建 CanonicalMemory 的输入（id 由调用方生成） */
export interface CreateCanonicalMemoryInput {
  id: string
  agentId: string
  type: MemoryType
  content: string
  summary?: string
  importance?: number
  confidence?: number
  status?: MemoryStatus
  provenance: MemoryProvenance
  supersededBy?: string
  supersedes?: string[]
  vectorId?: string
  createdAt?: string
  updatedAt?: string
}

/** 更新 CanonicalMemory 状态的输入 */
export interface UpdateCanonicalMemoryInput {
  content?: string
  summary?: string
  importance?: number
  confidence?: number
  status?: MemoryStatus
  supersededBy?: string
  supersedes?: string[]
  vectorId?: string
  updatedAt?: string
}

// Drizzle 推导的行类型
type CanonicalMemoryRow = typeof canonicalMemories.$inferSelect

// ─────────────────────────────────────────────
// 行 ↔ 领域对象 转换
// ─────────────────────────────────────────────

/** 将 DB 行反序列化为 CanonicalMemory（解析 JSON 字段） */
function rowToMemory(row: CanonicalMemoryRow): CanonicalMemory {
  let provenance: MemoryProvenance
  try {
    provenance = JSON.parse(row.provenance) as MemoryProvenance
  } catch {
    // 容错：provenance 损坏时构造空 provenance
    provenance = {
      originThreadId: '',
      originMessageIds: [],
      originChannel: 'desktop',
      createdFrom: 'manual',
      createdAt: row.createdAt,
    }
  }

  let supersedes: string[] | undefined
  if (row.supersedes) {
    try {
      supersedes = JSON.parse(row.supersedes) as string[]
    } catch {
      supersedes = undefined
    }
  }

  return {
    id: row.id,
    agentId: row.agentId,
    type: row.type as MemoryType,
    content: row.content,
    summary: row.summary ?? '',
    importance: row.importance ?? 0.5,
    confidence: row.confidence ?? 0.5,
    status: (row.status ?? 'active') as MemoryStatus,
    provenance,
    supersededBy: row.supersededBy ?? undefined,
    supersedes,
    vectorId: row.vectorId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ─────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────

export class CanonicalMemoryRepository {
  constructor(private db: DrizzleDb) {}

  /** 创建一条 CanonicalMemory，返回领域对象 */
  async create(data: CreateCanonicalMemoryInput): Promise<CanonicalMemory> {
    const now = data.createdAt ?? new Date().toISOString()
    const rows = await this.db
      .insert(canonicalMemories)
      .values({
        id: data.id,
        agentId: data.agentId,
        type: data.type,
        content: data.content,
        summary: data.summary,
        importance: data.importance ?? 0.5,
        confidence: data.confidence ?? 0.5,
        status: data.status ?? 'active',
        provenance: JSON.stringify(data.provenance),
        supersededBy: data.supersededBy,
        supersedes: data.supersedes ? JSON.stringify(data.supersedes) : null,
        vectorId: data.vectorId,
        createdAt: now,
        updatedAt: data.updatedAt ?? now,
      })
      .returning()
    return rowToMemory(rows[0]!)
  }

  /** 按 ID 查询 */
  async findById(id: string): Promise<CanonicalMemory | undefined> {
    const rows = await this.db
      .select()
      .from(canonicalMemories)
      .where(eq(canonicalMemories.id, id))
      .limit(1)
    return rows[0] ? rowToMemory(rows[0]) : undefined
  }

  /** 按 Agent 查询所有 active 记忆 */
  async findByAgentId(
    agentId: string,
    options?: { status?: MemoryStatus; limit?: number },
  ): Promise<CanonicalMemory[]> {
    const conditions = [eq(canonicalMemories.agentId, agentId)]
    if (options?.status) {
      conditions.push(eq(canonicalMemories.status, options.status))
    }
    const query = this.db
      .select()
      .from(canonicalMemories)
      .where(and(...conditions))
      .orderBy(desc(canonicalMemories.createdAt))
    if (options?.limit) {
      query.limit(options.limit)
    }
    const rows = await query
    return rows.map(rowToMemory)
  }

  /** 按 content 模糊搜索（简单 LIKE，Gate 去重用） */
  async searchByContent(
    agentId: string,
    keyword: string,
    limit = 20,
  ): Promise<CanonicalMemory[]> {
    const pattern = `%${keyword}%`
    const rows = await this.db
      .select()
      .from(canonicalMemories)
      .where(
        and(
          eq(canonicalMemories.agentId, agentId),
          like(canonicalMemories.content, pattern),
        ),
      )
      .orderBy(desc(canonicalMemories.createdAt))
      .limit(limit)
    return rows.map(rowToMemory)
  }

  /** 按 ID 列表批量查询 */
  async findByIds(ids: string[]): Promise<CanonicalMemory[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select()
      .from(canonicalMemories)
      .where(inArray(canonicalMemories.id, ids))
    return rows.map(rowToMemory)
  }

  /** 更新状态 */
  async updateStatus(
    id: string,
    status: MemoryStatus,
    extra?: { supersededBy?: string; vectorId?: string },
  ): Promise<CanonicalMemory | undefined> {
    const [row] = await this.db
      .update(canonicalMemories)
      .set({
        status,
        supersededBy: extra?.supersededBy,
        vectorId: extra?.vectorId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(canonicalMemories.id, id))
      .returning()
    return row ? rowToMemory(row) : undefined
  }

  /** 通用更新 */
  async update(
    id: string,
    data: UpdateCanonicalMemoryInput,
  ): Promise<CanonicalMemory | undefined> {
    const patch: Record<string, unknown> = {
      updatedAt: data.updatedAt ?? new Date().toISOString(),
    }
    if (data.content !== undefined) patch.content = data.content
    if (data.summary !== undefined) patch.summary = data.summary
    if (data.importance !== undefined) patch.importance = data.importance
    if (data.confidence !== undefined) patch.confidence = data.confidence
    if (data.status !== undefined) patch.status = data.status
    if (data.supersededBy !== undefined) patch.supersededBy = data.supersededBy
    if (data.vectorId !== undefined) patch.vectorId = data.vectorId
    if (data.supersedes !== undefined) {
      patch.supersedes = JSON.stringify(data.supersedes)
    }

    const [row] = await this.db
      .update(canonicalMemories)
      .set(patch)
      .where(eq(canonicalMemories.id, id))
      .returning()
    return row ? rowToMemory(row) : undefined
  }

  /**
   * 按来源 Thread 删除记忆
   *
   * 解析 provenance JSON，匹配 originThreadId。
   * 用于 Thread 删除时清理关联记忆（隐私请求场景）。
   *
   * @returns 删除的行数
   */
  async deleteByThreadId(threadId: string): Promise<number> {
    // SQLite 无法在 WHERE 中直接解析 JSON，先查所有候选再过滤
    // 通过 like 粗过滤减少扫描量
    const rows = await this.db
      .select({ id: canonicalMemories.id, provenance: canonicalMemories.provenance })
      .from(canonicalMemories)
      .where(like(canonicalMemories.provenance, `%${threadId}%`))

    const toDelete: string[] = []
    for (const r of rows) {
      try {
        const prov = JSON.parse(r.provenance) as MemoryProvenance
        if (prov.originThreadId === threadId) {
          toDelete.push(r.id)
        }
      } catch {
        // 忽略解析失败
      }
    }

    if (toDelete.length === 0) return 0
    await this.db
      .delete(canonicalMemories)
      .where(inArray(canonicalMemories.id, toDelete))
    return toDelete.length
  }

  /** 获取最近 N 条记忆（按 createdAt 倒序） */
  async findRecent(agentId: string, limit = 10): Promise<CanonicalMemory[]> {
    const rows = await this.db
      .select()
      .from(canonicalMemories)
      .where(
        and(
          eq(canonicalMemories.agentId, agentId),
          eq(canonicalMemories.status, 'active'),
        ),
      )
      .orderBy(desc(canonicalMemories.createdAt))
      .limit(limit)
    return rows.map(rowToMemory)
  }

  /** 统计某 Agent 的记忆数 */
  async countByAgent(agentId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(canonicalMemories)
      .where(eq(canonicalMemories.agentId, agentId))
      .get()
    return result?.count ?? 0
  }
}
