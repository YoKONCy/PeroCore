/**
 * 全新数据库基线回归测试
 *
 * 验证当前 Drizzle Schema 生成的单一基线能够从零创建完整数据库，
 * 并允许关键 Repository Schema 直接查询。
 */
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDrizzleConnection } from '@infos/backend/database'
import * as currentSchema from '@infos/backend/database/schema'
import { backgroundTasks } from '@infos/backend/database/schema'
import { getTableConfig } from 'drizzle-orm/sqlite-core'

let databasePath = ''

afterEach(() => {
  rmSync(databasePath, { force: true })
  rmSync(`${databasePath}-wal`, { force: true })
  rmSync(`${databasePath}-shm`, { force: true })
})

describe('全新数据库基线', () => {
  it('从零创建当前 background_tasks Schema 并支持 Drizzle 查询', () => {
    databasePath = join(tmpdir(), `infos-baseline-${Date.now()}-${Math.random()}.db`)

    const db = createDrizzleConnection(databasePath)
    const sqlite = (db as unknown as { $client: Database.Database }).$client
    try {
      const columnNames = (
        sqlite.prepare('PRAGMA table_info(background_tasks)').all() as Array<{ name: string }>
      ).map((column) => column.name)

      const schemaTables = Object.values(currentSchema).filter(
        (value): value is typeof backgroundTasks =>
          typeof value === 'object' && value !== null && Symbol.for('drizzle:Name') in value,
      )
      expect(schemaTables).toHaveLength(46)

      for (const table of schemaTables) {
        const config = getTableConfig(table)
        const actualColumns = (
          sqlite.prepare(`PRAGMA table_info("${config.name}")`).all() as Array<{ name: string }>
        ).map((column) => column.name)
        const expectedColumns = config.columns.map((column) => column.name)
        expect(actualColumns, `${config.name} 基线列与 Drizzle Schema 不一致`).toEqual(
          expectedColumns,
        )
      }

      expect(columnNames).toEqual(
        expect.arrayContaining([
          'id',
          'agent_id',
          'thread_id',
          'target_thread_id',
          'category',
          'input_question',
          'input_context_json',
          'checkpoint_json',
          'read_at',
        ]),
      )
      expect(db.select().from(backgroundTasks).all()).toEqual([])
    } finally {
      sqlite.close()
    }
  })
})
