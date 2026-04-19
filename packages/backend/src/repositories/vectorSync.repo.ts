/**
 * TriviumDB 补偿同步 Repository
 *
 * 当向量写入/删除失败时，任务入队等待后台重试。
 * 消除 v1 中 10+ 处重复的"写入-失败-补偿"模式 (10_MEMORY_SYSTEM.md §4.1)。
 *
 * @module packages/backend/src/repositories/vectorSync.repo
 */

import { eq, sql } from 'drizzle-orm'
import { triviumSyncTasks } from '../database/schema'
import type { DrizzleDb } from '../database'

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 写入补偿任务输入 */
export interface EnqueueUpsertInput {
  memoryId: number
  agentId: string
  embedding: number[]
  payload: Record<string, unknown>
  storeName?: string
}

/** 删除补偿任务输入 */
export interface EnqueueDeleteInput {
  memoryId: number
  agentId: string
  storeName?: string
}

// Drizzle 推导行类型
type SyncTaskRow = typeof triviumSyncTasks.$inferSelect

// ─────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────

export class VectorSyncRepository {
  constructor(private db: DrizzleDb) {}

  /** 入队写入补偿任务 */
  async enqueueUpsert(data: EnqueueUpsertInput): Promise<void> {
    const dedupeKey = `upsert:${data.memoryId}:${data.storeName ?? 'main'}`

    await this.db
      .insert(triviumSyncTasks)
      .values({
        operation: 'upsert',
        memoryId: data.memoryId,
        storeName: data.storeName ?? 'main',
        dedupeKey,
        payloadJson: JSON.stringify({
          embedding: data.embedding,
          payload: data.payload,
        }),
        status: 'pending',
        agentId: data.agentId,
      })
      .onConflictDoUpdate({
        target: triviumSyncTasks.dedupeKey,
        set: {
          payloadJson: JSON.stringify({
            embedding: data.embedding,
            payload: data.payload,
          }),
          status: 'pending',
          retryCount: 0,
          lastError: null,
          updatedAt: sql`datetime('now', 'localtime')`,
        },
      })
  }

  /** 入队删除补偿任务 */
  async enqueueDelete(data: EnqueueDeleteInput): Promise<void> {
    const dedupeKey = `delete:${data.memoryId}:${data.storeName ?? 'main'}`

    await this.db
      .insert(triviumSyncTasks)
      .values({
        operation: 'delete',
        memoryId: data.memoryId,
        storeName: data.storeName ?? 'main',
        dedupeKey,
        status: 'pending',
        agentId: data.agentId,
      })
      .onConflictDoUpdate({
        target: triviumSyncTasks.dedupeKey,
        set: {
          status: 'pending',
          retryCount: 0,
          lastError: null,
          updatedAt: sql`datetime('now', 'localtime')`,
        },
      })
  }

  /** 获取待处理的补偿任务 */
  async getPending(limit = 50): Promise<SyncTaskRow[]> {
    return this.db
      .select()
      .from(triviumSyncTasks)
      .where(eq(triviumSyncTasks.status, 'pending'))
      .orderBy(triviumSyncTasks.id)
      .limit(limit)
      .all()
  }

  /** 标记任务成功 */
  async markDone(id: number): Promise<void> {
    await this.db
      .update(triviumSyncTasks)
      .set({
        status: 'done',
        updatedAt: sql`datetime('now', 'localtime')`,
      })
      .where(eq(triviumSyncTasks.id, id))
  }

  /** 标记任务失败 + 增加重试计数 */
  async markFailed(id: number, error: string): Promise<void> {
    await this.db
      .update(triviumSyncTasks)
      .set({
        retryCount: sql`${triviumSyncTasks.retryCount} + 1`,
        lastError: error,
        updatedAt: sql`datetime('now', 'localtime')`,
      })
      .where(eq(triviumSyncTasks.id, id))
  }

  /** 清理已完成的旧任务 */
  async cleanupDone(): Promise<void> {
    await this.db.delete(triviumSyncTasks).where(eq(triviumSyncTasks.status, 'done'))
  }
}
