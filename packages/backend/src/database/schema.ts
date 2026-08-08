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

/**
 * Thread 表 — 交互线程
 *
 * 替代旧版 Session 概念。每个 Thread 是主 Agent 与用户（或外部平台）的一次交互线程。
 * channel 是 Thread 的持久属性，创建时确定，不可变。
 * channel 决定该 Thread 的 ContextPolicy 和 MemoryPolicy。
 */
export const threads = sqliteTable(
  'threads',
  {
    id: text('id').primaryKey(),
    /** 归属的主 Agent */
    agentId: text('agent_id').notNull(),
    /** 对话场景：desktop / social / group / companion */
    channel: text('channel').notNull().default('desktop'),
    /** 外部平台标识（social/group 专用）：qq / discord / webhook */
    platform: text('platform'),
    /** 外部平台的会话标识（群号 / 用户QQ号等） */
    platformIdentifier: text('platform_identifier'),
    /** Thread 标题（自动生成或用户命名） */
    title: text('title').default(''),
    /** 消息数量（冗余计数，加速查询） */
    messageCount: integer('message_count').default(0),
    /** 聊天对数量（pairCount，用于 Dashboard 统计） */
    pairCount: integer('pair_count').default(0),
    /** 最后一条消息时间 */
    lastMessageAt: text('last_message_at'),
    /** Thread 状态 */
    status: text('status').default('active'),
    /**
     * ContextPolicy（JSON 序列化的 ChannelPolicy）
     * null 表示使用 DEFAULT_POLICIES 中该 channel 的默认策略
     * 非空时覆盖默认策略，允许 Thread 级别自定义上下文窗口/记忆检索等行为
     */
    contextPolicy: text('context_policy'),
    /** 创建时间 */
    createdAt: text('created_at').default(sql`(datetime('now', 'localtime'))`),
    /** 更新时间 */
    updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
  },
  (table) => [
    index('idx_threads_agent_id').on(table.agentId),
    index('idx_threads_channel').on(table.channel),
    index('idx_threads_platform').on(table.platform),
    index('idx_threads_status').on(table.status),
  ],
)

/**
 * Thread 消息表 — 不可变事件流
 *
 * 消息一旦写入，内容不可修改。编辑通过新增 revision 实现。
 * 删除通过软删除（status=deleted）实现，不物理删除。
 * pairId 把"用户提问 + Agent回复"绑成一个可操作单元。
 */
export const threadMessages = sqliteTable(
  'thread_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 所属 Thread */
    threadId: text('thread_id').notNull(),
    /** 消息角色 */
    role: text('role').notNull(), // user | assistant | system | tool
    /** 消息正文 */
    content: text('content').notNull(),
    /** 原始转写（含 Thinking 块，仅 assistant） */
    rawContent: text('raw_content'),
    /** 消息状态：active / deleted */
    status: text('status').default('active'),
    /** pairId：用户消息和对应回复共享同一 pairId */
    pairId: text('pair_id'),
    /** 发送者 ID（群聊场景：谁说的） */
    senderId: text('sender_id'),
    /** 消息 revision（编辑时递增，默认 1） */
    revision: integer('revision').default(1),
    /** 归属 Agent（群聊多 Agent 场景：谁回复的） */
    agentId: text('agent_id'),
    /** 元数据（model、tokenUsage、toolCalls 等） */
    metadataJson: text('metadata_json').default('{}'),
    /**
     * Scorer 处理状态（AIOS: 替代 conversation_logs.scorer_status）
     * - pending: 待 Scorer 提炼
     * - analyzed: 已提炼为记忆
     * - failed: 提炼失败
     * - skipped: 跳过（如纯工具调用消息）
     * 仅 assistant 消息会有此状态，user 消息通过 pairId 关联
     */
    scorerStatus: text('scorer_status').default('pending'),
    /** 消息时间 */
    timestamp: text('timestamp').default(sql`(datetime('now', 'localtime'))`),
    /** 删除时间（软删除标记） */
    deletedAt: text('deleted_at'),
    /** 删除者 */
    deletedBy: text('deleted_by'),
  },
  (table) => [
    index('idx_thread_messages_thread_id').on(table.threadId),
    index('idx_thread_messages_pair_id').on(table.pairId),
    index('idx_thread_messages_status').on(table.status),
    index('idx_thread_messages_agent_id').on(table.agentId),
    // AIOS: Scorer 查询待处理对话对的索引
    index('idx_thread_messages_scorer_status').on(table.scorerStatus),
  ],
)

