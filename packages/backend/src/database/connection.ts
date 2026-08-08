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
  const tableCheck = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='configs'")
    .get()

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
  } else {
    // ── 增量 Schema 修补 (旧数据库兼容) ──
    applySchemaFixups(sqlite)
  }

  const db = drizzle(sqlite, { schema })
  logger.success('数据库连接成功')
  return db
}

/**
 * 增量 Schema 修补
 *
 * 对已有数据库应用缺失的约束和列。
 * 每个修补都是幂等的 (先检测再执行)。
 */
function applySchemaFixups(sqlite: Database.Database): void {
  // ── AIOS Fixup: thread_messages.scorer_status 列 ──
  // 替代 conversation_logs.scorer_status，Scorer 直接从 thread_messages 读取待处理对话
  try {
    const columns = sqlite.prepare("PRAGMA table_info(thread_messages)").all() as Array<{ name: string }>
    const hasScorerStatus = columns.some((c) => c.name === 'scorer_status')
    if (!hasScorerStatus) {
      logger.info('修补: 为 thread_messages 添加 scorer_status 列')
      sqlite.exec(`
        ALTER TABLE thread_messages ADD COLUMN scorer_status TEXT DEFAULT 'pending';
        CREATE INDEX IF NOT EXISTS idx_thread_messages_scorer_status ON thread_messages(scorer_status);
      `)
      logger.success('修补完成: thread_messages.scorer_status 已添加')
    }
  } catch (err) {
    logger.warn(`Schema 修补失败 (thread_messages.scorer_status): ${err}`)
  }

  // ── AIOS Fixup: threads.context_policy 列 ──
  // 第六阶段 #3：把 ContextPolicy 从硬编码 DEFAULT_POLICIES 改为 Thread 可配置属性
  try {
    const threadColumns = sqlite.prepare("PRAGMA table_info(threads)").all() as Array<{
      name: string
    }>
    const hasContextPolicy = threadColumns.some((c) => c.name === 'context_policy')
    if (!hasContextPolicy) {
      logger.info('修补: 为 threads 添加 context_policy 列')
      sqlite.exec(`ALTER TABLE threads ADD COLUMN context_policy TEXT;`)
      logger.success('修补完成: threads.context_policy 已添加')
    }
  } catch (err) {
    logger.warn(`Schema 修补失败 (threads.context_policy): ${err}`)
  }

  // Fixup 1: trivium_sync_tasks.dedupe_key 需要 UNIQUE 约束
  // (onConflictDoUpdate 要求 target 列必须有 UNIQUE 或 PRIMARY KEY 约束)
  try {
    const hasUniqueIdx = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='trivium_sync_tasks' AND sql LIKE '%UNIQUE%dedupe_key%'",
      )
      .get()

    if (!hasUniqueIdx) {
      logger.info('修补: 为 trivium_sync_tasks.dedupe_key 添加 UNIQUE 约束')
      sqlite.exec(`
        -- 清理可能的重复数据，保留最新的
        DELETE FROM trivium_sync_tasks WHERE id NOT IN (
          SELECT MAX(id) FROM trivium_sync_tasks GROUP BY dedupe_key
        );
        -- 删除旧的非 UNIQUE 索引
        DROP INDEX IF EXISTS idx_trivium_sync_tasks_dedupe_key;
        -- 创建 UNIQUE 索引
        CREATE UNIQUE INDEX IF NOT EXISTS trivium_sync_tasks_dedupe_key_unique ON trivium_sync_tasks(dedupe_key);
      `)
      logger.success('修补完成: trivium_sync_tasks.dedupe_key UNIQUE 约束已添加')
    }
  } catch (err) {
    logger.warn(`Schema 修补失败 (非致命): ${err}`)
  }

  // ── AIOS Fixup: 应用层表结构（app_registry / app_instances / app_checkpoints / app_resource_grants）──
  // 第八阶段新增的应用平台基础设施表。
  // 旧数据库（0003 迁移之前创建）不会自动应用 0003 迁移，需在此增量补建。
  try {
    const hasAppInstances = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_instances'")
      .get()

    if (!hasAppInstances) {
      logger.info('修补: 创建应用层表结构（app_registry / app_instances / app_checkpoints / app_resource_grants）')
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS \`app_registry\` (
          \`app_id\` text PRIMARY KEY NOT NULL,
          \`name\` text NOT NULL,
          \`version\` text NOT NULL,
          \`install_path\` text NOT NULL,
          \`manifest_json\` text NOT NULL,
          \`installed_at\` text DEFAULT (datetime('now', 'localtime')),
          \`updated_at\` text DEFAULT (datetime('now', 'localtime'))
        );
        CREATE TABLE IF NOT EXISTS \`app_instances\` (
          \`instance_id\` text PRIMARY KEY NOT NULL,
          \`app_id\` text NOT NULL,
          \`host_agent_id\` text NOT NULL,
          \`status\` text DEFAULT 'launching',
          \`workspace_path\` text,
          \`task_context_json\` text,
          \`launched_by\` text,
          \`launched_at\` text DEFAULT (datetime('now', 'localtime')),
          \`stopped_at\` text,
          \`error\` text
        );
        CREATE INDEX IF NOT EXISTS \`idx_app_instances_host\` ON \`app_instances\` (\`host_agent_id\`, \`status\`);
        CREATE INDEX IF NOT EXISTS \`idx_app_instances_app\` ON \`app_instances\` (\`app_id\`, \`status\`);
        CREATE TABLE IF NOT EXISTS \`app_checkpoints\` (
          \`instance_id\` text PRIMARY KEY NOT NULL,
          \`status\` text NOT NULL,
          \`summary\` text NOT NULL,
          \`progress\` real DEFAULT 0,
          \`fields_json\` text NOT NULL,
          \`changed_artifacts_json\` text,
          \`blockers_json\` text,
          \`next_actions_json\` text,
          \`updated_at\` text DEFAULT (datetime('now', 'localtime'))
        );
        CREATE TABLE IF NOT EXISTS \`app_resource_grants\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`owner_agent_id\` text NOT NULL,
          \`holder_id\` text NOT NULL,
          \`holder_type\` text NOT NULL,
          \`resource_kind\` text NOT NULL,
          \`resource_json\` text NOT NULL,
          \`permissions\` text NOT NULL,
          \`granted_by\` text DEFAULT 'host_agent',
          \`note\` text,
          \`created_at\` text DEFAULT (datetime('now', 'localtime')),
          \`expires_at\` text,
          \`revoked\` integer DEFAULT 0,
          \`revoked_at\` text
        );
        CREATE INDEX IF NOT EXISTS \`idx_grants_holder\` ON \`app_resource_grants\` (\`holder_id\`, \`revoked\`);
        CREATE INDEX IF NOT EXISTS \`idx_grants_owner\` ON \`app_resource_grants\` (\`owner_agent_id\`);
      `)
      logger.success('修补完成: 应用层表结构已创建')
    }
  } catch (err) {
    logger.warn(`Schema 修补失败 (应用层表结构): ${err}`)
  }
}
