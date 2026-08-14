/**
 * MemoryCandidate Repository
 *
 * memory_candidates 表的数据访问层（第五阶段长记忆系统）。
 * 候选由 Scorer 写入，待 MemoryGate 审核后转为 CanonicalMemory。
 *
 * @module packages/backend/src/repositories/memoryCandidate.repo
 */

import { eq, desc, and, sql, inArray } from 'drizzle-orm'
import { memoryCandidates } from '../database/schema'
import type { DrizzleDb } from '../database'
import type { MemoryCandidate, MemoryType } from '../services/memory/memoryProvider'

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 创建 MemoryCandidate 的输入（id 由调用方生成） */
export interface CreateMemoryCandidateInput {
  id: string
  agentId: string
  source: 'thread' | 'diary' | 'scheduler' | 'manual'
  originThreadId: string
  originMessageIds: string[]
  summary: string
  evidenceRefs?: string[]
  importance?: number
  confidence?: number
  suggestedType: MemoryType
  status?: 'pending' | 'accepted' | 'rejected' | 'merged'
  createdAt?: string
  processedAt?: string
}

// Drizzle 推导的行类型
type MemoryCandidateRow = typeof memoryCandidates.$inferSelect

// ─────────────────────────────────────────────
// 行 ↔ 领域对象 转换
// ─────────────────────────────────────────────

/** 将 DB 行反序列化为 MemoryCandidate（解析 JSON 字段） */
function rowToCandidate(row: MemoryCandidateRow): MemoryCandidate {
  let originMessageIds: string[] = []
  if (row.originMessageIds) {
    try {
      originMessageIds = JSON.parse(row.originMessageIds) as string[]
    } catch {
      originMessageIds = []
    }
  }

  let evidenceRefs: string[] = []
  if (row.evidenceRefs) {
    try {
      evidenceRefs = JSON.parse(row.evidenceRefs) as string[]
    } catch {
      evidenceRefs = []
    }
  }

  return {
    id: row.id,
    agentId: row.agentId,
    source: row.source as MemoryCandidate['source'],
    originThreadId: row.originThreadId ?? '',
    originMessageIds,
    summary: row.summary,
    evidenceRefs,
    importance: row.importance ?? 0.5,
    confidence: row.confidence ?? 0.5,
    suggestedType: row.suggestedType as MemoryType,
    status: (row.status ?? 'pending') as MemoryCandidate['status'],
    createdAt: row.createdAt,
    processedAt: row.processedAt ?? undefined,
  }
}

// ─────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────

export class MemoryCandidateRepository {
  constructor(private db: DrizzleDb) {}

  /** 创建一条候选，返回领域对象 */
  async create(data: CreateMemoryCandidateInput): Promise<MemoryCandidate> {
    const now = data.createdAt ?? new Date().toISOString()
    const rows = await this.db
      .insert(memoryCandidates)
      .values({
        id: data.id,
        agentId: data.agentId,
        source: data.source,
        originThreadId: data.originThreadId,
        originMessageIds: JSON.stringify(data.originMessageIds),
        summary: data.summary,
        evidenceRefs: data.evidenceRefs ? JSON.stringify(data.evidenceRefs) : null,
        importance: data.importance ?? 0.5,
        confidence: data.confidence ?? 0.5,
        suggestedType: data.suggestedType,
        status: data.status ?? 'pending',
        createdAt: now,
        processedAt: data.processedAt,
      })
      .returning()
    return rowToCandidate(rows[0]!)
  }

  /** 按 ID 查询 */
  async findById(id: string): Promise<MemoryCandidate | undefined> {
    const rows = await this.db
      .select()
      .from(memoryCandidates)
      .where(eq(memoryCandidates.id, id))
      .limit(1)
    return rows[0] ? rowToCandidate(rows[0]) : undefined
  }

  /** 查询所有 pending 候选（按创建时间正序，FIFO） */
  async findPending(limit = 50): Promise<MemoryCandidate[]> {
    const rows = await this.db
      .select()
      .from(memoryCandidates)
      .where(eq(memoryCandidates.status, 'pending'))
      .orderBy(memoryCandidates.createdAt)
      .limit(limit)
    return rows.map(rowToCandidate)
  }

  /** 查询某 Agent 的 pending 候选 */
  async findPendingByAgent(agentId: string, limit = 50): Promise<MemoryCandidate[]> {
    const rows = await this.db
      .select()
      .from(memoryCandidates)
      .where(and(eq(memoryCandidates.agentId, agentId), eq(memoryCandidates.status, 'pending')))
      .orderBy(memoryCandidates.createdAt)
      .limit(limit)
    return rows.map(rowToCandidate)
  }

  /** 更新候选状态 */
  async updateStatus(
    id: string,
    status: 'pending' | 'accepted' | 'rejected' | 'merged',
    processedAt?: string,
  ): Promise<MemoryCandidate | undefined> {
    const [row] = await this.db
      .update(memoryCandidates)
      .set({
        status,
        processedAt: processedAt ?? new Date().toISOString(),
      })
      .where(eq(memoryCandidates.id, id))
      .returning()
    return row ? rowToCandidate(row) : undefined
  }

  /** 按 ID 列表批量查询 */
  async findByIds(ids: string[]): Promise<MemoryCandidate[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select()
      .from(memoryCandidates)
      .where(inArray(memoryCandidates.id, ids))
    return rows.map(rowToCandidate)
  }

  /** 统计某 Agent 的 pending 候选数 */
  async countPendingByAgent(agentId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(memoryCandidates)
      .where(and(eq(memoryCandidates.agentId, agentId), eq(memoryCandidates.status, 'pending')))
      .get()
    return result?.count ?? 0
  }

  /** 按 Thread 查询候选（用于清理或追溯） */
  async findByThreadId(threadId: string): Promise<MemoryCandidate[]> {
    const rows = await this.db
      .select()
      .from(memoryCandidates)
      .where(eq(memoryCandidates.originThreadId, threadId))
      .orderBy(desc(memoryCandidates.createdAt))
    return rows.map(rowToCandidate)
  }
}
