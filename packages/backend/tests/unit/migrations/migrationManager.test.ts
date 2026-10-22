import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MigrationManager, type DataMigration } from '@infos/backend/migrations'

let root = ''

afterEach(() => rmSync(root, { recursive: true, force: true }))

function createRuntime(migrations: readonly DataMigration[]) {
  root = join(
    process.env.INFOS_TEST_TEMP_ROOT ?? join(process.cwd(), 'TEMP'),
    `infos-migrations-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(root, { recursive: true })
  const sqlite = new Database(':memory:')
  const manager = new MigrationManager(root, sqlite, migrations)
  return { manager, sqlite }
}

describe('MigrationManager', () => {
  it('空注册表不访问迁移目录，遗留标记不会阻断启动', async () => {
    const { manager, sqlite } = createRuntime([])
    // 用普通文件占据目录名，确保跳过路径不偷偷创建目录或锁。
    writeFileSync(join(root, 'migrations'), '保留现场')
    try {
      await expect(manager.runPending()).resolves.toEqual({ completed: [], skipped: [] })
      expect(readFileSync(join(root, 'migrations'), 'utf8')).toBe('保留现场')
    } finally {
      sqlite.close()
    }
  })

  it('全部完成后不再取锁，也不清理旧版标记', async () => {
    const { manager, sqlite } = createRuntime([
      {
        id: '001-completed',
        description: '已完成迁移',
        check: () => false,
        up: () => undefined,
        verify: () => undefined,
      },
    ])
    try {
      await manager.runPending()
      const lock = join(root, 'migrations', 'migration.lock')
      writeFileSync(lock, JSON.stringify({ pid: process.pid }))
      await expect(manager.runPending()).resolves.toEqual({
        completed: [],
        skipped: ['001-completed'],
      })
      expect(existsSync(lock)).toBe(true)
    } finally {
      sqlite.close()
    }
  })

  it('两个管理器等待同一互斥锁，迁移仅执行一次', async () => {
    let runs = 0
    let release!: () => void
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const migrations: DataMigration[] = [
      {
        id: '001-concurrent',
        description: '并发迁移',
        check: () => true,
        up: async () => {
          runs += 1
          entered()
          await waiting
        },
        verify: () => undefined,
      },
    ]
    const { manager, sqlite } = createRuntime(migrations)
    try {
      const first = manager.runPending()
      await started
      const second = new MigrationManager(root, sqlite, migrations).runPending()
      release()
      const results = await Promise.all([first, second])
      expect(runs).toBe(1)
      expect(results).toEqual([
        { completed: ['001-concurrent'], skipped: [] },
        { completed: [], skipped: ['001-concurrent'] },
      ])
    } finally {
      release()
      sqlite.close()
    }
  })

  it('取锁失败保留原始错误码与异常原因', async () => {
    const { manager, sqlite } = createRuntime([
      {
        id: '001-unavailable',
        description: '锁不可用',
        check: () => true,
        up: () => undefined,
        verify: () => undefined,
      },
    ])
    mkdirSync(join(root, 'migrations', 'migration-lock.sqlite'), { recursive: true })
    try {
      await expect(manager.runPending()).rejects.toMatchObject({
        message: expect.stringContaining('SQLITE_CANTOPEN'),
        // SQLite 版本与平台可能返回扩展码，例如 SQLITE_CANTOPEN_ISDIR。
        cause: expect.objectContaining({ code: expect.stringMatching(/^SQLITE_CANTOPEN(?:_|$)/) }),
      })
    } finally {
      sqlite.close()
    }
  })

  it('尊重旧版存活进程的迁移标记，失败后释放新锁', async () => {
    const { manager, sqlite } = createRuntime([
      {
        id: '001-legacy',
        description: '兼容旧版锁',
        check: () => false,
        up: () => undefined,
        verify: () => undefined,
      },
    ])
    mkdirSync(join(root, 'migrations'), { recursive: true })
    const lock = join(root, 'migrations', 'migration.lock')
    writeFileSync(lock, JSON.stringify({ pid: process.pid }))
    try {
      await expect(manager.runPending()).rejects.toThrow('另一个数据迁移进程正在运行')
      expect(existsSync(lock)).toBe(true)
      rmSync(lock)
      await expect(manager.runPending()).resolves.toEqual({
        completed: [],
        skipped: ['001-legacy'],
      })
    } finally {
      sqlite.close()
    }
  })

  it('按 ID 排序执行并持久记录完成状态', async () => {
    const calls: string[] = []
    const create = (id: string): DataMigration => ({
      id,
      description: id,
      check: () => true,
      up: () => {
        calls.push(`up:${id}`)
      },
      verify: () => {
        calls.push(`verify:${id}`)
      },
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
