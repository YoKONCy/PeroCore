import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { threads } from '@infos/backend/database/schema'
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
        purpose TEXT DEFAULT 'conversation',
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
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
