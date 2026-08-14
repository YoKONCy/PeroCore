import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSnapshotRepository } from '@infos/backend/repositories/fileSnapshot.repo'
import { fileChangeSnapshots, threadMessages, threads } from '@infos/backend/database/schema'

let sqlite: Database.Database

describe('FileSnapshotRepository 链式回滚范围', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        channel TEXT DEFAULT 'desktop' NOT NULL,
        status TEXT DEFAULT 'active',
        created_at TEXT,
        updated_at TEXT
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
      CREATE TABLE file_change_snapshots (
        id TEXT PRIMARY KEY NOT NULL,
        thread_id TEXT NOT NULL,
        pair_id TEXT NOT NULL,
        call_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        operation TEXT DEFAULT 'modify' NOT NULL,
        rename_target_path TEXT,
        original_content TEXT,
        original_sha256 TEXT,
        final_sha256 TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL,
        updated_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL
      );
      CREATE UNIQUE INDEX uq_file_change_snapshots_pair_file ON file_change_snapshots(pair_id, file_path);
    `)
  })

  afterEach(() => sqlite.close())

  it('点击 B 的 assistant 时链式删除 B、C、D，并保留 A', async () => {
    const db = drizzle(sqlite, { schema: { threads, threadMessages, fileChangeSnapshots } })
    const repo = new FileSnapshotRepository(db as never)
    sqlite
      .prepare('INSERT INTO threads (id, agent_id, channel, status) VALUES (?, ?, ?, ?)')
      .run('thread-1', 'pero', 'desktop', 'active')

    const rows = await db
      .insert(threadMessages)
      .values([
        {
          threadId: 'thread-1',
          role: 'user',
          content: 'A-user',
          pairId: 'A',
          timestamp: '2026-01-01 00:00:01',
        },
        {
          threadId: 'thread-1',
          role: 'assistant',
          content: 'A-ai',
          pairId: 'A',
          timestamp: '2026-01-01 00:00:01',
        },
        {
          threadId: 'thread-1',
          role: 'user',
          content: 'B-user',
          pairId: 'B',
          timestamp: '2026-01-01 00:00:02',
        },
        {
          threadId: 'thread-1',
          role: 'assistant',
          content: 'B-ai',
          pairId: 'B',
          timestamp: '2026-01-01 00:00:02',
        },
        {
          threadId: 'thread-1',
          role: 'system',
          content: 'B 后 system',
          timestamp: '2026-01-01 00:00:03',
        },
        {
          threadId: 'thread-1',
          role: 'user',
          content: 'C-user',
          pairId: 'C',
          timestamp: '2026-01-01 00:00:04',
        },
        {
          threadId: 'thread-1',
          role: 'assistant',
          content: 'C-ai',
          pairId: 'C',
          timestamp: '2026-01-01 00:00:04',
        },
        {
          threadId: 'thread-1',
          role: 'user',
          content: 'D-user',
          pairId: 'D',
          timestamp: '2026-01-01 00:00:05',
        },
        {
          threadId: 'thread-1',
          role: 'assistant',
          content: 'D-ai',
          pairId: 'D',
          timestamp: '2026-01-01 00:00:05',
        },
      ])
      .returning()

    const bAssistant = rows.find((row) => row.content === 'B-ai')!
    const target = await repo.getRewindTarget('thread-1', bAssistant.id)
    expect(target?.pairId).toBe('B')
    expect(target?.id).toBe(rows.find((row) => row.content === 'B-user')!.id)

    const pairIds = await repo.listPairIdsFrom('thread-1', {
      timestamp: target!.timestamp!,
      id: target!.id,
    })
    expect(pairIds).toEqual(['B', 'C', 'D'])

    const deletedIds = await repo.softDeleteFromMessage('thread-1', bAssistant.id, 'user')
    expect(deletedIds).toHaveLength(7)
    const after = await db.select().from(threadMessages)
    expect(after.filter((row) => row.status === 'active').map((row) => row.content)).toEqual([
      'A-user',
      'A-ai',
    ])
    expect(after.find((row) => row.content === 'B 后 system')?.status).toBe('deleted')
  })

  it('中断回复可以作为撤回目标，并删除同轮用户消息与中断回复', async () => {
    const db = drizzle(sqlite, { schema: { threads, threadMessages, fileChangeSnapshots } })
    const repo = new FileSnapshotRepository(db as never)
    sqlite
      .prepare('INSERT INTO threads (id, agent_id, channel, status) VALUES (?, ?, ?, ?)')
      .run('thread-interrupted', 'nana', 'desktop', 'active')
    const rows = await db
      .insert(threadMessages)
      .values([
        {
          threadId: 'thread-interrupted',
          role: 'user',
          content: '继续回答',
          pairId: 'I',
          status: 'active',
          timestamp: '2026-01-01 00:00:01',
        },
        {
          threadId: 'thread-interrupted',
          role: 'assistant',
          content: '本次回复已中断',
          pairId: 'I',
          status: 'interrupted',
          timestamp: '2026-01-01 00:00:01',
        },
      ])
      .returning()

    const interrupted = rows.find((row) => row.status === 'interrupted')!
    const target = await repo.getRewindTarget('thread-interrupted', interrupted.id)
    expect(target?.pairId).toBe('I')
    expect(target?.id).toBe(rows.find((row) => row.role === 'user')!.id)
    expect(
      await repo.listPairIdsFrom('thread-interrupted', {
        timestamp: target!.timestamp!,
        id: target!.id,
      }),
    ).toEqual(['I'])

    const deletedIds = await repo.softDeleteFromMessage(
      'thread-interrupted',
      interrupted.id,
      'user',
    )
    expect(deletedIds).toHaveLength(2)
    const after = await db.select().from(threadMessages)
    expect(after.every((row) => row.status === 'deleted')).toBe(true)
  })

  it('同一轮同一文件保留首次前态并更新最终哈希', async () => {
    const db = drizzle(sqlite, { schema: { threads, threadMessages, fileChangeSnapshots } })
    const repo = new FileSnapshotRepository(db as never)
    await repo.upsert({
      id: 's1',
      threadId: 't',
      pairId: 'B',
      callId: 'c1',
      filePath: 'note.md',
      operation: 'modify',
      originalContent: '初始',
      originalSha256: 'h0',
      finalSha256: 'h1',
    })
    await repo.upsert({
      id: 's2',
      threadId: 't',
      pairId: 'B',
      callId: 'c2',
      filePath: 'note.md',
      operation: 'modify',
      originalContent: '中间',
      originalSha256: 'h1',
      finalSha256: 'h2',
    })
    const rows = await db
      .select()
      .from(fileChangeSnapshots)
      .where(eq(fileChangeSnapshots.pairId, 'B'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      originalContent: '初始',
      originalSha256: 'h0',
      finalSha256: 'h2',
      callId: 'c2',
    })
  })
})
