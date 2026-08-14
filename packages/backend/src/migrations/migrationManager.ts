import path from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { createLogger } from '../lib/logger'
import type {
  DataMigration,
  DataMigrationContext,
  MigrationRunResult,
  MigrationState,
} from './migrationTypes'

const logger = createLogger('MigrationManager')
const EMPTY_STATE: MigrationState = { schemaVersion: 1, completed: [] }

export class MigrationManager {
  private readonly rootDir: string
  private readonly statePath: string
  private readonly journalDir: string
  private readonly lockPath: string

  constructor(
    private readonly dataDir: string,
    private readonly sqlite: Database.Database,
    private readonly migrations: readonly DataMigration[],
  ) {
    this.rootDir = path.join(dataDir, 'migrations')
    this.statePath = path.join(this.rootDir, 'migration-state.json')
    this.journalDir = path.join(this.rootDir, 'journals')
    this.lockPath = path.join(this.rootDir, 'migration.lock')
    this.validateRegistry()
  }

  async runPending(): Promise<MigrationRunResult> {
    mkdirSync(this.journalDir, { recursive: true })
    this.acquireLock()
    try {
      const state = this.readState()
      const completedIds = new Set(state.completed.map((entry) => entry.id))
      const result: MigrationRunResult = { completed: [], skipped: [] }

      for (const migration of [...this.migrations].sort((a, b) => a.id.localeCompare(b.id))) {
        if (completedIds.has(migration.id)) {
          result.skipped.push(migration.id)
          continue
        }

        const context = this.createContext(migration.id)
        logger.info(`检查数据迁移: ${migration.id} — ${migration.description}`)
        if (!(await migration.check(context))) {
          this.recordCompleted(state, migration)
          completedIds.add(migration.id)
          result.skipped.push(migration.id)
          this.removeJournal(context.journalPath)
          logger.info(`数据迁移无需执行，已记录完成: ${migration.id}`)
          continue
        }

        logger.info(`开始数据迁移: ${migration.id}`)
        try {
          await migration.up(context)
          await migration.verify(context)
          this.recordCompleted(state, migration)
          completedIds.add(migration.id)
          result.completed.push(migration.id)
          this.removeJournal(context.journalPath)
          logger.info(`数据迁移完成: ${migration.id}`)
        } catch (error) {
          logger.error(`数据迁移失败，将在下次启动重试: ${migration.id}`, error)
          throw error
        }
      }

      return result
    } finally {
      rmSync(this.lockPath, { force: true })
    }
  }

  private createContext(migrationId: string): DataMigrationContext {
    const journalPath = path.join(this.journalDir, `${migrationId}.json`)
    return {
      dataDir: this.dataDir,
      sqlite: this.sqlite,
      journalPath,
      writeJournal: (data) => this.atomicWriteJson(journalPath, data),
      readJournal: <T extends Record<string, unknown>>() => this.readJson<T>(journalPath),
    }
  }

  private recordCompleted(state: MigrationState, migration: DataMigration): void {
    state.completed.push({
      id: migration.id,
      description: migration.description,
      completedAt: new Date().toISOString(),
    })
    this.atomicWriteJson(this.statePath, state)
  }

  private readState(): MigrationState {
    const state = this.readJson<MigrationState>(this.statePath)
    if (!state) return structuredClone(EMPTY_STATE)
    if (state.schemaVersion !== 1 || !Array.isArray(state.completed)) {
      throw new Error(`不支持的数据迁移状态格式: ${this.statePath}`)
    }
    return state
  }

  private readJson<T>(filePath: string): T | null {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  }

  private atomicWriteJson(filePath: string, value: unknown): void {
    mkdirSync(path.dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, filePath)
  }

  private removeJournal(journalPath: string): void {
    rmSync(journalPath, { force: true })
  }

  private acquireLock(): void {
    if (existsSync(this.lockPath)) {
      const lock = this.readJson<{ pid?: number }>(this.lockPath)
      if (lock?.pid && this.isProcessAlive(lock.pid)) {
        throw new Error(`另一个数据迁移进程正在运行: ${this.lockPath}`)
      }
      rmSync(this.lockPath, { force: true })
      logger.warn(`已清理异常退出留下的数据迁移锁: ${this.lockPath}`)
    }
    try {
      writeFileSync(
        this.lockPath,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
        {
          encoding: 'utf8',
          flag: 'wx',
        },
      )
    } catch {
      throw new Error(`无法获取数据迁移锁: ${this.lockPath}`)
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  private validateRegistry(): void {
    const ids = new Set<string>()
    for (const migration of this.migrations) {
      if (!/^[a-z0-9][a-z0-9._-]+$/i.test(migration.id)) {
        throw new Error(`非法迁移 ID: ${migration.id}`)
      }
      if (ids.has(migration.id)) throw new Error(`重复迁移 ID: ${migration.id}`)
      ids.add(migration.id)
    }
  }
}