/**
 * Thread 摘要表 — 滚动摘要
 *
 * @deprecated 已废弃（2026-08-05 决策）。超出上下文窗口的早期消息由长记忆系统兜底，
 * 不再生成滚动摘要。保留 schema 仅为兼容已有数据库迁移，运行时不再读写。
 * 决策详见 .aios/03-context-runtime.md 第 0 节。
 */
export const threadSummaries = sqliteTable(
  'thread_summaries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 所属 Thread */
    threadId: text('thread_id').notNull(),
    /** 摘要内容 */
    content: text('content').notNull(),
    /** 覆盖的消息 ID 列表（JSON 数组） */
    coversMessageIds: text('covers_message_ids').default('[]'),
    /** 摘要 revision（随着覆盖范围变化递增） */
    revision: integer('revision').default(1),
    /** 是否过期（覆盖的消息被删除/编辑后标记 stale） */
    isStale: integer('is_stale', { mode: 'boolean' }).default(false),
    /** 创建时间 */
    createdAt: text('created_at').default(sql`(datetime('now', 'localtime'))`),
  },
  (table) => [
    index('idx_thread_summaries_thread_id').on(table.threadId),
    index('idx_thread_summaries_stale').on(table.isStale),
  ],
)

/** 对话日志表（旧版兼容，保留数据迁移用） */
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
    dedupeKey: text('dedupe_key').unique(),
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

// ─────────────────────────────────────────────
// 长记忆系统（第五阶段）
// ─────────────────────────────────────────────

/**
 * CanonicalMemory 表 — 已确认的长期记忆
 *
 * 由 MemoryGate 审核通过后从 memory_candidates 转入。
 * 携带 provenance（来源追溯）信息，支持按 Thread 删除。
 * 与 memory_nodes 表共存（向后兼容），新写入走此表。
 */
export const canonicalMemories = sqliteTable(
  'canonical_memories',
  {
    /** 主键（UUID） */
    id: text('id').primaryKey(),
    /** 归属 Agent */
    agentId: text('agent_id').notNull(),
    /** 记忆类型：experience/preference/knowledge/relationship/event */
    type: text('type').notNull(),
    /** 记忆正文 */
    content: text('content').notNull(),
    /** 摘要（可选） */
    summary: text('summary'),
    /** 重要性 0-1 */
    importance: real('importance').default(0.5),
    /** 置信度 0-1 */
    confidence: real('confidence').default(0.5),
    /** 状态：active/archived/superseded */
    status: text('status').default('active'),
    /** 来源追溯（JSON 序列化的 MemoryProvenance） */
    provenance: text('provenance').notNull(),
    /** 被哪条新记忆取代（status=superseded 时有值） */
    supersededBy: text('superseded_by'),
    /** 取代的旧记忆 ID 列表（JSON 数组） */
    supersedes: text('supersedes'),
    /** 向量索引 ID（可选，与 TriviumDB 关联） */
    vectorId: text('vector_id'),
    /** 创建时间 */
    createdAt: text('created_at').notNull(),
    /** 更新时间 */
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_canonical_memories_agent_id').on(table.agentId),
    index('idx_canonical_memories_type').on(table.type),
    index('idx_canonical_memories_status').on(table.status),
    index('idx_canonical_memories_created_at').on(table.createdAt),
  ],
)

/**
 * MemoryCandidate 表 — 待确认的记忆候选
 *
 * 由 Scorer 提炼后写入，等待 MemoryGate 审核。
 * 审核通过转为 CanonicalMemory，否则标记 rejected/merged。
 */
export const memoryCandidates = sqliteTable(
  'memory_candidates',
  {
    /** 主键（UUID） */
    id: text('id').primaryKey(),
    /** 归属 Agent */
    agentId: text('agent_id').notNull(),
    /** 来源：thread/diary/scheduler/manual */
    source: text('source').notNull(),
    /** 来源 Thread ID */
    originThreadId: text('origin_thread_id'),
    /** 来源消息 ID 列表（JSON 数组） */
    originMessageIds: text('origin_message_ids'),
    /** 候选摘要 */
    summary: text('summary').notNull(),
    /** 证据引用（JSON 数组） */
    evidenceRefs: text('evidence_refs'),
    /** 重要性 0-1 */
    importance: real('importance').default(0.5),
    /** 置信度 0-1 */
    confidence: real('confidence').default(0.5),
    /** 建议类型 */
    suggestedType: text('suggested_type').notNull(),
    /** 状态：pending/accepted/rejected/merged */
    status: text('status').default('pending'),
    /** 创建时间 */
    createdAt: text('created_at').notNull(),
    /** 处理时间（审核完成后写入） */
    processedAt: text('processed_at'),
  },
  (table) => [
    index('idx_memory_candidates_agent_id').on(table.agentId),
    index('idx_memory_candidates_status').on(table.status),
    index('idx_memory_candidates_origin_thread').on(table.originThreadId),
  ],
)

