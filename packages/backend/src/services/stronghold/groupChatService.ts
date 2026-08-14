/**
 * Group Chat Service — 群聊消息服务
 *
 * 管理群聊房间的消息 CRUD + 视角转换 + 记忆注入。
 * 收到用户消息后触发 GroupChatDispatcher 决定哪个 Agent 接话。
 *
 * - SQLModel → Drizzle ORM
 * - AsyncSession → DrizzleDb (同步但更轻量)
 * - 视角转换逻辑不变
 * - 记忆注入路径改走 MemoryService
 *
 * @module packages/backend/src/services/stronghold/groupChatService
 */

import { eq, desc, asc, and, or, inArray, isNull, sql } from 'drizzle-orm'
import { groupChatRooms, groupChatMembers, groupChatMessages } from '../../database/schema'
import type { DrizzleDb } from '../../database'

// ── 类型 ──

type RoomRow = typeof groupChatRooms.$inferSelect
type MemberRow = typeof groupChatMembers.$inferSelect
type MessageRow = typeof groupChatMessages.$inferSelect

/** 发送消息的输入 */
export interface SendMessageInput {
  roomId: string
  senderId: string
  content: string
  role: 'user' | 'assistant' | 'system'
  mentions?: string[]
  /** 本轮对话关联键：用户消息与其所有回复共用。 */
  pairId?: string
}

/** 据点消息级联删除结果。 */
export interface DeleteMessagePairResult {
  deletedCount: number
  deletedMessageIds: number[]
}

/** 视角转换后的消息 (给 LLM) */
export interface PerspectiveMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// ── Service ──

export class GroupChatService {
  constructor(private db: DrizzleDb) {}

  // ─── 房间 ───

  async listRooms(): Promise<RoomRow[]> {
    return this.db.select().from(groupChatRooms).all()
  }

  async getRoom(roomId: string): Promise<RoomRow | undefined> {
    return this.db.select().from(groupChatRooms).where(eq(groupChatRooms.id, roomId)).get()
  }

  // ─── 成员 ───

  async getRoomMembers(roomId: string): Promise<MemberRow[]> {
    return this.db.select().from(groupChatMembers).where(eq(groupChatMembers.roomId, roomId)).all()
  }

  async addMember(roomId: string, agentId: string, role = 'member'): Promise<void> {
    const existing = await this.db
      .select()
      .from(groupChatMembers)
      .where(eq(groupChatMembers.roomId, roomId))
      .all()

    if (existing.some((m) => m.agentId === agentId)) return

    await this.db.insert(groupChatMembers).values({ roomId, agentId, role })
  }

  async removeMember(roomId: string, agentId: string): Promise<void> {
    // 不能移除 system/user
    if (['system', 'user'].includes(agentId)) return

    const members = await this.getRoomMembers(roomId)
    const target = members.find((m) => m.agentId === agentId)
    if (target) {
      await this.db.delete(groupChatMembers).where(eq(groupChatMembers.id, target.id))
    }
  }

  // ─── 消息 ───

  /**
   * 发送消息到群聊
   *
   * 1. 保存消息
   * 2. 返回保存的消息 (调用方负责触发调度)
   */
  async sendMessage(input: SendMessageInput): Promise<MessageRow> {
    const rows = await this.db
      .insert(groupChatMessages)
      .values({
        roomId: input.roomId,
        senderId: input.senderId,
        content: input.content,
        role: input.role,
        mentionsJson: JSON.stringify(input.mentions ?? []),
        pairId: input.pairId,
      })
      .returning()

    return rows[0]!
  }

  /** 获取房间消息总数（对话日志列表展示用，避免拉取全量）。 */
  async countMessages(roomId: string): Promise<number> {
    const row = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(groupChatMessages)
      .where(eq(groupChatMessages.roomId, roomId))
      .get()
    return row?.count ?? 0
  }

  /** 获取房间历史消息 (最新 N 条，按时间正序) */
  async getHistory(roomId: string, limit = 50): Promise<MessageRow[]> {
    const msgs = await this.db
      .select()
      .from(groupChatMessages)
      .where(eq(groupChatMessages.roomId, roomId))
      .orderBy(desc(groupChatMessages.id))
      .limit(limit)
      .all()

    // 反转为时间正序
    return msgs.reverse()
  }

