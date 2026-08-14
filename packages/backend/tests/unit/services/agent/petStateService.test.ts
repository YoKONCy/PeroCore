import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { petStates } from '@infos/backend/database/schema'
import { PetStateService } from '@infos/backend/services/agent/petStateService'

let sqlite: Database.Database

describe('PetStateService 临时台词生命周期', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.exec(`
      CREATE TABLE pet_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL DEFAULT 'pero',
        mood TEXT DEFAULT '开心',
        vibe TEXT DEFAULT '活泼',
        mind TEXT DEFAULT '正在发呆...',
        click_messages_json TEXT DEFAULT '{}',
        idle_messages_json TEXT DEFAULT '[]',
        back_messages_json TEXT DEFAULT '[]',
        text_expires_at TEXT,
        updated_at TEXT
      );
      CREATE INDEX idx_pet_states_agent_id ON pet_states(agent_id);
    `)
  })

  afterEach(() => {
    vi.useRealTimers()
    sqlite.close()
  })

  it('应追加并去重同一部位的临时台词', async () => {
    const service = new PetStateService(drizzle(sqlite, { schema: { petStates } }) as never)

    await service.update('pero', { clickMessages: { head: ['新台词一'] } })
    await service.update('pero', { clickMessages: { head: ['新台词一', '新台词二'] } })

    const state = await service.get('pero')
    expect(JSON.parse(state!.clickMessagesJson)).toEqual({ head: ['新台词一', '新台词二'] })
    expect(service.hasActiveTemporaryTexts(state)).toBe(true)
  })

  it('过期后应丢弃旧池并从新台词重新开始', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'))
    const service = new PetStateService(drizzle(sqlite, { schema: { petStates } }) as never)

    await service.update('pero', { clickMessages: { head: ['旧台词'] } })
    vi.setSystemTime(new Date('2026-08-14T07:00:00.000Z'))
    expect(service.hasActiveTemporaryTexts(await service.get('pero'))).toBe(false)

    await service.update('pero', { clickMessages: { head: ['新台词'] } })
    const state = await service.get('pero')
    expect(JSON.parse(state!.clickMessagesJson)).toEqual({ head: ['新台词'] })
    expect(service.hasActiveTemporaryTexts(state)).toBe(true)
  })
})
