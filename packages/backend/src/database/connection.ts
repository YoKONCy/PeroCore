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
      // 便携/打包环境通过 PERO_APP_ROOT 显式定位内置资源目录
      // （单文件 bundle 后 import.meta.url 不再指向 backend 源码树）；
      // 开发/独立部署环境回退到 import.meta 推导。
      const appRoot = process.env.PERO_APP_ROOT
      const migrationsDir = appRoot
        ? resolve(appRoot, 'backend', 'src', 'database', 'migrations')
        : resolve(dirname(fileURLToPath(import.meta.url)), 'migrations')
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
  // ── 对话轮次文件变更快照（AI IDE checkpoint rewind）──
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS file_change_snapshots (
        id TEXT PRIMARY KEY NOT NULL,
        thread_id TEXT NOT NULL,
        pair_id TEXT NOT NULL,
        call_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        operation TEXT DEFAULT 'modify' NOT NULL,
        rename_target_path TEXT,
        original_content TEXT,
        original_sha256 TEXT,
        final_sha256 TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL,
        updated_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_file_change_snapshots_pair_file ON file_change_snapshots(pair_id, file_path);
      CREATE INDEX IF NOT EXISTS idx_file_change_snapshots_thread_id ON file_change_snapshots(thread_id);
      CREATE INDEX IF NOT EXISTS idx_file_change_snapshots_pair_id ON file_change_snapshots(pair_id);
      CREATE INDEX IF NOT EXISTS idx_file_change_snapshots_call_id ON file_change_snapshots(call_id);
    `)
  } catch (err) {
    logger.warn(`Schema 修补失败 (file_change_snapshots): ${err}`)
  }

  // ── 工具审批与审计持久化 ──
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS tool_approval_requests (
        id TEXT PRIMARY KEY NOT NULL, agent_id TEXT NOT NULL, channel TEXT NOT NULL,
        session_id TEXT NOT NULL, thread_id TEXT NOT NULL, task_id TEXT, tool_name TEXT NOT NULL,
        args_summary_json TEXT NOT NULL, args_fingerprint TEXT NOT NULL, reason TEXT NOT NULL,
        status TEXT NOT NULL, decision TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tool_approval_status ON tool_approval_requests(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_tool_approval_session ON tool_approval_requests(session_id, tool_name);
      CREATE INDEX IF NOT EXISTS idx_tool_approval_agent ON tool_approval_requests(agent_id, tool_name);
      CREATE TABLE IF NOT EXISTS tool_approval_audit_logs (
        id TEXT PRIMARY KEY NOT NULL, approval_id TEXT, event TEXT NOT NULL,
        agent_id TEXT NOT NULL, session_id TEXT NOT NULL, tool_name TEXT NOT NULL,
        detail_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tool_approval_audit_approval ON tool_approval_audit_logs(approval_id);
      CREATE INDEX IF NOT EXISTS idx_tool_approval_audit_session ON tool_approval_audit_logs(session_id, created_at);
    `)
    // 附言列（旧库幂等补齐）
    const columns = sqlite.prepare('PRAGMA table_info(tool_approval_requests)').all() as Array<{
      name: string
    }>
    if (!columns.some((column) => column.name === 'resolution_message')) {
      sqlite.exec('ALTER TABLE tool_approval_requests ADD COLUMN resolution_message TEXT')
    }
  } catch (err) {
    logger.warn(`Schema 修补失败 (tool approvals): ${err}`)
  }

  // ── 据点群聊消息关联键：支持用户发言与本轮 Agent 回复级联删除 ──
  try {
    const columns = sqlite.prepare('PRAGMA table_info(group_chat_messages)').all() as Array<{
      name: string
    }>
    if (!columns.some((column) => column.name === 'pair_id')) {
      logger.info('修补: 为 group_chat_messages 添加 pair_id 列与索引')
      sqlite.exec(`
        ALTER TABLE group_chat_messages ADD COLUMN pair_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_group_chat_messages_pair_id ON group_chat_messages(pair_id);
      `)
      logger.success('修补完成: group_chat_messages.pair_id 已添加')
    }
  } catch (err) {
    logger.warn(`Schema 修补失败 (group_chat_messages.pair_id): ${err}`)
  }

  // ── 模型原生音频输入能力字段 ──
  try {
    const columns = sqlite.prepare('PRAGMA table_info(ai_model_configs)').all() as Array<{
      name: string
    }>
    if (!columns.some((column) => column.name === 'enable_audio_input')) {
      logger.info('修补: 为 ai_model_configs 添加 enable_audio_input 列')
      sqlite.exec('ALTER TABLE ai_model_configs ADD COLUMN enable_audio_input INTEGER DEFAULT 0;')
      logger.success('修补完成: ai_model_configs.enable_audio_input 已添加')
    }
  } catch (err) {
    logger.warn(`Schema 修补失败 (ai_model_configs.enable_audio_input): ${err}`)
  }

  // ── 模型推理强度字段 ──
  try {
    const columns = sqlite.prepare('PRAGMA table_info(ai_model_configs)').all() as Array<{
      name: string
    }>
    if (!columns.some((column) => column.name === 'reasoning_effort')) {
      logger.info('修补: 为 ai_model_configs 添加 reasoning_effort 列')
      sqlite.exec('ALTER TABLE ai_model_configs ADD COLUMN reasoning_effort TEXT;')
      logger.success('修补完成: ai_model_configs.reasoning_effort 已添加')
    }
  } catch (err) {
    logger.warn(`Schema 修补失败 (ai_model_configs.reasoning_effort): ${err}`)
  }

  // ── 附件表修补：旧数据库不会自动执行新增迁移 ──
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS message_attachments (
        id TEXT PRIMARY KEY NOT NULL, thread_id TEXT NOT NULL, message_id INTEGER,
        kind TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, storage_key TEXT NOT NULL,
        context_policy TEXT DEFAULT 'once' NOT NULL, status TEXT DEFAULT 'uploaded' NOT NULL,
        extracted_text TEXT, token_estimate INTEGER, metadata_json TEXT DEFAULT '{}' NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')), bound_at TEXT, deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments(message_id);
      CREATE INDEX IF NOT EXISTS idx_message_attachments_thread_id ON message_attachments(thread_id);
      CREATE INDEX IF NOT EXISTS idx_message_attachments_status ON message_attachments(status);
    `)
  } catch (err) {
    logger.warn(`Schema 修补失败 (message_attachments): ${err}`)
  }

  // ── 社交历史同步：去重账号列、断点游标与删除水位线 ──
  try {
    const socialColumns = sqlite.prepare('PRAGMA table_info(social_messages)').all() as Array<{
      name: string
    }>
    if (!socialColumns.some((column) => column.name === 'account_id')) {
      sqlite.exec("ALTER TABLE social_messages ADD COLUMN account_id TEXT DEFAULT '' NOT NULL")
    }
    sqlite.exec(`
      DELETE FROM social_messages
      WHERE id NOT IN (
        SELECT MIN(id) FROM social_messages
        GROUP BY agent_id, platform, account_id, msg_id
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_social_messages_platform_message
        ON social_messages(agent_id, platform, account_id, msg_id);
      CREATE TABLE IF NOT EXISTS social_history_tombstones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        account_id TEXT DEFAULT '' NOT NULL,
        channel_type TEXT DEFAULT '*' NOT NULL,
        channel_id TEXT DEFAULT '*' NOT NULL,
        deleted_before INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_social_history_tombstone_scope
        ON social_history_tombstones(agent_id, platform, account_id, channel_type, channel_id);
      CREATE TABLE IF NOT EXISTS social_sync_cursors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        account_id TEXT NOT NULL,
        last_successful_sync_at INTEGER DEFAULT 0 NOT NULL,
        sync_started_at INTEGER,
        status TEXT DEFAULT 'idle' NOT NULL,
        last_error TEXT,
        updated_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_social_sync_cursor_scope
        ON social_sync_cursors(agent_id, platform, account_id);
    `)
  } catch (err) {
    logger.warn(`Schema 修补失败 (social history sync): ${err}`)
  }

  // ── M05 Fixup: threads.purpose 列（统一任务中心 Thread 用途区分） ──
  try {
    const columns = sqlite.prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>
    if (!columns.some((c) => c.name === 'purpose')) {
      logger.info('修补: 为 threads 添加 purpose 列')
      sqlite.exec(`
        ALTER TABLE threads ADD COLUMN purpose TEXT DEFAULT 'conversation';
        CREATE INDEX IF NOT EXISTS idx_threads_purpose ON threads(purpose);
      `)
      logger.success('修补完成: threads.purpose 已添加')
    }
  } catch (err) {
    logger.warn(`Schema 修补失败 (threads.purpose): ${err}`)
  }

  // ── 心流 Fixup：Thread × Agent 私有临时记忆与修订历史 ──
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS flow_states (
        thread_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        current_goal TEXT DEFAULT '' NOT NULL,
        private_facts TEXT DEFAULT '' NOT NULL,
        revision INTEGER DEFAULT 1 NOT NULL,
        updated_by_pair_id TEXT,
        updated_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_states_thread_agent ON flow_states(thread_id, agent_id);
      CREATE INDEX IF NOT EXISTS idx_flow_states_thread_id ON flow_states(thread_id);
      CREATE TABLE IF NOT EXISTS flow_state_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        pair_id TEXT,
        before_current_goal TEXT DEFAULT '' NOT NULL,
        before_private_facts TEXT DEFAULT '' NOT NULL,
        after_current_goal TEXT DEFAULT '' NOT NULL,
        after_private_facts TEXT DEFAULT '' NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_flow_revisions_thread_id ON flow_state_revisions(thread_id);
      CREATE INDEX IF NOT EXISTS idx_flow_revisions_pair_id ON flow_state_revisions(pair_id);
    `)
  } catch (err) {
    logger.warn(`Schema 修补失败 (flow_states): ${err}`)
  }

  // ── 社交联系人印象：按 Agent × 平台 × 用户隔离 ──
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS social_contact_impressions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        platform TEXT DEFAULT 'qq' NOT NULL,
        user_id TEXT NOT NULL,
        display_name TEXT DEFAULT '' NOT NULL,
        identity TEXT DEFAULT '' NOT NULL,
        impression TEXT NOT NULL,
        source_channel_id TEXT,
        updated_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_social_contact_impressions_scope
        ON social_contact_impressions(agent_id, platform, user_id);
      CREATE INDEX IF NOT EXISTS idx_social_contact_impressions_user
        ON social_contact_impressions(user_id);
    `)
  } catch (err) {
    logger.warn(`Schema 修补失败 (social_contact_impressions): ${err}`)
  }

  // ── M05 Fixup: background_tasks 表（统一任务中心持久实体） ──
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS background_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        title TEXT NOT NULL,
        instruction TEXT NOT NULL,
        status TEXT DEFAULT 'queued' NOT NULL,
        progress INTEGER,
        current_stage TEXT,
        workspace TEXT,
        result TEXT,
        error_message TEXT,
        tool_call_count INTEGER DEFAULT 0 NOT NULL,
        priority INTEGER DEFAULT 5 NOT NULL,
        parent_task_id TEXT,
        requested_by TEXT DEFAULT 'user' NOT NULL,
        completion_action TEXT DEFAULT 'notify' NOT NULL,
        checkpoint_json TEXT,
        metadata_json TEXT DEFAULT '{}' NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL,
        read_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_background_tasks_agent_id ON background_tasks(agent_id);
      CREATE INDEX IF NOT EXISTS idx_background_tasks_status ON background_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_background_tasks_thread_id ON background_tasks(thread_id);
      CREATE INDEX IF NOT EXISTS idx_background_tasks_created_at ON background_tasks(created_at);
    `)
    const columns = sqlite.prepare('PRAGMA table_info(background_tasks)').all() as Array<{
      name: string
    }>
    const columnNames = new Set(columns.map((column) => column.name))
    if (!columnNames.has('target_thread_id')) {
      logger.info('修补: 为 background_tasks 添加 target_thread_id 列')
      sqlite.exec('ALTER TABLE background_tasks ADD COLUMN target_thread_id TEXT;')
    }
    // 0013 迁移只会在全新数据库初始化时执行；旧数据库需在启动阶段幂等补齐任务中心字段。
    if (!columnNames.has('category')) {
      logger.info('修补: 为 background_tasks 添加 category 列')
      sqlite.exec(
        "ALTER TABLE background_tasks ADD COLUMN category TEXT DEFAULT 'agent_task' NOT NULL;",
      )
    }
    if (!columnNames.has('input_question')) {
      logger.info('修补: 为 background_tasks 添加 input_question 列')
      sqlite.exec('ALTER TABLE background_tasks ADD COLUMN input_question TEXT;')
    }
    if (!columnNames.has('input_context_json')) {
      logger.info('修补: 为 background_tasks 添加 input_context_json 列')
      sqlite.exec('ALTER TABLE background_tasks ADD COLUMN input_context_json TEXT;')
    }
    if (!columnNames.has('read_at')) {
      logger.info('修补: 为 background_tasks 添加 read_at 列')
      sqlite.exec('ALTER TABLE background_tasks ADD COLUMN read_at TEXT;')
    }
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_background_tasks_target_thread_id ON background_tasks(target_thread_id);
      CREATE INDEX IF NOT EXISTS idx_background_tasks_category ON background_tasks(category);
    `)
  } catch (err) {
    logger.warn(`Schema 修补失败 (background_tasks): ${err}`)
  }

  // ── AIOS Fixup: thread_messages.scorer_status 列 ──
  // 替代 conversation_logs.scorer_status，Scorer 直接从 thread_messages 读取待处理对话
  try {
    const columns = sqlite.prepare('PRAGMA table_info(thread_messages)').all() as Array<{
      name: string
    }>
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
    const threadColumns = sqlite.prepare('PRAGMA table_info(threads)').all() as Array<{
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

  // ── Thread 级工具启停持久化 ──
  try {
    const threadColumns = sqlite.prepare('PRAGMA table_info(threads)').all() as Array<{
      name: string
    }>
    if (!threadColumns.some((column) => column.name === 'disabled_tools_json')) {
      logger.info('修补: 为 threads 添加 disabled_tools_json 列')
      sqlite.exec(`ALTER TABLE threads ADD COLUMN disabled_tools_json TEXT DEFAULT '[]' NOT NULL;`)
      logger.success('修补完成: threads.disabled_tools_json 已添加')
    }
  } catch (err) {
    logger.warn(`Schema 修补失败 (threads.disabled_tools_json): ${err}`)
  }

  // ── finish_task 临时台词生命周期 ──
  try {
    const petStateColumns = sqlite.prepare('PRAGMA table_info(pet_states)').all() as Array<{
      name: string
    }>
    if (!petStateColumns.some((column) => column.name === 'text_expires_at')) {
      logger.info('修补: 为 pet_states 添加 text_expires_at 列')
      sqlite.exec(`ALTER TABLE pet_states ADD COLUMN text_expires_at TEXT;`)
      logger.success('修补完成: pet_states.text_expires_at 已添加')
    }
  } catch (err) {
    logger.warn(`Schema 修补失败 (pet_states.text_expires_at): ${err}`)
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
      logger.info(
        '修补: 创建应用层表结构（app_registry / app_instances / app_checkpoints / app_resource_grants）',
      )
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
