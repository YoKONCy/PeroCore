/**
 * Drizzle ORM Schema 定义
 *
 * 数据库 Schema 定义，表名遵循 snake_case 复数。
 * 列名 snake_case。
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

    // 向量 (JSON 字符串)
    embeddingJson: text('embedding_json').default('[]'),

    // PEDSA 检索反馈
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

// 无需 DB 表。

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

// 无需独立表。

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
// 据点系统
// ─────────────────────────────────────────────

/** 据点设施表 */
export const strongholdFacilities = sqliteTable('stronghold_facilities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon'),
  createdAt: text('created_at').default(sql`(datetime('now', 'localtime'))`),
})

/** 据点房间表 (关联设施 + 群聊房间) */
export const strongholdRooms = sqliteTable(
  'stronghold_rooms',
  {
    /** 与 groupChatRooms.id 相同，实现 1:1 关联 */
    id: text('id').primaryKey(),
    facilityId: integer('facility_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** 允许进入的 Agent 列表 (JSON 数组, 空=全部允许) */
    allowedAgentsJson: text('allowed_agents_json').default('[]'),
    /** 环境变量 (JSON 对象: 光照/温度/音乐等) */
    environmentJson: text('environment_json').default('{}'),
    createdAt: text('created_at').default(sql`(datetime('now', 'localtime'))`),
  },
  (table) => [index('idx_stronghold_rooms_facility_id').on(table.facilityId)],
)

/** Agent 位置表 (当前在哪个房间) */
export const agentLocations = sqliteTable('agent_locations', {
  agentId: text('agent_id').primaryKey(),
  roomId: text('room_id').notNull(),
  updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
})

/** 管家配置表 */
export const butlerConfigs = sqliteTable('butler_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().default('Butler'),
  persona: text('persona'),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
})

// ─────────────────────────────────────────────
// 社交消息
// ─────────────────────────────────────────────

/**
 * 社交消息表
 *
 * 存储来自外部平台 (QQ/Discord/...) 的原始消息，
 * 与 conversationLogs (Agent 对话对) 互补:
 * - socialMessages: 记录平台上 **所有人** 说的话 (含非 Agent 回复)
 * - conversationLogs: 只记录 Agent 参与的对话对 (source='social')
 */
export const socialMessages = sqliteTable(
  'social_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 平台消息 ID */
    msgId: text('msg_id').notNull(),
    /** 平台名称 (qq / discord / ...) */
    platform: text('platform').notNull().default('qq'),
    /** 会话 ID (群号 / 用户 QQ 号) */
    channelId: text('channel_id').notNull(),
    /** 会话类型 */
    channelType: text('channel_type').notNull(),
    /** 发送者 ID */
    senderId: text('sender_id').notNull(),
    /** 发送者显示名 */
    senderName: text('sender_name').default(''),
    /** 消息正文 (已清洗) */
    content: text('content').notNull(),
    /** 关联的 Agent ID */
    agentId: text('agent_id').notNull().default('pero'),
    /** 原始平台事件 JSON (调试用) */
    rawEventJson: text('raw_event_json').default('{}'),
    /** 消息时间 */
    timestamp: text('timestamp').default(sql`(datetime('now', 'localtime'))`),
    /** 是否已被社交 Scorer 总结 (v1: QQMessage.is_summarized) */
    isSummarized: integer('is_summarized', { mode: 'boolean' }).default(false),
  },
  (table) => [
    index('idx_social_messages_channel').on(table.channelId, table.channelType),
    index('idx_social_messages_agent').on(table.agentId),
    index('idx_social_messages_timestamp').on(table.timestamp),
    index('idx_social_messages_unsummarized').on(table.isSummarized, table.agentId),
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
