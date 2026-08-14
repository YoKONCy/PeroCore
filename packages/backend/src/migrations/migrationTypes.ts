import type Database from 'better-sqlite3'

export interface DataMigrationContext {
  /** 持久化业务数据根目录。 */
  dataDir: string
  /** 已打开的 SQLite 客户端；数据库内容迁移必须自行使用 transaction。 */
  sqlite: Database.Database
  /** 当前迁移的持久化 Journal 文件绝对路径。 */
  journalPath: string
  /** 原子写入当前迁移的可恢复进度。 */
  writeJournal(data: Record<string, unknown>): void
  /** 读取上次中断留下的可恢复进度。 */
  readJournal<T extends Record<string, unknown>>(): T | null
}

export interface DataMigration {
  /** 永久唯一且可排序的 ID，例如 2026-08-15-principal-layout-v1。发布后不得修改。 */
  id: string
  description: string
  /** 返回 true 表示当前数据需要执行迁移。 */
  check(context: DataMigrationContext): boolean | Promise<boolean>
  /** 必须幂等；文件操作应使用临时路径与原子改名，数据库操作必须使用事务。 */
  up(context: DataMigrationContext): void | Promise<void>
  /** 必须检查最终数据，而不是只检查状态标记。失败时抛出异常。 */
  verify(context: DataMigrationContext): void | Promise<void>
}

export interface MigrationStateEntry {
  id: string
  description: string
  completedAt: string
}

export interface MigrationState {
  schemaVersion: 1
  completed: MigrationStateEntry[]
}

export interface MigrationRunResult {
  completed: string[]
  skipped: string[]
}