// ─────────────────────────────────────────────
// 节点能力注册（第七阶段）
// ─────────────────────────────────────────────

/**
 * NodeCapabilityRegistration 表 — 节点能力注册表
 *
 * Daemon 维护的"谁能提供什么能力"注册表。
 * Electron/Mobile/CLI 等节点启动时向 Daemon 注册自己的能力，
 * Daemon 调用平台工具时查此表找到提供者节点并转发调用。
 *
 * 节点离线时 status 标记为 offline，能力变为 unavailable。
 *
 * 设计见 .aios/10-node-architecture.md §3
 */
export const nodeCapabilityRegistrations = sqliteTable(
  'node_capability_registrations',
  {
    /** 节点 ID（UUID，节点首次启动时生成并持久化） */
    nodeId: text('node_id').primaryKey(),
    /** 节点类型：electron / mobile / cli / remote-daemon */
    nodeType: text('node_type').notNull(),
    /** 远程节点的连接地址（本地节点为 null） */
    url: text('url'),
    /** 该节点能提供的能力列表（JSON 数组，如 ["screen_capture","desktop_notify"]） */
    capabilities: text('capabilities').notNull().default('[]'),
    /** 节点状态：online / offline */
    status: text('status').notNull().default('online'),
    /** 注册时间 */
    registeredAt: text('registered_at').default(sql`(datetime('now', 'localtime'))`),
    /** 最后心跳时间 */
    lastHeartbeat: text('last_heartbeat').default(sql`(datetime('now', 'localtime'))`),
  },
  (table) => [
    index('idx_node_capability_registrations_status').on(table.status),
    index('idx_node_capability_registrations_type').on(table.nodeType),
  ],
)

/**
 * InboundRoute 表 — 入站路由表
 *
 * 替代"全局活跃 Agent"对外部消息的决定作用。
 * 外部消息（QQ/Discord/Webhook）进来时查此表，找到归属 Agent 和 channel。
 *
 * 设计见 .aios/10-node-architecture.md §7
 */
export const inboundRoutes = sqliteTable(
  'inbound_routes',
  {
    /** 主键（UUID） */
    id: text('id').primaryKey(),
    /** 消息来源：qq_private / qq_group / discord / webhook / monitor */
    source: text('source').notNull(),
    /** 来源标识（QQ号、群号、webhook path 等） */
    identifier: text('identifier').notNull(),
    /** 归属 Agent ID */
    agentId: text('agent_id').notNull(),
    /** 创建什么类型的 Thread：desktop / social / group / companion */
    channel: text('channel').notNull().default('social'),
    /** 可选：固定到特定 Thread */
    threadId: text('thread_id'),
    /** 额外配置（JSON 对象） */
    config: text('config').default('{}'),
    /** 创建时间 */
    createdAt: text('created_at').default(sql`(datetime('now', 'localtime'))`),
    /** 更新时间 */
    updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
  },
  (table) => [
    index('idx_inbound_routes_source').on(table.source),
    index('idx_inbound_routes_agent').on(table.agentId),
    uniqueIndex('uq_inbound_routes_source_identifier').on(table.source, table.identifier),
  ],
)

// ─────────────────────────────────────────────
// Agent 应用层（AgentApplication + GrantRegistry）
// ─────────────────────────────────────────────

/**
 * 已安装应用注册表
 *
 * 记录所有已安装的 Agent 应用（官方自带 + 社区应用）。
 * 安装时扫描应用目录，读取 app.manifest.json，注册到此表。
 */
export const appRegistry = sqliteTable(
  'app_registry',
  {
    /** 应用 ID（主键，如 'coding' / 'research'） */
    appId: text('app_id').primaryKey(),
    /** 显示名称 */
    name: text('name').notNull(),
    /** 版本号 */
    version: text('version').notNull(),
    /** 应用文件目录（绝对路径） */
    installPath: text('install_path').notNull(),
    /** 完整 Manifest 的 JSON 序列化 */
    manifestJson: text('manifest_json').notNull(),
    /** 安装时间 */
    installedAt: text('installed_at').default(sql`(datetime('now', 'localtime'))`),
    /** 更新时间 */
    updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
  },
)