  /** 获取最近 N 个完整群聊回合；一个 pair 包含用户发言及本轮全部回复。 */
  async getHistoryPairs(roomId: string, pairLimit = 20): Promise<MessageRow[]> {
    const normalizedLimit = Math.max(1, pairLimit)
    const pairKey = sql<string>`coalesce(${groupChatMessages.pairId}, '__message__:' || ${groupChatMessages.id})`
    const latestId = sql<number>`max(${groupChatMessages.id})`
    const recentPairs = await this.db
      .select({ pairKey, latestId })
      .from(groupChatMessages)
      .where(eq(groupChatMessages.roomId, roomId))
      .groupBy(pairKey)
      .orderBy(desc(latestId))
      .limit(normalizedLimit)
      .all()

    if (recentPairs.length === 0) return []
    const pairIds = recentPairs
      .map((row) => row.pairKey)
      .filter((key) => !key.startsWith('__message__:'))
    const legacyMessageIds = recentPairs
      .map((row) => row.pairKey)
      .filter((key) => key.startsWith('__message__:'))
      .map((key) => Number(key.slice('__message__:'.length)))
      .filter(Number.isInteger)
    const selectors = []
    if (pairIds.length > 0) selectors.push(inArray(groupChatMessages.pairId, pairIds))
    if (legacyMessageIds.length > 0) {
      selectors.push(
        and(isNull(groupChatMessages.pairId), inArray(groupChatMessages.id, legacyMessageIds))!,
      )
    }

    return this.db
      .select()
      .from(groupChatMessages)
      .where(
        and(
          eq(groupChatMessages.roomId, roomId),
          selectors.length === 1 ? selectors[0] : or(...selectors),
        ),
      )
      .orderBy(asc(groupChatMessages.id))
      .all()
  }

  /**
   * 级联删除一轮据点对话。
   *
   * 新消息通过 pairId 精确删除用户发言和本轮全部 Agent/system 回复；
   * 旧消息没有 pairId 时保守地只删除目标消息，避免群聊中按相邻记录误删。
   */
  async deleteMessagePair(roomId: string, messageId: number): Promise<DeleteMessagePairResult> {
    const target = await this.db
      .select()
      .from(groupChatMessages)
      .where(and(eq(groupChatMessages.id, messageId), eq(groupChatMessages.roomId, roomId)))
      .get()

    if (!target) {
      throw new Error(`消息 ${messageId} 不存在或不属于房间 ${roomId}`)
    }

    const condition = target.pairId
      ? and(eq(groupChatMessages.roomId, roomId), eq(groupChatMessages.pairId, target.pairId))
      : and(eq(groupChatMessages.id, messageId), eq(groupChatMessages.roomId, roomId))
    const rows = await this.db.delete(groupChatMessages).where(condition).returning()

    return {
      deletedCount: rows.length,
      deletedMessageIds: rows.map((row) => row.id),
    }
  }

  /** 判断本轮用户消息仍存在，防止删除后异步 Agent 回复迟到写回。 */
  async isPairActive(roomId: string, pairId: string): Promise<boolean> {
    const message = await this.db
      .select({ id: groupChatMessages.id })
      .from(groupChatMessages)
      .where(and(eq(groupChatMessages.roomId, roomId), eq(groupChatMessages.pairId, pairId)))
      .get()
    return Boolean(message)
  }

  // ─── 视角转换 ───

  /**
   * 将群聊历史转换为特定 Agent 的 LLM 消息视角
   *
   * 规则:
   * - sender_id === agentId → role: "assistant"
   * - sender_id === "user" → role: "user"
   * - sender_id === 其他Agent → role: "user", 内容加前缀 "[{name}]: "
   * - sender_id === "system"/"Butler" → role: "system"
   */
  convertPerspective(messages: MessageRow[], agentId: string): PerspectiveMessage[] {
    return messages.map((msg) => {
      if (msg.senderId === agentId) {
        return { role: 'assistant' as const, content: msg.content }
      }

      if (msg.senderId === 'user') {
        return { role: 'user' as const, content: msg.content }
      }

      if (msg.role === 'system' || msg.senderId === 'Butler' || msg.senderId === 'system') {
        return { role: 'system' as const, content: msg.content }
      }

      // 其他 Agent 的发言
      return {
        role: 'user' as const,
        content: `[${msg.senderId}]: ${msg.content}`,
      }
    })
  }

  /**
   * 获取 Agent 候选列表 (排除 user/system/Butler)
   */
  async getCandidateAgents(roomId: string): Promise<string[]> {
    const members = await this.getRoomMembers(roomId)
    return members.map((m) => m.agentId).filter((id) => !['user', 'system', 'Butler'].includes(id))
  }
}
