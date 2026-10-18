import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

interface MigrationJournal {
  entries: Array<{ tag: string; when: number }>
}

/** 旧版启动器直接执行基线，先登记该事实，再交给 Drizzle 运行后续标准迁移。 */
export function applySchemaMigrations(
  sqlite: Database.Database,
  db: Parameters<typeof migrate>[0],
  migrationsDir: string,
  existingDatabase: boolean,
): void {
  if (existingDatabase) {
    const journal = JSON.parse(
      readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
    ) as MigrationJournal
    const baseline = journal.entries[0]
    if (baseline?.tag !== '0000_baseline' || !Number.isFinite(baseline.when)) {
      throw new Error('数据库迁移日志缺少有效的 0000_baseline')
    }
    const baselineSql = readFileSync(path.join(migrationsDir, `${baseline.tag}.sql`), 'utf8')
    const baselineHash = createHash('sha256').update(baselineSql).digest('hex')
    sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS __drizzle_migrations (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at numeric
        )
      `)
      const recorded = sqlite.prepare('SELECT 1 FROM __drizzle_migrations LIMIT 1').get()
      if (!recorded) {
        sqlite
          .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
          .run(baselineHash, baseline.when)
      }
    })()
  }

  migrate(db, { migrationsFolder: migrationsDir })
}