/**
 * 应用实例表
 *
 * 每次 launch 创建一条记录，记录实例状态与任务上下文。
 * 实例停止后保留记录（便于审计），可通过 listInstances 查询历史。
 */
export const appInstances = sqliteTable(
  'app_instances',
  {
    /** 实例 ID（UUID） */
    instanceId: text('instance_id').primaryKey(),
    /** 应用 ID */
    appId: text('app_id').notNull(),
    /** 启动此实例的主 Agent ID */
    hostAgentId: text('host_agent_id').notNull(),
    /** 当前状态：launching/running/paused/stopped/error */
    status: text('status').default('launching'),
    /** 工作区路径（dynamic 模式下用户指定） */
    workspacePath: text('workspace_path'),
    /** 任务上下文（JSON 序列化） */
    taskContextJson: text('task_context_json'),
    /** 启动方：user / host_agent */
    launchedBy: text('launched_by'),
    /** 启动时间 */
    launchedAt: text('launched_at').default(sql`(datetime('now', 'localtime'))`),
    /** 停止时间 */
    stoppedAt: text('stopped_at'),
    /** 错误信息（status='error' 时有值） */
    error: text('error'),
  },
  (table) => [
    index('idx_app_instances_host').on(table.hostAgentId, table.status),
    index('idx_app_instances_app').on(table.appId, table.status),
  ],
)

/**
 * 应用检查点表
 *
 * 每个实例最新检查点（一对一）。
 * 主 Agent 通过此表读取应用任务状态，不需要读取应用内部的所有消息。
 */
export const appCheckpoints = sqliteTable(
  'app_checkpoints',
  {
    /** 实例 ID（主键，与 app_instances 一对一） */
    instanceId: text('instance_id').primaryKey(),
    /** 任务状态：running/waiting/completed/failed */
    status: text('status').notNull(),
    /** 摘要（人类可读） */
    summary: text('summary').notNull(),
    /** 完成进度（0-1） */
    progress: real('progress').default(0),
    /** 检查点字段（JSON，按 Manifest.checkpointSchema） */
    fieldsJson: text('fields_json').notNull(),
    /** 修改的产出物列表（JSON 数组） */
    changedArtifactsJson: text('changed_artifacts_json'),
    /** 阻塞问题（JSON 数组） */
    blockersJson: text('blockers_json'),
    /** 下一步行动（JSON 数组） */
    nextActionsJson: text('next_actions_json'),
    /** 更新时间 */
    updatedAt: text('updated_at').default(sql`(datetime('now', 'localtime'))`),
  },
)

/**
 * 资源授权表
 *
 * GrantRegistry 的持久化层。
 * 记录主 Agent 对应用/会话的资源访问授权（owner, holder, resource, permission）。
 * 授权的是"资源引用"，不是"编译后的上下文"。
 */
export const appResourceGrants = sqliteTable(
  'app_resource_grants',
  {
    /** Grant ID（UUID） */
    id: text('id').primaryKey(),
    /** 授权方（主 Agent ID） */
    ownerAgentId: text('owner_agent_id').notNull(),
    /** 被授权方（应用实例 ID 或应用内会话 ID） */
    holderId: text('holder_id').notNull(),
    /** 被授权方类型：app / app_session */
    holderType: text('holder_type').notNull(),
    /** 资源类型：memory/messages/workspace/persona/task */
    resourceKind: text('resource_kind').notNull(),
    /** 资源引用的 JSON 序列化 */
    resourceJson: text('resource_json').notNull(),
    /** 权限列表（逗号分隔：read,activate,derive,write） */
    permissions: text('permissions').notNull(),
    /** 授权来源：host_agent / user / auto */
    grantedBy: text('granted_by').default('host_agent'),
    /** 备注 */
    note: text('note'),
    /** 创建时间 */
    createdAt: text('created_at').default(sql`(datetime('now', 'localtime'))`),
    /** 过期时间（NULL = 永不过期） */
    expiresAt: text('expires_at'),
    /** 是否已撤销（0=有效, 1=已撤销） */
    revoked: integer('revoked').default(0),
    /** 撤销时间 */
    revokedAt: text('revoked_at'),
  },
  (table) => [
    index('idx_grants_holder').on(table.holderId, table.revoked),
    index('idx_grants_owner').on(table.ownerAgentId),
  ],
)
