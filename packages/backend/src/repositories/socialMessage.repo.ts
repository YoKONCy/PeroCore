/**
 * SocialMessage Repository — 社交消息数据访问
 *
 * 提供社交消息的 CRUD 操作（Repository 层）。
 * 操作的是 social_messages 表，存储平台原始消息。
 *
 * @module packages/backend/src/repositories/socialMessage.repo
 */

import { desc, eq, and, sql, count as drizzleCount } from 'drizzle-orm'
import { socialMessages } from '../database/schema'
import type { DrizzleDb } from '../database'

export class SocialMessageRepository {
  constructor(private db: DrizzleDb) {}

  /**
   * 插入一条社交消息
   */
  async insert(msg: {
    msgId: string
    platform: string
    channelId: string
    channelType: string
    senderId: string
    senderName: string
    content: string
    agentId: string
    rawEventJson?: string
  }): Promise<void> {
    await this.db.insert(socialMessages).values({
      msgId: msg.msgId,
      platform: msg.platform,
      channelId: msg.channelId,
      channelType: msg.channelType,
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content,
      agentId: msg.agentId,
      rawEventJson: msg.rawEventJson ?? '{}',
    })
  }

  /**
   * 查询最近消息 (用于社交上下文构建)
   */
  async getRecent(
    channelId: string,
    channelType: string,
    limit = 20,
  ): Promise<Array<typeof socialMessages.$inferSelect>> {
    return this.db
      .select()
      .from(socialMessages)
      .where(
        and(eq(socialMessages.channelId, channelId), eq(socialMessages.channelType, channelType)),
      )
      .orderBy(desc(socialMessages.id))
      .limit(limit)
      .then((rows) => rows.reverse()) // 返回时间正序
  }

  /**
   * 查询指定 Agent 的最近活跃会话
   */
  async getRecentChannels(
    agentId: string,
    limit = 10,
  ): Promise<Array<{ channelId: string; channelType: string; lastTimestamp: string | null }>> {
    // 使用简单的 GROUP BY 替代（Drizzle 限制下的可行方案）
    const rows = await this.db
      .select({
        channelId: socialMessages.channelId,
        channelType: socialMessages.channelType,
        lastTimestamp: socialMessages.timestamp,
      })
      .from(socialMessages)
      .where(eq(socialMessages.agentId, agentId))
      .orderBy(desc(socialMessages.id))
      .limit(limit * 5) // 多取一些再去重

    // 内存去重
    const seen = new Set<string>()
    const result: Array<{ channelId: string; channelType: string; lastTimestamp: string | null }> =
      []
    for (const row of rows) {
      const key = `${row.channelId}:${row.channelType}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push(row)
        if (result.length >= limit) break
      }
    }
    return result
  }

  // ── 社交 Scorer 动态门控查询 ──

  /**
   * 统计指定 Agent 的未总结消息数量和总字符数
   *
   * 用于社交 Scorer 动态门控:
   * - 消息数 >= 200 → 触发
   * - 总字符数 >= 50k (约 50k tokens) → 提前触发
   */
  async getUnsummarizedStats(agentId: string): Promise<{ count: number; totalChars: number }> {
    const [row] = await this.db
      .select({
        msgCount: drizzleCount(socialMessages.id),
        totalChars: sql<number>`COALESCE(SUM(LENGTH(${socialMessages.content})), 0)`,
      })
      .from(socialMessages)
      .where(and(eq(socialMessages.agentId, agentId), eq(socialMessages.isSummarized, false)))

    return {
      count: Number(row?.msgCount ?? 0),
      totalChars: Number(row?.totalChars ?? 0),
    }
  }

  /**
   * 拉取未总结消息 (按时间正序，用于分段总结)
   */
  async getUnsummarized(
    agentId: string,
    limit: number = 200,
  ): Promise<Array<typeof socialMessages.$inferSelect>> {
    return this.db
      .select()
      .from(socialMessages)
      .where(and(eq(socialMessages.agentId, agentId), eq(socialMessages.isSummarized, false)))
      .orderBy(socialMessages.id)
      .limit(limit)
  }

  /**
   * 批量标记消息为已总结
   */
  async markSummarized(messageIds: number[]): Promise<void> {
    if (messageIds.length === 0) return
    // SQLite 不支持 inArray 超大批次，分批处理
    const CHUNK_SIZE = 500
    for (let i = 0; i < messageIds.length; i += CHUNK_SIZE) {
      const chunk = messageIds.slice(i, i + CHUNK_SIZE)
      await this.db
        .update(socialMessages)
        .set({ isSummarized: true })
        .where(
          sql`${socialMessages.id} IN (${sql.join(
            chunk.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
    }
  }
}
