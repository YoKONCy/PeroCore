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
const sqliteConnections = new WeakMap<object, Database.Database>()

function removeLegacyMemorySchema(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    for (const table of [
      'memory_nodes',
      'canonical_memories',
      'memory_candidates',
      'entity_cooccurrences',
      'maintenance_records',
      'trivium_sync_tasks',
    ]) {
      sqlite.exec(`DROP TABLE IF EXISTS ${table}`)
    }
  })()
}

/** 为既有数据库幂等补齐 Kernel 基础表；新库仍由完整基线创建。 */
function ensureKernelResourceSchema(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kernel_outbox_events (
        event_id TEXT PRIMARY KEY NOT NULL,
        event_type TEXT NOT NULL,
        durability TEXT DEFAULT 'durable' NOT NULL,
        principal_id TEXT NOT NULL,
        process_id TEXT,
        execution_id TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        object_type TEXT,
        object_id TEXT,
        object_generation INTEGER,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        status TEXT DEFAULT 'pending' NOT NULL,
        attempts INTEGER DEFAULT 0 NOT NULL,
        last_error TEXT,
        next_attempt_at TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL,
        published_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_kernel_outbox_status_created
        ON kernel_outbox_events (status, created_at);
      CREATE INDEX IF NOT EXISTS idx_kernel_outbox_execution
        ON kernel_outbox_events (execution_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_kernel_outbox_correlation
        ON kernel_outbox_events (correlation_id);

      CREATE TABLE IF NOT EXISTS observer_processed_events (
        event_id TEXT PRIMARY KEY NOT NULL,
        processed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_state_measurements (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        value REAL NOT NULL,
        confidence REAL NOT NULL,
        source_event_id TEXT NOT NULL,
        source_event_type TEXT NOT NULL,
        explanation TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        UNIQUE(source_event_id, metric)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_state_agent_observed
        ON agent_state_measurements (agent_id, observed_at);
      CREATE TABLE IF NOT EXISTS observer_policies (
        agent_id TEXT PRIMARY KEY NOT NULL,
        enabled INTEGER DEFAULT 1 NOT NULL,
        inject_context INTEGER DEFAULT 0 NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kernel_assets (
        asset_id TEXT PRIMARY KEY NOT NULL,
        object_type TEXT DEFAULT 'asset' NOT NULL,
        object_generation INTEGER DEFAULT 1 NOT NULL,
        owner_principal_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        source TEXT NOT NULL,
        storage_ref TEXT NOT NULL,
        retention TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kernel_assets_owner
        ON kernel_assets (owner_principal_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_kernel_assets_sha256 ON kernel_assets (sha256);

      CREATE TABLE IF NOT EXISTS kernel_transfers (
        transfer_id TEXT PRIMARY KEY NOT NULL,
        object_generation INTEGER DEFAULT 1 NOT NULL,
        direction TEXT NOT NULL,
        state TEXT NOT NULL,
        source_ref_json TEXT,
        destination_ref_json TEXT,
        bytes_total INTEGER,
        bytes_transferred INTEGER DEFAULT 0 NOT NULL,
        checksum TEXT,
        result_asset_ref_json TEXT,
        principal_id TEXT NOT NULL,
        process_id TEXT,
        execution_id TEXT,
        correlation_id TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_kernel_transfers_principal
        ON kernel_transfers (principal_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_kernel_transfers_state
        ON kernel_transfers (state, created_at);
      CREATE INDEX IF NOT EXISTS idx_kernel_transfers_execution
        ON kernel_transfers (execution_id, created_at);

      CREATE TABLE IF NOT EXISTS durable_notifications (
        notification_id TEXT PRIMARY KEY NOT NULL,
        principal_id TEXT NOT NULL,
        audience_json TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        level TEXT DEFAULT 'info' NOT NULL,
        status TEXT DEFAULT 'unread' NOT NULL,
        revision INTEGER DEFAULT 1 NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_durable_notifications_principal_status
        ON durable_notifications (principal_id, status, created_at);

      CREATE TABLE IF NOT EXISTS subscription_cursors (
        stream_id TEXT NOT NULL,
        consumer_id TEXT NOT NULL,
        sequence INTEGER DEFAULT 0 NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (stream_id, consumer_id)
      );

      CREATE TABLE IF NOT EXISTS stronghold_agent_pair_visibility (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        agent_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        pair_id TEXT NOT NULL,
        observed_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(agent_id, pair_id)
      );
      CREATE INDEX IF NOT EXISTS idx_stronghold_visibility_agent_observed
        ON stronghold_agent_pair_visibility (agent_id, observed_at);
      CREATE INDEX IF NOT EXISTS idx_stronghold_visibility_pair
        ON stronghold_agent_pair_visibility (pair_id);

      CREATE TABLE IF NOT EXISTS event_notes (
        id TEXT PRIMARY KEY NOT NULL,
        tdb_id INTEGER NOT NULL UNIQUE,
        agent_id TEXT NOT NULL,
        narrative TEXT NOT NULL,
        event_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        importance INTEGER NOT NULL,
        affect_json TEXT NOT NULL,
        participants_json TEXT DEFAULT '[]' NOT NULL,
        places_json TEXT DEFAULT '[]' NOT NULL,
        objects_json TEXT DEFAULT '[]' NOT NULL,
        topics_json TEXT DEFAULT '[]' NOT NULL,
        origin_json TEXT NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        replaced_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_event_notes_agent_event ON event_notes(agent_id, event_at);
      CREATE INDEX IF NOT EXISTS idx_event_notes_agent_status ON event_notes(agent_id, status);
      CREATE TABLE IF NOT EXISTS event_note_coverages (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        pair_ids_json TEXT NOT NULL,
        message_ids_json TEXT NOT NULL,
        outcome TEXT NOT NULL,
        event_note_ids_json TEXT DEFAULT '[]' NOT NULL,
        mode TEXT NOT NULL,
        covered_at TEXT NOT NULL,
        invalidated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_event_coverages_agent_thread ON event_note_coverages(agent_id, thread_id);
      CREATE INDEX IF NOT EXISTS idx_event_coverages_thread_active ON event_note_coverages(thread_id, invalidated_at);
      CREATE TABLE IF NOT EXISTS event_memory_coverage_claims (
        agent_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        pair_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        claimed_at TEXT NOT NULL,
        PRIMARY KEY(agent_id, thread_id, pair_id)
      );
      CREATE INDEX IF NOT EXISTS idx_event_coverage_claim_owner ON event_memory_coverage_claims(owner_id);
      CREATE TABLE IF NOT EXISTS event_memory_operations (
        operation_id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT DEFAULT 'pending' NOT NULL,
        attempts INTEGER DEFAULT 0 NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        committed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_event_operations_status ON event_memory_operations(status, created_at);
      CREATE TABLE IF NOT EXISTS event_memory_relations (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        weight REAL DEFAULT 1 NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(source_id, target_id, relation)
      );
      CREATE INDEX IF NOT EXISTS idx_event_relations_agent ON event_memory_relations(agent_id, relation);
      CREATE TABLE IF NOT EXISTS event_memory_daily_note_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        date TEXT NOT NULL,
        status TEXT DEFAULT 'pending' NOT NULL,
        attempts INTEGER DEFAULT 0 NOT NULL,
        next_attempt_at TEXT,
        source_incomplete INTEGER DEFAULT false NOT NULL,
        written_files_json TEXT DEFAULT '[]' NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(agent_id, date)
      );
      CREATE INDEX IF NOT EXISTS idx_event_daily_note_due ON event_memory_daily_note_tasks(status, next_attempt_at);
      CREATE TABLE IF NOT EXISTS event_memory_reflection_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending' NOT NULL,
        attempts INTEGER DEFAULT 0 NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(agent_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_event_reflection_task_status ON event_memory_reflection_tasks(status, updated_at);
      CREATE TABLE IF NOT EXISTS event_memory_query_audits (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        query_json TEXT NOT NULL,
        result_count INTEGER NOT NULL,
        returned_tokens INTEGER NOT NULL,
        truncated INTEGER DEFAULT false NOT NULL,
        queried_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_event_query_audits_agent_time ON event_memory_query_audits(agent_id, queried_at);
      CREATE TABLE IF NOT EXISTS event_memory_timers (
        key TEXT PRIMARY KEY NOT NULL,
        elapsed_seconds INTEGER DEFAULT 0 NOT NULL,
        checkpoint_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fact_memory_operations (
        operation_id TEXT PRIMARY KEY NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT DEFAULT 'pending' NOT NULL,
        attempts INTEGER DEFAULT 0 NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        committed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fact_operations_status ON fact_memory_operations(status, created_at);
      CREATE TABLE IF NOT EXISTS fact_objects (
        id TEXT PRIMARY KEY NOT NULL,
        tdb_id INTEGER NOT NULL UNIQUE,
        standard_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        aliases_json TEXT DEFAULT '[]' NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fact_records (
        id TEXT PRIMARY KEY NOT NULL,
        tdb_id INTEGER NOT NULL UNIQUE,
        object_id TEXT NOT NULL,
        statement TEXT NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        source TEXT,
        confidence REAL,
        created_by_agent_id TEXT NOT NULL,
        superseded_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fact_records_object_status ON fact_records(object_id, status);
    `)
    const columns = sqlite.prepare('PRAGMA table_info(kernel_outbox_events)').all() as Array<{
      name: string
    }>
    if (!columns.some((column) => column.name === 'next_attempt_at')) {
      sqlite.exec('ALTER TABLE kernel_outbox_events ADD COLUMN next_attempt_at TEXT')
    }
    const modelColumns = sqlite.prepare('PRAGMA table_info(ai_model_configs)').all() as Array<{
      name: string
    }>
    const modelAdditions = [
      ['context_window_tokens', 'INTEGER'],
      ['return_native_reasoning', 'INTEGER DEFAULT false'],
      ['wire_api', "TEXT DEFAULT 'chat_completions'"],
      ['reasoning_dialect', "TEXT DEFAULT 'auto'"],
    ] as const
    for (const [name, definition] of modelAdditions) {
      if (!modelColumns.some((column) => column.name === name)) {
        sqlite.exec(`ALTER TABLE ai_model_configs ADD COLUMN ${name} ${definition}`)
      }
    }
  })()
}

/** 为既有数据库补齐工作上下文字段。 */
function ensureWorkContextSchema(sqlite: Database.Database): void {
  const columns = (table: string) =>
    new Set(
      sqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => (row as { name: string }).name),
    )
  const states = columns('flow_states')
  if (!states.has('work_context'))
    sqlite.exec("ALTER TABLE flow_states ADD COLUMN work_context TEXT DEFAULT '' NOT NULL")
  if (!states.has('work_context_updated_at_pair_count'))
    sqlite.exec(
      'ALTER TABLE flow_states ADD COLUMN work_context_updated_at_pair_count INTEGER DEFAULT 0 NOT NULL',
    )
  const revisions = columns('flow_state_revisions')
  if (!revisions.has('before_work_context'))
    sqlite.exec(
      "ALTER TABLE flow_state_revisions ADD COLUMN before_work_context TEXT DEFAULT '' NOT NULL",
    )
  if (!revisions.has('before_work_context_updated_at_pair_count'))
    sqlite.exec(
      'ALTER TABLE flow_state_revisions ADD COLUMN before_work_context_updated_at_pair_count INTEGER DEFAULT 0 NOT NULL',
    )
  if (!revisions.has('after_work_context'))
    sqlite.exec(
      "ALTER TABLE flow_state_revisions ADD COLUMN after_work_context TEXT DEFAULT '' NOT NULL",
    )
  if (!revisions.has('after_work_context_updated_at_pair_count'))
    sqlite.exec(
      'ALTER TABLE flow_state_revisions ADD COLUMN after_work_context_updated_at_pair_count INTEGER DEFAULT 0 NOT NULL',
    )
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS work_context_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      thread_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      pair_id TEXT NOT NULL,
      pair_count INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_work_context_entries_pair_agent
      ON work_context_entries (thread_id, agent_id, pair_id);
    CREATE INDEX IF NOT EXISTS idx_work_context_entries_scope
      ON work_context_entries (thread_id, agent_id, pair_count);
  `)
}

/** 为既有数据库补齐 Thread 自动执行模式字段。 */
function ensureThreadExecutionModeSchema(sqlite: Database.Database): void {
  const columns = new Set(
    sqlite
      .prepare('PRAGMA table_info(threads)')
      .all()
      .map((row) => (row as { name: string }).name),
  )
  if (!columns.has('auto_execute_tools')) {
    sqlite.exec('ALTER TABLE threads ADD COLUMN auto_execute_tools INTEGER DEFAULT false NOT NULL')
  }
}

/** 为既有数据库补齐Agent求助请求表。 */
function ensureAgentInputSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_input_requests (
      id TEXT PRIMARY KEY NOT NULL,
      agent_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      session_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      task_id TEXT,
      question TEXT NOT NULL,
      context TEXT,
      options_json TEXT DEFAULT '[]' NOT NULL,
      allow_free_text INTEGER DEFAULT true NOT NULL,
      required INTEGER DEFAULT false NOT NULL,
      status TEXT NOT NULL,
      selected_option_ids_json TEXT DEFAULT '[]' NOT NULL,
      response_message TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_input_status
      ON agent_input_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_input_thread
      ON agent_input_requests(thread_id, status);
    CREATE INDEX IF NOT EXISTS idx_agent_input_session
      ON agent_input_requests(session_id, status);
  `)
}

/** 为既有数据库补齐审批提醒等级字段。 */
function ensureApprovalRiskSchema(sqlite: Database.Database): void {
  const columns = new Set(
    sqlite
      .prepare('PRAGMA table_info(tool_approval_requests)')
      .all()
      .map((row) => (row as { name: string }).name),
  )
  if (!columns.has('risk_level')) {
    sqlite.exec(
      "ALTER TABLE tool_approval_requests ADD COLUMN risk_level TEXT DEFAULT 'low' NOT NULL",
    )
  }
}

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

  ensureKernelResourceSchema(sqlite)
  ensureWorkContextSchema(sqlite)
  ensureThreadExecutionModeSchema(sqlite)
  ensureAgentInputSchema(sqlite)
  ensureApprovalRiskSchema(sqlite)
  removeLegacyMemorySchema(sqlite)

  const db = drizzle(sqlite, { schema })
  sqliteConnections.set(db, sqlite)
  logger.success('数据库连接成功')
  return db
}

/** 完成 WAL Checkpoint并关闭对应 SQLite连接。 */
export function closeDrizzleConnection(db: DrizzleDb): void {
  const sqlite = sqliteConnections.get(db)
  if (!sqlite?.open) return
  sqlite.pragma('wal_checkpoint(TRUNCATE)')
  sqlite.close()
  sqliteConnections.delete(db)
  logger.info('数据库 WAL已收口，连接已关闭')
}
