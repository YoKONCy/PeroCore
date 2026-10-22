import { t as __t } from '../lib/i18n'
import path from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { createLogger } from '../lib/logger'
import { retryStartupIo } from '../lib/startupStorage'
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
    this.lockPath = path.join(this.rootDir, 'migration-lock.sqlite')
    this.validateRegistry()
  }

  async runPending(): Promise<MigrationRunResult> {
    // 无需迁移时不创建目录或锁，避免无关的文件状态阻断正常启动。
    if (this.migrations.length === 0) return { completed: [], skipped: [] }
    const completed = new Set(this.readState().completed.map((entry) => entry.id))
    if (this.migrations.every((migration) => completed.has(migration.id))) {
      return { completed: [], skipped: this.migrations.map((migration) => migration.id).sort() }
    }
    await retryStartupIo(() => mkdirSync(this.journalDir, { recursive: true }))
    const releaseLock = await this.acquireLock()
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
        logger.info(
          __t('logs.migrations', '检查数据迁移: {0} — {1}', [migration.id, migration.description]),
        )
        if (!(await migration.check(context))) {
          this.recordCompleted(state, migration)
          completedIds.add(migration.id)
          result.skipped.push(migration.id)
          this.removeJournal(context.journalPath)
          logger.info(__t('logs.migrations', '数据迁移无需执行，已记录完成: {0}', [migration.id]))
          continue
        }

        logger.info(__t('logs.migrations', '开始数据迁移: {0}', [migration.id]))
        try {
          await migration.up(context)
          await migration.verify(context)
          this.recordCompleted(state, migration)
          completedIds.add(migration.id)
          result.completed.push(migration.id)
          this.removeJournal(context.journalPath)
          logger.info(__t('logs.migrations', '数据迁移完成: {0}', [migration.id]))
        } catch (error) {
          logger.error(
            __t('logs.migrations', '数据迁移失败，将在下次启动重试: {0}', [migration.id]),
            error,
          )
          throw error
        }
      }

      return result
    } finally {
      releaseLock()
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
    try {
      rmSync(journalPath, { force: true })
    } catch (error) {
      // 完成状态已经落盘，清理临时记录失败不应再次阻断后端。
      logger.warn(
        __t('logs.migrations', '迁移已完成，暂无法清理恢复记录: {0}；原因: {1}', [
          journalPath,
          String(error),
        ]),
      )
    }
  }

  private async acquireLock(): Promise<() => void> {
    let connection: Database.Database | undefined
    try {
      // 独立数据库只负责进程互斥，不占用业务数据库的迁移事务。
      // 不删除锁数据库；连接关闭或进程异常退出时由 SQLite 释放系统锁。
      connection = await retryStartupIo(() => new Database(this.lockPath, { timeout: 0 }))
      const deadline = Date.now() + 5000
      for (;;) {
        try {
          connection.exec('BEGIN IMMEDIATE')
          break
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (!['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(code ?? '') || Date.now() >= deadline) {
            throw error
          }
          // 不同步阻塞事件循环，让同进程中持锁的异步迁移有机会完成。
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      }
      // 兼容旧版留下的标记，只尊重仍存活的旧版进程，不再删除或重建旧锁文件。
      const legacyPath = path.join(this.rootDir, 'migration.lock')
      const legacyLock = this.readJson<{ pid?: number }>(legacyPath)
      if (legacyLock?.pid && this.isProcessAlive(legacyLock.pid)) {
        throw new Error(`另一个数据迁移进程正在运行: ${legacyPath}`)
      }
      const acquired = connection
      return () => acquired.close()
    } catch (cause) {
      connection?.close()
      const error = cause as NodeJS.ErrnoException
      const detail = `${error.code ?? error.name ?? 'Error'}: ${error.message ?? String(cause)}`
      logger.error(
        __t('logs.migrations', '获取数据迁移锁失败: {0}；原因: {1}', [this.lockPath, detail]),
        cause,
      )
      throw new Error(`数据迁移锁获取失败: ${this.lockPath}；原因: ${detail}`, { cause })
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      // 无权探测不等于进程已经退出，不能据此允许并发迁移。
      return (error as NodeJS.ErrnoException).code !== 'ESRCH'
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
