/**
 * 数据库旧版本增量修补回归测试
 *
 * 模拟仅有早期任务字段的用户数据库，验证启动修补会先补齐当前完整 Schema，
 * 再创建索引，并允许 Drizzle 查询与重复启动。
 */
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDrizzleConnection } from '@infos/backend/database'
import { backgroundTasks } from '@infos/backend/database/schema'

let databasePath = ''

afterEach(() => {
  rmSync(databasePath, { force: true })
  rmSync(`${databasePath}-wal`, { force: true })
  rmSync(`${databasePath}-shm`, { force: true })
})

describe('数据库旧版本增量修补', () => {
  it('幂等补齐 background_tasks 完整 Schema、索引并保留旧数据', () => {
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
        status TEXT DEFAULT 'queued' NOT NULL
      );
      INSERT INTO background_tasks (id, agent_id, thread_id, title, instruction, status)
      VALUES ('legacy-task', 'pero', 'legacy-thread', '旧任务', '继续执行', 'queued');
    `)
    legacySqlite.close()

    const firstDb = createDrizzleConnection(databasePath)
    const firstSqlite = (firstDb as unknown as { $client: Database.Database }).$client
    const columnNames = (
      firstSqlite.prepare('PRAGMA table_info(background_tasks)').all() as Array<{ name: string }>
    ).map((column) => column.name)
    const indexNames = (
      firstSqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'background_tasks'",
        )
        .all() as Array<{ name: string }>
    ).map((index) => index.name)

    expect(columnNames).toEqual(
      expect.arrayContaining([
        'target_thread_id',
        'progress',
        'current_stage',
        'result',
        'error_message',
        'tool_call_count',
        'priority',
        'parent_task_id',
        'requested_by',
        'completion_action',
        'category',
        'input_question',
        'input_context_json',
        'checkpoint_json',
        'metadata_json',
        'created_at',
        'started_at',
        'completed_at',
        'updated_at',
        'read_at',
      ]),
    )
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'idx_background_tasks_agent_id',
        'idx_background_tasks_status',
        'idx_background_tasks_thread_id',
        'idx_background_tasks_target_thread_id',
        'idx_background_tasks_created_at',
        'idx_background_tasks_category',
      ]),
    )

    const rows = firstDb.select().from(backgroundTasks).all()
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'legacy-task',
        agentId: 'pero',
        category: 'agent_task',
        readAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    ])
    firstSqlite.close()

    const secondDb = createDrizzleConnection(databasePath)
    const secondSqlite = (secondDb as unknown as { $client: Database.Database }).$client
    expect(secondDb.select().from(backgroundTasks).all()).toHaveLength(1)
    secondSqlite.close()
  })
})
