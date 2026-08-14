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
const TEMP_TEXT_TTL_MS = 6 * 60 * 60 * 1000
const MAX_TEMP_LINES_PER_POOL = 12

function mergeUniqueLines(current: string[], incoming: string[]): string[] {
  return [...new Set([...current, ...incoming].map((line) => line.trim()).filter(Boolean))].slice(
    -MAX_TEMP_LINES_PER_POOL,
  )
}

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
  textExpiresAt: string | null
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

  /** 临时台词是否仍在有效期内；旧数据没有期限时按已过期处理。 */
  hasActiveTemporaryTexts(state: PetStateData | null): boolean {
    if (!state?.textExpiresAt) return false
    const expiresAt = Date.parse(state.textExpiresAt)
    return Number.isFinite(expiresAt) && expiresAt > Date.now()
  }

  /**
   * 更新角色状态 (upsert)
   *
   * finish_task 台词按池追加、去重并设置有效期，不再永久覆盖默认台词。
   */
  async update(agentId: string, data: PetStateUpdateData): Promise<string | null> {
    const existing = await this.get(agentId)
    const now = new Date()
    const nowText = now.toISOString().replace('T', ' ').slice(0, 19)
    const hasTextUpdate = Boolean(data.clickMessages || data.idleMessages || data.backMessages)
    const textExpiresAt = hasTextUpdate
      ? new Date(now.getTime() + TEMP_TEXT_TTL_MS).toISOString()
      : null

    if (!existing) {
      // 插入新记录
      await this.db.insert(petStates).values({
        agentId,
        mood: data.mood ?? '开心',
        vibe: data.vibe ?? '活泼',
        mind: data.mind ?? '正在发呆...',
        clickMessagesJson: data.clickMessages ? JSON.stringify(data.clickMessages) : '{}',
        idleMessagesJson: data.idleMessages ? JSON.stringify(data.idleMessages) : '[]',
        backMessagesJson: data.backMessages ? JSON.stringify(data.backMessages) : '[]',
        textExpiresAt,
        updatedAt: nowText,
      })
      logger.info(`创建角色状态: agent=${agentId}`)
      return textExpiresAt
    }

    // 构建更新字段
    const updates: Record<string, unknown> = { updatedAt: nowText }
    if (hasTextUpdate) updates.textExpiresAt = textExpiresAt

    if (data.mood) updates.mood = data.mood
    if (data.vibe) updates.vibe = data.vibe
    if (data.mind) updates.mind = data.mind

    // 过期池不参与下一轮追加，保证旧动态台词不会被无限续期。
    const canReuseCurrentTexts = this.hasActiveTemporaryTexts(existing)

    if (data.clickMessages) {
      let current: Record<string, string[]> = {}
      if (canReuseCurrentTexts) {
        try {
          current = JSON.parse(existing.clickMessagesJson || '{}')
        } catch {
          current = {}
        }
      }
      for (const [part, lines] of Object.entries(data.clickMessages)) {
        current[part] = mergeUniqueLines(current[part] ?? [], lines)
      }
      updates.clickMessagesJson = JSON.stringify(current)
    }

    if (data.idleMessages) {
      let current: string[] = []
      if (canReuseCurrentTexts) {
        try {
          current = JSON.parse(existing.idleMessagesJson || '[]')
        } catch {
          current = []
        }
      }
      updates.idleMessagesJson = JSON.stringify(mergeUniqueLines(current, data.idleMessages))
    }

    if (data.backMessages) {
      let current: string[] = []
      if (canReuseCurrentTexts) {
        try {
          current = JSON.parse(existing.backMessagesJson || '[]')
        } catch {
          current = []
        }
      }
      updates.backMessagesJson = JSON.stringify(mergeUniqueLines(current, data.backMessages))
    }

    await this.db.update(petStates).set(updates).where(eq(petStates.agentId, agentId))

    const fields = Object.keys(updates).filter((k) => k !== 'updatedAt')
    logger.info(`更新角色状态: agent=${agentId}, fields=[${fields.join(', ')}]`)
    return textExpiresAt
  }
}
