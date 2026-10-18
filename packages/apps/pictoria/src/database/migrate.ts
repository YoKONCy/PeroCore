import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

const migrations = [{ version: 1, file: '0001_pictoria.sql' }] as const

/** 迁移只在 Host 初始化时执行，业务服务不补表或补列。 */
export function migrate(db: Database.Database, migrationRoot: string): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)',
  )
  const current = db
    .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: number; checksum: string }>
  if (current.some((m) => m.version > migrations.length))
    throw new Error('数据版本高于当前程序，拒绝降级打开')
  for (const entry of migrations) {
    const sql = readFileSync(path.join(migrationRoot, entry.file), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const applied = current.find((m) => m.version === entry.version)
    if (applied) {
      if (applied.checksum !== checksum) throw new Error(`迁移文件校验失败：${entry.file}`)
      continue
    }
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(entry.version, checksum)
    })()
  }
}
