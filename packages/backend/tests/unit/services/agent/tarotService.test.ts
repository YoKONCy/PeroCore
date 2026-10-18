import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TAROT_DECK } from '@infos/shared'
import { TarotRepository } from '@infos/backend/repositories/tarot.repo'
import { TarotService, tarotDay } from '@infos/backend/services/agent/tarotService'
import { ModelRoleResolver } from '@infos/backend/services/llm/modelRoles'
import { ConfigRepository } from '@infos/backend/repositories/config.repo'
import type { DrizzleDb } from '@infos/backend/database'

let sqlite: Database.Database
let db: DrizzleDb
const snapshot = { mood: '期待', vibe: '捧着热茶', mind: '想陪用户休息一下' }
const input = {
  day: '2026-10-16',
  timeZone: 'Asia/Shanghai',
  agentId: 'companion',
  agentName: '测试角色',
  question: '今天有点累',
  characterState: snapshot,
}

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(
    readFileSync(
      new URL('../../../../src/database/migrations/0014_tarot.sql', import.meta.url),
      'utf8',
    ),
  )
  db = drizzle(sqlite) as DrizzleDb
})
afterEach(() => {
  sqlite.close()
  vi.restoreAllMocks()
})

describe('一起抽牌的持久化边界', () => {
  it('包含完整牌组且每张牌都有独立标识与双向牌意', () => {
    expect(TAROT_DECK).toHaveLength(78)
    expect(new Set(TAROT_DECK.map((card) => card.id)).size).toBe(78)
    expect(TAROT_DECK.filter((card) => card.suit === 'major')).toHaveLength(22)
    for (const suit of ['wands', 'cups', 'swords', 'pentacles'])
      expect(TAROT_DECK.filter((card) => card.suit === suit)).toHaveLength(14)
    expect(
      TAROT_DECK.every((card) => card.name && card.upright && card.reversed && card.invitation),
    ).toBe(true)
  })

  it('重复抽牌和重建 Repository 后仍沿用原牌、问题与角色状态', () => {
    const repo = new TarotRepository(db)
    const first = repo.draw(input, '原始人格')
    const again = new TarotRepository(db).draw(
      { ...input, question: '改个问题', characterState: { ...snapshot, mood: '别的心情' } },
      '新的人格',
    )
    expect(again).toEqual(first)
    expect(repo.get(first.id)?.persona).toBe('原始人格')
    expect(first.companionCard.cardId).not.toBe(first.userCard.cardId)
  })

  it('换角色只新增角色回应，次日才生成新的每日记录', () => {
    const repo = new TarotRepository(db)
    const first = repo.draw(input, '人格一')
    const second = repo.draw({ ...input, agentId: 'another', question: '另一个问题' }, '人格二')
    expect(second.userCard).toEqual(first.userCard)
    expect(second.question).toBe(first.question)
    expect(second.companionCard.cardId).not.toBe(second.userCard.cardId)
    repo.draw({ ...input, day: '2026-10-17' }, '人格一')
    expect(repo.history('companion')).toHaveLength(2)
    expect(repo.history('another')).toHaveLength(1)
  })

  it('用客户端时区的日期确定每日边界', () => {
    const now = new Date('2026-10-17T00:30:00Z')
    expect(tarotDay('America/New_York', now)).toBe('2026-10-16')
    expect(tarotDay('Asia/Shanghai', now)).toBe('2026-10-17')
  })

  it('解读失败保留原牌；并发重试只调用一次模型，成功后直接读回快照', async () => {
    vi.spyOn(ModelRoleResolver.prototype, 'resolveAgent').mockResolvedValue({
      provider: 'openai',
      modelId: 'test',
      apiKey: '',
    })
    const chat = vi
      .fn()
      .mockRejectedValueOnce(new Error('临时失败'))
      .mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: '我陪你把今天过慢一点。' } }],
      })
    const readState = vi.fn(async () => snapshot)
    const service = new TarotService({
      db,
      configRepo: new ConfigRepository(db),
      agentManager: {
        getAgentDetail: () => ({
          id: 'companion',
          name: '测试角色',
          isEnabled: true,
          systemPrompt: '温柔但有点嘴硬',
          channelPatches: {},
          ownerAppellation: '你',
        }),
      },
      petStateService: { get: readState },
      llmService: { chat },
    } as never)
    const first = await service.draw('companion', 'UTC', '今天有点累', 'selected-thread')
    expect(readState).toHaveBeenCalledWith('companion', 'selected-thread')
    const failed = await service.interpret(first.id)
    expect(failed.unavailable).toBe(true)
    expect(failed.reading).toEqual(first)
    const [one, two] = await Promise.all([service.interpret(first.id), service.interpret(first.id)])
    expect(one).toEqual(two)
    expect(one.reading.userCard).toEqual(first.userCard)
    expect(one.reading.companionCard).toEqual(first.companionCard)
    expect(one.reading.interpretation).toBe('我陪你把今天过慢一点。')
    await service.interpret(first.id)
    expect(chat).toHaveBeenCalledTimes(2)
    expect(chat.mock.calls[0]?.[2]).toMatchObject({
      promptTask: 'companion.tarot',
      usageContext: { agentId: 'companion' },
    })
    expect(String(chat.mock.calls[0]?.[1]?.[0]?.content)).toContain('捧着热茶')
  })
})
