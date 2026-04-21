/**
 * SQLite 连接管理
 *
 * 使用 better-sqlite3 + Drizzle ORM 创建 SQLite 连接。
 * 自动设置 WAL 模式和性能优化 PRAGMA。
 * 首次启动自动检测并建表。
 *
 * @module packages/backend/src/database/connection
 */

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { createLogger } from '../lib/logger'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'

const logger = createLogger('Database')

/** Drizzle 数据库实例类型 */
export type DrizzleDb = ReturnType<typeof createDrizzleConnection>

/**
 * 创建并配置 Drizzle + SQLite 连接
 * @param databasePath - SQLite 文件路径
 */
export function createDrizzleConnection(databasePath: string) {
  logger.info(`正在连接数据库 → ${databasePath}`)

  const sqlite = new Database(databasePath)

  // SQLite 性能优化
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('cache_size = -20000') // 20MB 缓存
  sqlite.pragma('foreign_keys = ON')

  // ── 首次启动自动建表 ──────────────────────────────────────
  // 检测核心表是否存在，不存在则执行全部 migration SQL
  const tableCheck = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='configs'",
  ).get()

  if (!tableCheck) {
    logger.info('检测到首次启动，正在创建数据库表...')
    try {
      const __dirname = dirname(fileURLToPath(import.meta.url))
      const migrationsDir = resolve(__dirname, 'migrations')
      const sqlFiles = readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort()

      for (const file of sqlFiles) {
        const sqlContent = readFileSync(resolve(migrationsDir, file), 'utf8')
        // Drizzle 用 `-->statement-breakpoint` 分隔语句
        const statements = sqlContent
          .split('--\x3e statement-breakpoint')
          .map((s) => s.trim())
          .filter(Boolean)

        for (const stmt of statements) {
          sqlite.exec(stmt)
        }
        logger.info(`已执行迁移: ${file}`)
      }
      logger.success(`数据库初始化完成 (${sqlFiles.length} 个迁移文件)`)
    } catch (err) {
      logger.error(`数据库初始化失败: ${err}`)
      throw err // 建表失败是致命错误，不能静默
    }
  }

  const db = drizzle(sqlite, { schema })
  logger.success('数据库连接成功')
  return db
}
