/**
 * Drizzle ORM Schema 定义
 *
 * 从 PeroCore v1 models.py 迁移，表名遵循 snake_case 复数 (01_NAMING_CONVENTIONS.md §4)。
 * 列名 snake_case (01_NAMING_CONVENTIONS.md §4)。
 *
 * @module packages/backend/src/database/schema
 */

import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ─────────────────────────────────────────────
// 记忆系统
// ─────────────────────────────────────────────

/** 记忆节点表 */
export const memoryNodes = sqliteTable(
  'memory_nodes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    content: text('content').notNull(),
    tags: text('tags').default(''),
    clusters: text('clusters'),

    // 权重与情感
    importance: integer('importance').default(1),
    baseImportance: real('base_importance').default(1.0),
    accessCount: integer('access_count').default(0),
    lastAccessed: text('last_accessed').default(sql`(datetime('now', 'localtime'))`),
    sentiment: text('sentiment').default('neutral'),

    // 时间主轴 (链表)
    timestamp: real('timestamp')
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    realTime: text('real_time').default(''),
    prevId: integer('prev_id'),
    nextId: integer('next_id'),

    // 元数据
    msgTimestamp: text('msg_timestamp'),
    source: text('source').default('desktop'),
    type: text('type').default('event'),
    agentId: text('agent_id').notNull().default('pero'),

    // 向量 (JSON 字符串, 兼容 v1 迁移)
    embeddingJson: text('embedding_json').default('[]'),

    // PEDSA v2 检索反馈 (§14.4)
    retrievalQuality: real('retrieval_quality').default(0.0),
  },
  (table) => [
    index('idx_memory_nodes_agent_id').on(table.agentId),
    index('idx_memory_nodes_timestamp').on(table.timestamp),
    index('idx_memory_nodes_type').on(table.type),
  ],
)

/** 实体共现统计表 */
export const entityCooccurrences = sqliteTable(
  'entity_cooccurrences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entityAId: integer('entity_a_id').notNull(),
    entityBId: integer('entity_b_id').notNull(),
    coCount: integer('co_count').default(1),
    agentId: text('agent_id').notNull().default('pero'),
  },
  (table) => [
    index('idx_entity_cooccurrences_agent_id').on(table.agentId),
    uniqueIndex('uq_cooccurrence_pair').on(table.entityAId, table.entityBId, table.agentId),
  ],
)

// ─────────────────────────────────────────────
// 对话系统
// ─────────────────────────────────────────────

/** 对话日志表 */
export const conversationLogs = sqliteTable(
  'conversation_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id').notNull(),
    source: text('source').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    rawContent: text('raw_content'),
    timestamp: text('timestamp').default(sql`(datetime('now', 'localtime'))`),
    metadataJson: text('metadata_json').default('{}'),
    pairId: text('pair_id'),

    // Scorer 元数据
    sentiment: text('sentiment'),
    importance: integer('importance'),
    memoryId: integer('memory_id'),

    // Scorer 状态
    analysisStatus: text('analysis_status').default('pending'),
    retryCount: integer('retry_count').default(0),
    lastError: text('last_error'),

    agentId: text('agent_id').notNull().default('pero'),
  },
  (table) => [
    index('idx_conversation_logs_session_id').on(table.sessionId),
    index('idx_conversation_logs_source').on(table.source),
    index('idx_conversation_logs_pair_id').on(table.pairId),
    index('idx_conversation_logs_agent_id').on(table.agentId),
  ],
)

// ─────────────────────────────────────────────
// Agent / 宠物状态
// ─────────────────────────────────────────────

/** Agent 角色配置表 */
export const agentProfiles = sqliteTable(
  'agent_profiles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    role: text('role').notNull().default('assistant'),
    name: text('name').notNull(),
    avatar: text('avatar'),
    description: text('description'),
    systemPrompt: text('system_prompt'),
    voiceConfigId: integer('voice_config_id'),
    isActive: integer('is_active', { mode: 'boolean' }).default(false),
    createdAt: text('created_at').default(sql`(datetime('now', 'localtime'))`),
    updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
  },
  (table) => [
    uniqueIndex('uq_agent_profiles_name').on(table.name),
    index('idx_agent_profiles_role').on(table.role),
  ],
)

/** 宠物状态表 */
export const petStates = sqliteTable(
  'pet_states',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    agentId: text('agent_id').notNull().default('pero'),
    mood: text('mood').default('开心'),
    vibe: text('vibe').default('活泼'),
    mind: text('mind').default('正在想主人...'),
    clickMessagesJson: text('click_messages_json').default('{}'),
    idleMessagesJson: text('idle_messages_json').default('[]'),
    backMessagesJson: text('back_messages_json').default('[]'),
    updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
  },
  (table) => [index('idx_pet_states_agent_id').on(table.agentId)],
)

// ─────────────────────────────────────────────
// 模型与语音配置
// ─────────────────────────────────────────────

