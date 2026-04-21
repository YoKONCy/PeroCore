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

import { eq, desc } from 'drizzle-orm'
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
      })
      .returning()

    return rows[0]!
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
