/**
 * fileSnapshot.repo — 持久化仓储
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { DrizzleDb } from '../database'
import { fileChangeSnapshots, threadMessages, threads } from '../database/schema'

export type FileChangeOperation = 'modify' | 'create' | 'delete' | 'rename'

export interface FileSnapshotInput {
  id: string
  threadId: string
  pairId: string
  callId: string
  filePath: string
  operation: FileChangeOperation
  renameTargetPath?: string
  originalContent?: string
  originalSha256?: string
  finalSha256?: string
}

/** 文件变更快照与 rewind 查询仓储。 */
export class FileSnapshotRepository {
  constructor(private readonly db: DrizzleDb) {}

  /**
   * 同一轮同一文件只保留第一次修改前快照；后续调用只更新最终状态和 callId。
   */
  async upsert(input: FileSnapshotInput): Promise<void> {
    await this.db
      .insert(fileChangeSnapshots)
      .values({
        id: input.id,
        threadId: input.threadId,
        pairId: input.pairId,
        callId: input.callId,
        filePath: input.filePath,
        operation: input.operation,
        renameTargetPath: input.renameTargetPath,
        originalContent: input.originalContent,
        originalSha256: input.originalSha256,
        finalSha256: input.finalSha256,
      })
      .onConflictDoUpdate({
        target: [fileChangeSnapshots.pairId, fileChangeSnapshots.filePath],
        set: {
          callId: input.callId,
          finalSha256: input.finalSha256,
          updatedAt: sql`(datetime('now', 'localtime'))`,
        },
      })
  }

  /** 获取目标消息所属 Thread 与轮次，严格校验归属，并规范化到该 Pair 的最早消息。 */
  async getRewindTarget(threadId: string, messageId: number) {
    const current = (
      await this.db
        .select({
          threadId: threadMessages.threadId,
          pairId: threadMessages.pairId,
          timestamp: threadMessages.timestamp,
          id: threadMessages.id,
        })
        .from(threadMessages)
        .where(
          and(
            eq(threadMessages.id, messageId),
            eq(threadMessages.threadId, threadId),
            ne(threadMessages.status, 'deleted'),
          ),
        )
        .limit(1)
    )[0]
    if (!current?.pairId) return current ?? null
    return (
      (
        await this.db
          .select({
            threadId: threadMessages.threadId,
            pairId: threadMessages.pairId,
            timestamp: threadMessages.timestamp,
            id: threadMessages.id,
          })
          .from(threadMessages)
          .where(
            and(
              eq(threadMessages.threadId, threadId),
              eq(threadMessages.pairId, current.pairId),
              ne(threadMessages.status, 'deleted'),
            ),
          )
          .orderBy(asc(threadMessages.timestamp), asc(threadMessages.id))
          .limit(1)
      )[0] ?? current
    )
  }

  /** 从目标轮次起查询所有活跃 pairId，按时间正序返回。 */
  async listPairIdsFrom(threadId: string, target: { timestamp: string | null; id: number }) {
    const rows = await this.db
      .select({ pairId: threadMessages.pairId })
      .from(threadMessages)
      .where(
        and(
          eq(threadMessages.threadId, threadId),
          ne(threadMessages.status, 'deleted'),
          sql`(${threadMessages.timestamp} > ${target.timestamp} OR (${threadMessages.timestamp} = ${target.timestamp} AND ${threadMessages.id} >= ${target.id}))`,
        ),
      )
      .orderBy(asc(threadMessages.timestamp), asc(threadMessages.id))
    return [
      ...new Set(rows.map((row) => row.pairId).filter((value): value is string => Boolean(value))),
    ]
  }

  /** 统计目标位置之后的对话轮数；旧数据无 pairId 时按 assistant 消息计数。 */
  async countPairsFrom(
    threadId: string,
    target: { timestamp: string | null; id: number },
  ): Promise<number> {
    const rows = await this.db
      .select({ role: threadMessages.role, pairId: threadMessages.pairId })
      .from(threadMessages)
      .where(
        and(
          eq(threadMessages.threadId, threadId),
          ne(threadMessages.status, 'deleted'),
          sql`(${threadMessages.timestamp} > ${target.timestamp} OR (${threadMessages.timestamp} = ${target.timestamp} AND ${threadMessages.id} >= ${target.id}))`,
        ),
      )
    const paired = new Set(
      rows.map((row) => row.pairId).filter((value): value is string => Boolean(value)),
    )
    const legacyAssistants = rows.filter((row) => !row.pairId && row.role === 'assistant').length
    return paired.size + legacyAssistants || (rows.length ? 1 : 0)
  }

  /** 查询 Thread 全部活跃轮次，按时间正序返回。 */
  async listAllPairIds(threadId: string) {
    const rows = await this.db
      .select({ pairId: threadMessages.pairId })
      .from(threadMessages)
      .where(and(eq(threadMessages.threadId, threadId), ne(threadMessages.status, 'deleted')))
      .orderBy(asc(threadMessages.timestamp), asc(threadMessages.id))
    return [
      ...new Set(rows.map((row) => row.pairId).filter((value): value is string => Boolean(value))),
    ]
  }

  async listSnapshots(pairIds: string[]) {
    if (!pairIds.length) return []
    return this.db
      .select()
      .from(fileChangeSnapshots)
      .where(inArray(fileChangeSnapshots.pairId, pairIds))
      .orderBy(desc(fileChangeSnapshots.updatedAt), desc(fileChangeSnapshots.createdAt))
  }

  async getThreadAgent(threadId: string): Promise<string | null> {
    const row = (
      await this.db
        .select({ agentId: threads.agentId })
        .from(threads)
        .where(and(eq(threads.id, threadId), eq(threads.status, 'active')))
        .limit(1)
    )[0]
    return row?.agentId ?? null
  }

  /** 从目标消息起链式软删除 Thread 中所有后续消息（包含 system/tool 等无 pairId 记录）。 */
  async softDeleteFromMessage(
    threadId: string,
    messageId: number,
    deletedBy: string,
  ): Promise<number[]> {
    const target = await this.getRewindTarget(threadId, messageId)
    if (!target?.timestamp) return []
    const rows = await this.db
      .select({ id: threadMessages.id })
      .from(threadMessages)
      .where(
        and(
          eq(threadMessages.threadId, threadId),
          ne(threadMessages.status, 'deleted'),
          sql`(${threadMessages.timestamp} > ${target.timestamp} OR (${threadMessages.timestamp} = ${target.timestamp} AND ${threadMessages.id} >= ${target.id}))`,
        ),
      )
    const ids = rows.map((row) => row.id)
    if (!ids.length) return []
    await this.db
      .update(threadMessages)
      .set({
        status: 'deleted',
        deletedAt: sql`(datetime('now', 'localtime'))`,
        deletedBy,
      })
      .where(inArray(threadMessages.id, ids))
    return ids
  }
}
