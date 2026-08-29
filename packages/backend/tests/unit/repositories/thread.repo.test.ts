import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { threads, threadMessages } from '@infos/backend/database/schema'
import { ThreadRepository } from '@infos/backend/repositories/thread.repo'

let sqlite: Database.Database

describe('ThreadRepository 最近会话用途隔离', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        channel TEXT DEFAULT 'desktop' NOT NULL,
        platform TEXT,
        platform_identifier TEXT,
        title TEXT DEFAULT '',
        message_count INTEGER DEFAULT 0,
        pair_count INTEGER DEFAULT 0,
        last_message_at TEXT,
        status TEXT DEFAULT 'active',
        context_policy TEXT,
        disabled_tools_json TEXT DEFAULT '[]' NOT NULL,
        auto_execute_tools INTEGER DEFAULT false NOT NULL,
        purpose TEXT DEFAULT 'conversation',
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE thread_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        raw_content TEXT,
        status TEXT DEFAULT 'active',
        pair_id TEXT,
        sender_id TEXT,
        revision INTEGER DEFAULT 1,
        agent_id TEXT,
        metadata_json TEXT DEFAULT '{}',
        scorer_status TEXT DEFAULT 'pending',
        timestamp TEXT,
        deleted_at TEXT,
        deleted_by TEXT
      );
    `)
  })

  afterEach(() => sqlite.close())

  it('普通聊天必须忽略更新更晚的后台任务 Thread', async () => {
    sqlite.exec(`
      INSERT INTO threads (id, agent_id, channel, purpose, last_message_at)
      VALUES
        ('conversation-old', 'nana', 'desktop', 'conversation', '2026-01-01 10:00:00'),
        ('task-new', 'nana', 'desktop', 'background_task', '2026-01-02 10:00:00');
    `)
    const repo = new ThreadRepository(drizzle(sqlite, { schema: { threads } }) as never)

    const latest = await repo.getOrCreateLatestThread('nana', 'desktop', 'conversation')

    expect(latest.id).toBe('conversation-old')
    expect(latest.purpose).toBe('conversation')
  })

  it('Continuity 查询应只返回同 Agent 其他 conversation Thread 的活跃对话消息', async () => {
    sqlite.exec(`
      INSERT INTO threads (id, agent_id, channel, purpose, status, title) VALUES
        ('current', 'pero', 'desktop', 'conversation', 'active', '当前'),
        ('desktop-other', 'pero', 'desktop', 'conversation', 'active', '其他私聊'),
        ('other', 'pero', 'group', 'conversation', 'active', '其他'),
        ('task', 'pero', 'desktop', 'background_task', 'active', '任务'),
        ('nana', 'nana', 'desktop', 'conversation', 'active', '娜娜');
      INSERT INTO thread_messages (thread_id, role, content, status, revision, timestamp) VALUES
        ('current', 'user', '当前消息', 'active', 1, '2026-08-18T09:00:00.000Z'),
        ('desktop-other', 'user', '不应串入的其他私聊', 'active', 1, '2026-08-18T09:30:00.000Z'),
        ('other', 'user', '跨线程用户', 'active', 2, '2026-08-18T10:00:00.000Z'),
        ('other', 'system', '系统消息', 'active', 1, '2026-08-18T10:01:00.000Z'),
        ('other', 'assistant', '跨线程回复', 'active', 1, '2026-08-18T10:02:00.000Z'),
        ('other', 'user', '已删除', 'deleted', 1, '2026-08-18T10:03:00.000Z'),
        ('task', 'assistant', '任务消息', 'active', 1, '2026-08-18T10:04:00.000Z'),
        ('nana', 'user', '其他角色', 'active', 1, '2026-08-18T10:05:00.000Z');
    `)
    const repo = new ThreadRepository(
      drizzle(sqlite, { schema: { threads, threadMessages } }) as never,
    )
    const result = await repo.queryContinuityMessages({
      agentId: 'pero',
      excludeThreadId: 'current',
      sourceChannel: 'group',
      limit: 10,
      since: '2026-08-18T00:00:00.000Z',
    })
    expect(result.map((message) => message.content)).toEqual(['跨线程用户', '跨线程回复'])
    expect(result[0]).toMatchObject({
      threadId: 'other',
      threadAgentId: 'pero',
      threadChannel: 'group',
      threadTitle: '其他',
      revision: 2,
    })
    const count = sqlite.prepare('SELECT count(*) AS count FROM thread_messages').get() as {
      count: number
    }
    expect(count.count).toBe(8)
  })

  it('据点Continuity应只读取同角色最近活跃Desktop Thread的完整回合', async () => {
    sqlite.exec(`
      INSERT INTO threads (id, agent_id, channel, purpose, status, last_message_at) VALUES
        ('pero-old', 'pero', 'desktop', 'conversation', 'active', '2026-08-18T09:00:00.000Z'),
        ('pero-latest', 'pero', 'desktop', 'conversation', 'active', '2026-08-18T11:00:00.000Z'),
        ('nana-latest', 'nana', 'desktop', 'conversation', 'active', '2026-08-18T12:00:00.000Z');
      INSERT INTO thread_messages (thread_id, role, content, status, pair_id, agent_id, timestamp) VALUES
        ('pero-old', 'user', 'Pero旧会话', 'active', 'old-pair', NULL, '2026-08-18T09:00:00.000Z'),
        ('pero-latest', 'user', 'Pero当前问题', 'active', 'latest-pair', NULL, '2026-08-18T11:00:00.000Z'),
        ('pero-latest', 'assistant', 'Pero当前回复', 'active', 'latest-pair', 'pero', '2026-08-18T11:01:00.000Z'),
        ('nana-latest', 'user', 'Nana私聊', 'active', 'nana-pair', NULL, '2026-08-18T12:00:00.000Z');
    `)
    const repo = new ThreadRepository(
      drizzle(sqlite, { schema: { threads, threadMessages } }) as never,
    )

    const result = await repo.queryLatestChannelContinuityPairs({
      agentId: 'pero',
      sourceChannel: 'desktop',
      pairLimit: 3,
    })

    expect(result.map((message) => message.content)).toEqual(['Pero当前问题', 'Pero当前回复'])
    expect(result.every((message) => message.threadId === 'pero-latest')).toBe(true)
  })

  it('历史消息游标必须稳定返回更早记录且不受新消息插入影响', async () => {
    sqlite.exec(`
      INSERT INTO threads (id, agent_id, channel, purpose, status)
      VALUES ('history', 'pero', 'desktop', 'conversation', 'active');
      INSERT INTO thread_messages (id, thread_id, role, content, status, timestamp) VALUES
        (1, 'history', 'user', '消息1', 'active', '2026-08-18T10:00:00.000Z'),
        (2, 'history', 'assistant', '消息2', 'active', '2026-08-18T10:01:00.000Z'),
        (3, 'history', 'user', '消息3', 'active', '2026-08-18T10:02:00.000Z'),
        (4, 'history', 'assistant', '消息4', 'active', '2026-08-18T10:03:00.000Z'),
        (5, 'history', 'user', '消息5', 'active', '2026-08-18T10:04:00.000Z');
    `)
    const repo = new ThreadRepository(
      drizzle(sqlite, { schema: { threads, threadMessages } }) as never,
    )

    const latest = await repo.listActiveMessages({ threadId: 'history', pageSize: 2 })
    expect(latest.items.map((message) => message.id)).toEqual([5, 4])
    expect(latest.hasMoreBefore).toBe(true)

    sqlite.exec(`
      INSERT INTO thread_messages (id, thread_id, role, content, status, timestamp)
      VALUES (6, 'history', 'assistant', '新消息', 'active', '2026-08-18T10:05:00.000Z');
    `)
    const older = await repo.listActiveMessages({
      threadId: 'history',
      beforeMessageId: 4,
      pageSize: 2,
    })
    expect(older.items.map((message) => message.id)).toEqual([3, 2])
    expect(older.hasMoreBefore).toBe(true)
  })

  it('只有后台任务 Thread 时必须新建普通 conversation Thread', async () => {
    sqlite.exec(`
      INSERT INTO threads (id, agent_id, channel, purpose, last_message_at)
      VALUES ('task-only', 'nana', 'desktop', 'background_task', '2026-01-02 10:00:00');
    `)
    const repo = new ThreadRepository(drizzle(sqlite, { schema: { threads } }) as never)

    const latest = await repo.getOrCreateLatestThread('nana', 'desktop', 'conversation')

    expect(latest.id).not.toBe('task-only')
    expect(latest.agentId).toBe('nana')
    expect(latest.channel).toBe('desktop')
    expect(latest.purpose).toBe('conversation')
  })
})
