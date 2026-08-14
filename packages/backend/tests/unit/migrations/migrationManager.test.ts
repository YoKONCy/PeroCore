import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MigrationManager, type DataMigration } from '@infos/backend/migrations'

let root = ''

afterEach(() => rmSync(root, { recursive: true, force: true }))

function createRuntime(migrations: readonly DataMigration[]) {
  root = join(tmpdir(), `infos-migrations-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
  const sqlite = new Database(':memory:')
  const manager = new MigrationManager(root, sqlite, migrations)
  return { manager, sqlite }
}

describe('MigrationManager', () => {
  it('按 ID 排序执行并持久记录完成状态', async () => {
    const calls: string[] = []
    const create = (id: string): DataMigration => ({
      id,
      description: id,
      check: () => true,
      up: () => calls.push(`up:${id}`),
      verify: () => calls.push(`verify:${id}`),
    })
    const { manager, sqlite } = createRuntime([create('002-second'), create('001-first')])

    const result = await manager.runPending()
    sqlite.close()

    expect(calls).toEqual([
      'up:001-first',
      'verify:001-first',
      'up:002-second',
      'verify:002-second',
    ])
    expect(result.completed).toEqual(['001-first', '002-second'])
    const state = JSON.parse(readFileSync(join(root, 'migrations', 'migration-state.json'), 'utf8'))
    expect(state.completed.map((entry: { id: string }) => entry.id)).toEqual([
      '001-first',
      '002-second',
    ])
  })

  it('已完成迁移不会重复执行', async () => {
    let runs = 0
    const migration: DataMigration = {
      id: '001-once',
      description: '只执行一次',
      check: () => true,
      up: () => {
        runs += 1
      },
      verify: () => undefined,
    }
    const { manager, sqlite } = createRuntime([migration])
    await manager.runPending()
    await manager.runPending()
    sqlite.close()
    expect(runs).toBe(1)
  })

  it('失败时保留 Journal 且不写完成状态，下次可恢复', async () => {
    let shouldFail = true
    const migration: DataMigration = {
      id: '001-resume',
      description: '恢复测试',
      check: () => true,
      up: (context) => {
        context.writeJournal({ stage: 'copied' })
        if (shouldFail) throw new Error('模拟断电')
      },
      verify: (context) => {
        expect(context.readJournal()).toEqual({ stage: 'copied' })
      },
    }
    const { manager, sqlite } = createRuntime([migration])

    await expect(manager.runPending()).rejects.toThrow('模拟断电')
    const journal = join(root, 'migrations', 'journals', '001-resume.json')
    expect(existsSync(journal)).toBe(true)

    shouldFail = false
    await expect(manager.runPending()).resolves.toEqual({ completed: ['001-resume'], skipped: [] })
    expect(existsSync(journal)).toBe(false)
    sqlite.close()
  })

  it('check 返回 false 时记录完成但不执行 up', async () => {
    let ran = false
    const { manager, sqlite } = createRuntime([
      {
        id: '001-not-needed',
        description: '无需迁移',
        check: () => false,
        up: () => {
          ran = true
        },
        verify: () => undefined,
      },
    ])
    const result = await manager.runPending()
    sqlite.close()
    expect(ran).toBe(false)
    expect(result.skipped).toEqual(['001-not-needed'])
  })
})
