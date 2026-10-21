import { t as __t } from '../lib/i18n'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from './schema'
import { applySchemaMigrations } from './schemaMigrations'
import { createLogger } from '../lib/logger'

const logger = createLogger('DatabaseMigration')

const databasePath = path.resolve(process.env.PERO_DATABASE_PATH ?? './data/infos.db')
mkdirSync(path.dirname(databasePath), { recursive: true })
const sqlite = new Database(databasePath)
try {
  sqlite.pragma('foreign_keys = ON')
  const existingDatabase = Boolean(
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='configs'").get(),
  )
  const db = drizzle(sqlite, { schema })
  const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
  applySchemaMigrations(sqlite, db, migrationsDir, existingDatabase)
  logger.success(__t('logs.database', '数据库结构迁移完成：{0}', [databasePath]))
} finally {
  sqlite.close()
}
