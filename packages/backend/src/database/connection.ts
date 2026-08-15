/**
 * SQLite 连接管理
 *
 * 使用 better-sqlite3 + Drizzle ORM 创建 SQLite 连接。
 * 自动设置 WAL 模式和性能优化 PRAGMA。
 * 首次启动执行当前版本的完整数据库基线。
 *
 * @module packages/backend/src/database/connection
 */

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { createLogger } from '../lib/logger'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync, existsSync, renameSync, rmSync } from 'node:fs'

const logger = createLogger('Database')

/** Drizzle 数据库实例类型 */
export type DrizzleDb = ReturnType<typeof createDrizzleConnection>

/**
 * 创建并配置 Drizzle + SQLite 连接
 * @param databasePath - SQLite 文件路径
 */
export function createDrizzleConnection(databasePath: string) {
  logger.info(`正在连接数据库 → ${databasePath}`)

  // Steam Cloud 下载不能覆盖正在打开的 SQLite。Electron 将云端快照写为
  // infos.db.cloud-pending，Daemon 下次启动在建连前原子替换主库。
  const pendingRestorePath = `${databasePath}.cloud-pending`
  if (existsSync(pendingRestorePath)) {
    const backupPath = `${databasePath}.before-cloud-restore`
    try {
      rmSync(backupPath, { force: true })
      if (existsSync(databasePath)) renameSync(databasePath, backupPath)
      renameSync(pendingRestorePath, databasePath)
      rmSync(`${databasePath}-wal`, { force: true })
      rmSync(`${databasePath}-shm`, { force: true })
      logger.info(`已在启动前恢复 Steam Cloud 数据库快照，旧库备份: ${backupPath}`)
    } catch (error) {
      logger.error(`恢复 Steam Cloud 数据库快照失败: ${error}`)
      if (!existsSync(databasePath) && existsSync(backupPath)) renameSync(backupPath, databasePath)
    }
  }

  const sqlite = new Database(databasePath)

  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('cache_size = -20000')
  sqlite.pragma('foreign_keys = ON')

  const tableCheck = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='configs'")
    .get()

  if (!tableCheck) {
    logger.info('检测到首次启动，正在创建数据库表...')
    try {
      const appRoot = process.env.PERO_APP_ROOT
      const migrationsDir = appRoot
        ? resolve(appRoot, 'backend', 'src', 'database', 'migrations')
        : resolve(dirname(fileURLToPath(import.meta.url)), 'migrations')
      const baselineFiles = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort()

      if (baselineFiles.length !== 1) {
        throw new Error(`数据库基线数量错误，期望 1 个，实际 ${baselineFiles.length} 个`)
      }

      const sqlContent = readFileSync(resolve(migrationsDir, baselineFiles[0]!), 'utf8')
      const statements = sqlContent
        .split('--\x3e statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)

      sqlite.transaction(() => {
        for (const statement of statements) sqlite.exec(statement)
      })()
      logger.success(`数据库初始化完成: ${baselineFiles[0]}`)
    } catch (error) {
      sqlite.close()
      logger.error(`数据库初始化失败: ${error}`)
      throw error
    }
  }

  const db = drizzle(sqlite, { schema })
  logger.success('数据库连接成功')
  return db
}
