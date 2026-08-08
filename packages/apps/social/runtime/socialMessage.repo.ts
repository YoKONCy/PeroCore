/**
 * SocialMessage Repository — 社交消息数据访问
 *
 * 提供社交消息的 CRUD 操作（Repository 层）。
 * 操作的是 social_messages 表，存储平台原始消息。
 *
 * @module packages/apps/social/runtime/socialMessage.repo
 */

import { desc, eq, and, sql, count as drizzleCount } from 'drizzle-orm'
import { socialMessages } from '../../../backend/src/database/schema'
import type { DrizzleDb } from '../../../backend/src/database'

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

  /**
   * 跨会话查询：按发送者 ID 拉取最近私聊消息
   *
   * 用于跨会话上下文注入：
   * - 当用户 A 在群聊中 @ Agent 时，查询该用户与 Agent 的最近 N 条私聊记录
   * - 作为补充上下文注入 system prompt，让 Agent 记得与该用户的历史互动
   *
   * 查询逻辑：
   * - channelType='private' AND channelId=senderId（私聊的 channelId 即用户 ID）
   * - 排除 Agent 自己发的消息（senderId='self'）不排除，因为需要对话对
   * - 按时间正序返回（最新在末尾）
   *
   * @param senderId  用户 QQ 号（也是私聊的 channelId）
   * @param limit     拉取条数（默认 10）
   */
  async getRecentPrivateBySender(
    senderId: string,
    limit = 10,
  ): Promise<Array<typeof socialMessages.$inferSelect>> {
    return this.db
      .select()
      .from(socialMessages)
      .where(and(eq(socialMessages.channelType, 'private'), eq(socialMessages.channelId, senderId)))
      .orderBy(desc(socialMessages.id))
      .limit(limit)
      .then((rows) => rows.reverse()) // 返回时间正序
  }

  /**
   * 查询指定发送者的最近消息（含 rawEventJson，用于提取图片 URL）
   *
   * 用于图片优先级收集：
   * - 当用户 @ Agent 但本次消息没有图片时，回溯该用户最近 N 条消息找图片
   * - 需要解析 rawEventJson 中的 OneBot message segments 提取 image url
   * - 跨 channelType 查询（私聊 + 群聊都算），因为用户可能在不同会话发过图片
   *
   * @param senderId  发送者 QQ 号
   * @param limit     回溯条数（默认 20）
   */
  async getRecentBySender(
    senderId: string,
    limit = 20,
  ): Promise<Array<typeof socialMessages.$inferSelect>> {
    return this.db
      .select()
      .from(socialMessages)
      .where(eq(socialMessages.senderId, senderId))
      .orderBy(desc(socialMessages.id))
      .limit(limit)
      .then((rows) => rows.reverse()) // 返回时间正序
  }

  /**
   * 按消息 ID 查询单条消息（含 rawEventJson，用于提取图片 URL）
   *
   * 用于 social_read_image 工具：AI 传入 message_id，从 DB 查询对应消息，
   * 再从 rawEventJson 中提取图片 URL 下载。
   *
   * @param msgId 消息 ID（对应 OneBot 事件的 message_id）
   */
  async getByMsgId(msgId: string): Promise<typeof socialMessages.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(socialMessages)
      .where(eq(socialMessages.msgId, msgId))
      .limit(1)
    return row ?? null
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
