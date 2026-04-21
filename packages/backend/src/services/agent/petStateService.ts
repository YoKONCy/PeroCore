/**
 * PetState Service — 角色状态管理
 *
 * 负责 pet_states 表的 CRUD，供 finishTask 工具调用。
 *
 * @module packages/backend/src/services/agent/petStateService
 */

import { eq } from 'drizzle-orm'
import { petStates } from '../../database/schema'
import { createLogger } from '../../lib/logger'
import type { DrizzleDb } from '../../database'

const logger = createLogger('PetStateService')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

export interface PetStateUpdateData {
  mood?: string
  vibe?: string
  mind?: string
  clickMessages?: Record<string, string[]>
  idleMessages?: string[]
  backMessages?: string[]
}

export interface PetStateData {
  agentId: string
  mood: string
  vibe: string
  mind: string
  clickMessagesJson: string
  idleMessagesJson: string
  backMessagesJson: string
  updatedAt: string | null
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class PetStateService {
  constructor(private db: DrizzleDb) {}

  /**
   * 获取指定 Agent 的状态
   */
  async get(agentId: string): Promise<PetStateData | null> {
    const rows = await this.db
      .select()
      .from(petStates)
      .where(eq(petStates.agentId, agentId))
      .limit(1)

    return (rows[0] as PetStateData | undefined) ?? null
  }

  /**
   * 更新角色状态 (upsert)
   *
   * 对 clickMessages 做合并而非覆盖。
   */
  async update(agentId: string, data: PetStateUpdateData): Promise<void> {
    const existing = await this.get(agentId)
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19)

    if (!existing) {
      // 插入新记录
      await this.db.insert(petStates).values({
        agentId,
        mood: data.mood ?? '开心',
        vibe: data.vibe ?? '活泼',
        mind: data.mind ?? '正在想主人...',
        clickMessagesJson: data.clickMessages ? JSON.stringify(data.clickMessages) : '{}',
        idleMessagesJson: data.idleMessages ? JSON.stringify(data.idleMessages) : '[]',
        backMessagesJson: data.backMessages ? JSON.stringify(data.backMessages) : '[]',
        updatedAt: now,
      })
      logger.info(`创建角色状态: agent=${agentId}`)
      return
    }

    // 构建更新字段
    const updates: Record<string, unknown> = { updatedAt: now }

    if (data.mood) updates.mood = data.mood
    if (data.vibe) updates.vibe = data.vibe
    if (data.mind) updates.mind = data.mind

    // clickMessages: 合并到已有值
    if (data.clickMessages) {
      let current: Record<string, string[]> = {}
      try {
        current = JSON.parse(existing.clickMessagesJson || '{}')
      } catch {
        /* ignore */
      }
      Object.assign(current, data.clickMessages)
      updates.clickMessagesJson = JSON.stringify(current)
    }

    if (data.idleMessages) {
      updates.idleMessagesJson = JSON.stringify(data.idleMessages)
    }

    if (data.backMessages) {
      updates.backMessagesJson = JSON.stringify(data.backMessages)
    }

    await this.db.update(petStates).set(updates).where(eq(petStates.agentId, agentId))

    const fields = Object.keys(updates).filter((k) => k !== 'updatedAt')
    logger.info(`更新角色状态: agent=${agentId}, fields=[${fields.join(', ')}]`)
  }
}
