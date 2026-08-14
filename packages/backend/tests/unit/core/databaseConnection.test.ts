/**
 * 数据库旧版本增量修补回归测试
 *
 * 模拟已经存在 configs 与旧版 background_tasks 表、但尚未执行 0013 迁移的用户数据库，
 * 验证 createDrizzleConnection 启动时会补齐任务中心新增字段与索引。
 */
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDrizzleConnection } from '@infos/backend/database'

let databasePath = ''

afterEach(() => {
  rmSync(databasePath, { force: true })
  rmSync(`${databasePath}-wal`, { force: true })
  rmSync(`${databasePath}-shm`, { force: true })
})

describe('数据库旧版本增量修补', () => {
  it('启动旧数据库时补齐 background_tasks 的 0013 字段与分类索引', () => {
    databasePath = join(tmpdir(), `infos-schema-fixup-${Date.now()}-${Math.random()}.db`)
    const legacySqlite = new Database(databasePath)
    legacySqlite.exec(`
      CREATE TABLE configs (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      CREATE TABLE background_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        title TEXT NOT NULL,
        instruction TEXT NOT NULL,
        status TEXT DEFAULT 'queued' NOT NULL,
        checkpoint_json TEXT,
        metadata_json TEXT DEFAULT '{}' NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    legacySqlite.close()

    const db = createDrizzleConnection(databasePath)
    const sqlite = (db as unknown as { $client: Database.Database }).$client
    const columns = sqlite.prepare('PRAGMA table_info(background_tasks)').all() as Array<{
      name: string
    }>
    const columnNames = columns.map((column) => column.name)
    const categoryIndex = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_background_tasks_category'",
      )
      .get()

    expect(columnNames).toEqual(
      expect.arrayContaining([
        'target_thread_id',
        'category',
        'input_question',
        'input_context_json',
      ]),
    )
    expect(categoryIndex).toBeTruthy()
    sqlite.close()
  })
})