/** AI 模型卡配置表 */
export const aiModelConfigs = sqliteTable(
  'ai_model_configs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    modelId: text('model_id').notNull(),
    provider: text('provider').default('openai'),
    providerType: text('provider_type').default('global'),
    apiKey: text('api_key'),
    apiBase: text('api_base'),
    temperature: real('temperature').default(0.7),
    topP: real('top_p'),
    maxTokens: integer('max_tokens'),
    stream: integer('stream', { mode: 'boolean' }).default(true),
    enableVision: integer('enable_vision', { mode: 'boolean' }).default(false),
    enableVoice: integer('enable_voice', { mode: 'boolean' }).default(false),
    enableVideo: integer('enable_video', { mode: 'boolean' }).default(false),
    createdAt: text('created_at').default(sql`(datetime('now', 'localtime'))`),
    updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
  },
  (table) => [uniqueIndex('uq_ai_model_configs_name').on(table.name)],
)

/** 语音配置表 */
export const voiceConfigs = sqliteTable(
  'voice_configs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    name: text('name').notNull(),
    provider: text('provider').notNull(),
    apiKey: text('api_key'),
    apiBase: text('api_base'),
    model: text('model'),
    configJson: text('config_json').default('{}'),
    isActive: integer('is_active', { mode: 'boolean' }).default(false),
    createdAt: text('created_at').default(sql`(datetime('now', 'localtime'))`),
    updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
  },
  (table) => [uniqueIndex('uq_voice_configs_name').on(table.name)],
)

// ─────────────────────────────────────────────
// 群聊 / 据点
// ─────────────────────────────────────────────

/** 群聊房间表 */
export const groupChatRooms = sqliteTable('group_chat_rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: text('created_at').default(sql`(datetime('now', 'localtime'))`),
  creatorId: text('creator_id').notNull(),
})

/** 群聊成员表 */
export const groupChatMembers = sqliteTable(
  'group_chat_members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roomId: text('room_id').notNull(),
    agentId: text('agent_id').notNull(),
    joinedAt: text('joined_at').default(sql`(datetime('now', 'localtime'))`),
    role: text('role').default('member'),
  },
  (table) => [
    index('idx_group_chat_members_room_id').on(table.roomId),
    index('idx_group_chat_members_agent_id').on(table.agentId),
  ],
)

/** 群聊消息表 */
export const groupChatMessages = sqliteTable(
  'group_chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roomId: text('room_id').notNull(),
    senderId: text('sender_id').notNull(),
    content: text('content').notNull(),
    role: text('role').notNull(),
    timestamp: text('timestamp').default(sql`(datetime('now', 'localtime'))`),
    mentionsJson: text('mentions_json').default('[]'),
    updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
  },
  (table) => [
    index('idx_group_chat_messages_room_id').on(table.roomId),
    index('idx_group_chat_messages_sender_id').on(table.senderId),
  ],
)

// ─────────────────────────────────────────────
// 任务调度 / 配置 / 运维
// ─────────────────────────────────────────────

/** 定时任务表 */
export const scheduledTasks = sqliteTable(
  'scheduled_tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    time: text('time').notNull(),
    content: text('content').notNull(),
    isTriggered: integer('is_triggered', { mode: 'boolean' }).default(false),
    createdAt: text('created_at').default(sql`(datetime('now', 'localtime'))`),
    agentId: text('agent_id').notNull().default('pero'),
  },
  (table) => [index('idx_scheduled_tasks_agent_id').on(table.agentId)],
)

/** 全局键值配置表 */
export const configs = sqliteTable('configs', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
})

/** 维护记录表 */
export const maintenanceRecords = sqliteTable('maintenance_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').default(sql`(datetime('now', 'localtime'))`),
  preferencesExtracted: integer('preferences_extracted').default(0),
  importantTagged: integer('important_tagged').default(0),
  consolidated: integer('consolidated').default(0),
  cleanedCount: integer('cleaned_count').default(0),
  clusteredCount: integer('clustered_count').default(0),
  createdIds: text('created_ids').default('[]'),
  deletedData: text('deleted_data').default('[]'),
  modifiedData: text('modified_data').default('[]'),
})

/** TriviumDB 补偿同步任务表 */
export const triviumSyncTasks = sqliteTable(
  'trivium_sync_tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    operation: text('operation').notNull(),
    memoryId: integer('memory_id'),
    storeName: text('store_name').default('memory'),
    dedupeKey: text('dedupe_key'),
    payloadJson: text('payload_json').default('{}'),
    status: text('status').default('pending'),
    retryCount: integer('retry_count').default(0),
    lastError: text('last_error'),
    agentId: text('agent_id').notNull().default('pero'),
    createdAt: text('created_at').default(sql`(datetime('now', 'localtime'))`),
    updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
  },
  (table) => [
    index('idx_trivium_sync_tasks_operation').on(table.operation),
    index('idx_trivium_sync_tasks_status').on(table.status),
    index('idx_trivium_sync_tasks_memory_id').on(table.memoryId),
    index('idx_trivium_sync_tasks_dedupe_key').on(table.dedupeKey),
    index('idx_trivium_sync_tasks_agent_id').on(table.agentId),
  ],
)

/** MCP 服务器配置表 */
export const mcpConfigs = sqliteTable(
  'mcp_configs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    type: text('type').default('stdio'),
    command: text('command'),
    args: text('args').default('[]'),
    env: text('env').default('{}'),
    url: text('url'),
    enabled: integer('enabled', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').default(sql`(datetime('now', 'localtime'))`),
    updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
  },
  (table) => [uniqueIndex('uq_mcp_configs_name').on(table.name)],
)
