/**
 * attachment.repo — 持久化仓储
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { messageAttachments } from '../database/schema'
import type { DrizzleDb } from '../database'

export type AttachmentRow = typeof messageAttachments.$inferSelect
export type AttachmentKind = 'image' | 'text' | 'audio'

export interface CreateAttachmentInput {
  id: string
  threadId: string
  kind: AttachmentKind
  originalName: string
  mimeType: string
  sizeBytes: number
  sha256: string
  storageKey: string
  extractedText?: string
  tokenEstimate?: number
}

export class AttachmentRepository {
  constructor(private readonly db: DrizzleDb) {}

  async create(data: CreateAttachmentInput): Promise<AttachmentRow> {
    const rows = await this.db.insert(messageAttachments).values(data).returning()
    return rows[0]!
  }

  async findById(id: string): Promise<AttachmentRow | undefined> {
    return (
      await this.db.select().from(messageAttachments).where(eq(messageAttachments.id, id)).limit(1)
    )[0]
  }

  async findByIds(ids: string[]): Promise<AttachmentRow[]> {
    return ids.length
      ? this.db.select().from(messageAttachments).where(inArray(messageAttachments.id, ids))
      : []
  }

  async listByMessageIds(messageIds: number[]): Promise<AttachmentRow[]> {
    return messageIds.length
      ? this.db
          .select()
          .from(messageAttachments)
          .where(
            and(
              inArray(messageAttachments.messageId, messageIds),
              eq(messageAttachments.status, 'bound'),
            ),
          )
      : []
  }

  async bind(ids: string[], threadId: string, messageId: number): Promise<number> {
    if (!ids.length) return 0
    const result = await this.db
      .update(messageAttachments)
      .set({
        messageId,
        status: 'bound',
        boundAt: sql`datetime('now', 'localtime')`,
      })
      .where(
        and(
          inArray(messageAttachments.id, ids),
          eq(messageAttachments.threadId, threadId),
          eq(messageAttachments.status, 'uploaded'),
          isNull(messageAttachments.messageId),
        ),
      )
    return result.changes
  }

  async softDeleteByMessageIds(messageIds: number[]): Promise<void> {
    if (!messageIds.length) return
    await this.db
      .update(messageAttachments)
      .set({
        status: 'deleted',
        deletedAt: sql`datetime('now', 'localtime')`,
      })
      .where(inArray(messageAttachments.messageId, messageIds))
  }

  async markDeletedUnbound(id: string): Promise<boolean> {
    const result = await this.db
      .update(messageAttachments)
      .set({
        status: 'deleted',
        deletedAt: sql`datetime('now', 'localtime')`,
      })
      .where(
        and(
          eq(messageAttachments.id, id),
          eq(messageAttachments.status, 'uploaded'),
          isNull(messageAttachments.messageId),
        ),
      )
    return result.changes === 1
  }
}
