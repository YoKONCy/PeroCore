import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrizzleDb } from '@infos/backend/database'
import { DEFAULT_CHARACTER_STATE } from '@infos/shared'
import { PetStateService } from '@infos/backend/services/agent/petStateService'

let sqlite: Database.Database
let service: PetStateService
const migration = readFileSync(
  new URL('../../../../src/database/migrations/0016_thread_character_states.sql', import.meta.url),
  'utf8',
)
const scope = (pairId = 'p1', threadId = 't1', toolCallId?: string) => ({
  threadId,
  pairId,
  toolCallId,
})

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE threads (id TEXT PRIMARY KEY, agent_id TEXT, channel TEXT, status TEXT, platform TEXT, platform_identifier TEXT);
    CREATE TABLE thread_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT, role TEXT, status TEXT,
      agent_id TEXT, pair_id TEXT, timestamp TEXT, metadata_json TEXT
    );
    INSERT INTO threads VALUES ('t1','pero','desktop','active',NULL,NULL),('t2','pero','desktop','active',NULL,NULL);
    INSERT INTO thread_messages(thread_id,role,status,agent_id,pair_id) VALUES
      ('t1','user','active','pero','p1'),('t1','user','active','pero','p2'),
      ('t1','user','active','pero','p3'),('t2','user','active','pero','p1');
  `)
  sqlite.exec(migration)
  service = new PetStateService(drizzle(sqlite) as DrizzleDb)
})
afterEach(() => {
  vi.useRealTimers()
  sqlite.close()
})

describe('会话角色状态的隔离与撤回', () => {
  it('据点状态归属对应房间会话，删除群聊轮次后不能迟到写回', async () => {
    sqlite.exec(`
      CREATE TABLE group_chat_messages (id INTEGER PRIMARY KEY, room_id TEXT, pair_id TEXT);
      INSERT INTO group_chat_messages VALUES (1,'room','p1');
      INSERT INTO threads VALUES ('stronghold_room_pero','pero','group','active','stronghold','room:pero');
    `)
    await service.update('pero', { mood: '期待' }, scope('p1', 'stronghold_room_pero'))
    sqlite.exec('DELETE FROM group_chat_messages')
    await service.rollbackRoomPair('room', 'p1')
    expect(await service.get('pero', 'stronghold_room_pero')).toMatchObject(DEFAULT_CHARACTER_STATE)
    await expect(
      service.update('pero', { mood: '紧张' }, scope('p1', 'stronghold_room_pero')),
    ).rejects.toThrow('已撤回')
  })

  it('同一角色的两条会话互不影响，无会话时不返回全局状态', async () => {
    await service.update('pero', { mood: '期待', mind: '会话一' }, scope())
    await service.update('pero', { mood: '平静', mind: '会话二' }, scope('p1', 't2'))
    expect(await service.get('pero', 't1')).toMatchObject({ mood: '期待', mind: '会话一' })
    expect(await service.get('pero', 't2')).toMatchObject({ mood: '平静', mind: '会话二' })
    expect(await service.get('pero')).toBeNull()
    expect(await service.get('nana', 't1')).toBeNull()
  })

  it('删除中间轮次按剩余字段重放，不覆盖后续仍有效的状态', async () => {
    await service.update('pero', { mood: '期待', vibe: '坐下' }, scope('p1'))
    await service.update('pero', { mood: '紧张' }, scope('p2'))
    await service.update('pero', { mind: '正在画图' }, scope('p3'))
    await service.rollbackPairs('t1', ['p2'])
    expect(await service.get('pero', 't1')).toMatchObject({
      mood: '期待',
      vibe: '坐下',
      mind: '正在画图',
    })
    await service.rollbackPairs('t1', ['p1', 'p3'])
    expect(await service.get('pero', 't1')).toMatchObject(DEFAULT_CHARACTER_STATE)
  })

  it('重复设置相同状态也保留独立来源，早期轮次删除不影响后续同值设置', async () => {
    await service.update('pero', { mood: '期待' }, scope('p1'))
    await service.update('pero', { mood: '期待' }, scope('p2'))
    await service.rollbackPairs('t1', ['p1'])
    expect((await service.get('pero', 't1'))?.mood).toBe('期待')
  })

  it('清理会话只清理目标，清理退役通道时同步各会话的默认状态', async () => {
    const publish = vi.fn().mockResolvedValue(undefined)
    service.setPublisher(publish)
    await service.update('pero', { mood: '期待' }, scope())
    await service.update('pero', { mood: '专注' }, scope('p1', 't2'))
    await service.clearThread('t1')
    expect(await service.get('pero', 't1')).toMatchObject(DEFAULT_CHARACTER_STATE)
    expect((await service.get('pero', 't2'))?.mood).toBe('专注')
    sqlite.prepare("UPDATE threads SET status='deleted' WHERE channel='desktop'").run()
    await service.clearChannel('desktop')
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 't2',
        replace: true,
        ...DEFAULT_CHARACTER_STATE,
      }),
    )
  })

  it('撤回可清空临时台词，推送完整投影且修订号递增', async () => {
    const publish = vi.fn().mockResolvedValue(undefined)
    service.setPublisher(publish)
    await service.update('pero', { clickMessages: { head: ['一'] } }, scope('p1'))
    await service.update('pero', { clickMessages: { head: ['一', '二'] } }, scope('p2'))
    expect(JSON.parse((await service.get('pero', 't1'))!.clickMessagesJson)).toEqual({
      head: ['一', '二'],
    })
    const revision = (await service.get('pero', 't1'))!.revision
    await service.rollbackPairs('t1', ['p2'])
    expect(JSON.parse((await service.get('pero', 't1'))!.clickMessagesJson)).toEqual({
      head: ['一'],
    })
    await service.rollbackPairs('t1', ['p1'])
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        threadId: 't1',
        agentId: 'pero',
        replace: true,
        click_messages: {},
        idle_messages: [],
        text_expires_at: null,
      }),
    )
    expect((await service.get('pero', 't1'))!.revision).toBeGreaterThan(revision)
  })

  it('已撤回、已删除消息与已删除会话不能被在途工具重新写回', async () => {
    await service.rollbackPairs('t1', ['p1'])
    await expect(service.update('pero', { mood: '期待' }, scope('p1'))).rejects.toThrow('已撤回')
    sqlite.prepare("UPDATE thread_messages SET status='deleted' WHERE pair_id='p2'").run()
    await expect(service.update('pero', { mood: '期待' }, scope('p2'))).rejects.toThrow('来源消息')
    sqlite.prepare("UPDATE threads SET status='deleted' WHERE id='t1'").run()
    await expect(service.update('pero', { mood: '期待' }, scope('p3'))).rejects.toThrow('会话')
  })

  it('同一工具调用重试幂等，缺少来源身份时不制造不可撤回状态', async () => {
    await service.update('pero', { mood: '期待' }, scope('p1', 't1', 'call'))
    const before = await service.get('pero', 't1')
    await service.update('pero', { mood: '紧张' }, scope('p1', 't1', 'call'))
    expect(await service.get('pero', 't1')).toEqual(before)
    await expect(service.update('pero', { mood: '期待' })).rejects.toThrow('消息轮次')
  })

  it('临时台词过期后重新起池，不把其他过期池无限续期', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T00:00:00Z'))
    await service.update(
      'pero',
      { clickMessages: { head: ['旧台词'] }, idleMessages: ['旧空闲'] },
      scope(),
    )
    vi.setSystemTime(new Date('2026-08-14T07:00:00Z'))
    expect(service.hasActiveTemporaryTexts(await service.get('pero', 't1'))).toBe(false)
    await service.update('pero', { clickMessages: { head: ['新台词'] } }, scope('p2'))
    const state = await service.get('pero', 't1')
    expect(JSON.parse(state!.clickMessagesJson)).toEqual({ head: ['新台词'] })
    expect(JSON.parse(state!.idleMessagesJson)).toEqual([])
  })

  it('迁移从各自有效历史恢复，不把旧全局状态复制到所有会话', async () => {
    sqlite.exec('DROP TABLE thread_character_state_events')
    const insert = sqlite.prepare(
      "INSERT INTO thread_messages(thread_id,role,status,agent_id,pair_id,metadata_json) VALUES (?,'assistant',?,'pero',?,?)",
    )
    const metadata = JSON.stringify({
      toolCalls: [{ name: 'update_state', callId: 'legacy', args: { mood: '期待' } }],
    })
    insert.run('t1', 'active', 'p1', metadata)
    insert.run('t2', 'deleted', 'p1', metadata)
    insert.run('t2', 'active', 'p2', JSON.stringify({ toolCalls: ['无效旧记录'] }))
    insert.run('t2', 'active', 'p3', '{无效JSON')
    sqlite.exec(migration)
    expect((await service.get('pero', 't1'))?.mood).toBe('期待')
    expect(await service.get('pero', 't2')).toMatchObject(DEFAULT_CHARACTER_STATE)
  })
})
