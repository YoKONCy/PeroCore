CREATE TABLE `agent_locations` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE TABLE `agent_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` text DEFAULT 'assistant' NOT NULL,
	`name` text NOT NULL,
	`avatar` text,
	`description` text,
	`system_prompt` text,
	`voice_config_id` integer,
	`is_active` integer DEFAULT false,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_agent_profiles_name` ON `agent_profiles` (`name`);--> statement-breakpoint
CREATE INDEX `idx_agent_profiles_role` ON `agent_profiles` (`role`);--> statement-breakpoint
CREATE TABLE `ai_model_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`model_id` text NOT NULL,
	`provider` text DEFAULT 'openai',
	`provider_type` text DEFAULT 'global',
	`api_key` text,
	`api_base` text,
	`temperature` real DEFAULT 0.7,
	`top_p` real,
	`max_tokens` integer,
	`stream` integer DEFAULT true,
	`enable_vision` integer DEFAULT false,
	`enable_voice` integer DEFAULT false,
	`enable_video` integer DEFAULT false,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ai_model_configs_name` ON `ai_model_configs` (`name`);--> statement-breakpoint
CREATE TABLE `butler_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text DEFAULT 'Butler' NOT NULL,
	`persona` text,
	`enabled` integer DEFAULT true,
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE TABLE `configs` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE TABLE `conversation_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`source` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`raw_content` text,
	`timestamp` text DEFAULT (datetime('now', 'localtime')),
	`metadata_json` text DEFAULT '{}',
	`pair_id` text,
	`sentiment` text,
	`importance` integer,
	`memory_id` integer,
	`analysis_status` text DEFAULT 'pending',
	`retry_count` integer DEFAULT 0,
	`last_error` text,
	`agent_id` text DEFAULT 'pero' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_conversation_logs_session_id` ON `conversation_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_conversation_logs_source` ON `conversation_logs` (`source`);--> statement-breakpoint
CREATE INDEX `idx_conversation_logs_pair_id` ON `conversation_logs` (`pair_id`);--> statement-breakpoint
CREATE INDEX `idx_conversation_logs_agent_id` ON `conversation_logs` (`agent_id`);--> statement-breakpoint
CREATE TABLE `entity_cooccurrences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_a_id` integer NOT NULL,
	`entity_b_id` integer NOT NULL,
	`co_count` integer DEFAULT 1,
	`agent_id` text DEFAULT 'pero' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_entity_cooccurrences_agent_id` ON `entity_cooccurrences` (`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_cooccurrence_pair` ON `entity_cooccurrences` (`entity_a_id`,`entity_b_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `group_chat_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`joined_at` text DEFAULT (datetime('now', 'localtime')),
	`role` text DEFAULT 'member'
);
--> statement-breakpoint
CREATE INDEX `idx_group_chat_members_room_id` ON `group_chat_members` (`room_id`);--> statement-breakpoint
CREATE INDEX `idx_group_chat_members_agent_id` ON `group_chat_members` (`agent_id`);--> statement-breakpoint
CREATE TABLE `group_chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`content` text NOT NULL,
	`role` text NOT NULL,
	`timestamp` text DEFAULT (datetime('now', 'localtime')),
	`mentions_json` text DEFAULT '[]',
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_group_chat_messages_room_id` ON `group_chat_messages` (`room_id`);--> statement-breakpoint
CREATE INDEX `idx_group_chat_messages_sender_id` ON `group_chat_messages` (`sender_id`);--> statement-breakpoint
CREATE TABLE `group_chat_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`creator_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` text DEFAULT (datetime('now', 'localtime')),
	`preferences_extracted` integer DEFAULT 0,
	`important_tagged` integer DEFAULT 0,
	`consolidated` integer DEFAULT 0,
	`cleaned_count` integer DEFAULT 0,
	`clustered_count` integer DEFAULT 0,
	`created_ids` text DEFAULT '[]',
	`deleted_data` text DEFAULT '[]',
	`modified_data` text DEFAULT '[]'
);
--> statement-breakpoint
CREATE TABLE `mcp_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'stdio',
	`command` text,
	`args` text DEFAULT '[]',
	`env` text DEFAULT '{}',
	`url` text,
	`enabled` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mcp_configs_name` ON `mcp_configs` (`name`);--> statement-breakpoint
CREATE TABLE `memory_nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content` text NOT NULL,
	`tags` text DEFAULT '',
	`clusters` text,
	`importance` integer DEFAULT 1,
	`base_importance` real DEFAULT 1,
	`access_count` integer DEFAULT 0,
	`last_accessed` text DEFAULT (datetime('now', 'localtime')),
	`sentiment` text DEFAULT 'neutral',
	`timestamp` real DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`real_time` text DEFAULT '',
	`prev_id` integer,
	`next_id` integer,
	`msg_timestamp` text,
	`source` text DEFAULT 'desktop',
	`type` text DEFAULT 'event',
	`agent_id` text DEFAULT 'pero' NOT NULL,
	`embedding_json` text DEFAULT '[]',
	`retrieval_quality` real DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX `idx_memory_nodes_agent_id` ON `memory_nodes` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_nodes_timestamp` ON `memory_nodes` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_memory_nodes_type` ON `memory_nodes` (`type`);--> statement-breakpoint
CREATE TABLE `pet_states` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text DEFAULT 'pero' NOT NULL,
	`mood` text DEFAULT '开心',
	`vibe` text DEFAULT '活泼',
	`mind` text DEFAULT '正在想主人...',
	`click_messages_json` text DEFAULT '{}',
	`idle_messages_json` text DEFAULT '[]',
	`back_messages_json` text DEFAULT '[]',
	`updated_at` text DEFAULT (datetime('now', 'localtime')),
	`text_expires_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_pet_states_agent_id` ON `pet_states` (`agent_id`);--> statement-breakpoint
CREATE TABLE `scheduled_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`time` text NOT NULL,
	`content` text NOT NULL,
	`is_triggered` integer DEFAULT false,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`agent_id` text DEFAULT 'pero' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_tasks_agent_id` ON `scheduled_tasks` (`agent_id`);--> statement-breakpoint
CREATE TABLE `social_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`msg_id` text NOT NULL,
	`platform` text DEFAULT 'qq' NOT NULL,
	`channel_id` text NOT NULL,
	`channel_type` text NOT NULL,
	`sender_id` text NOT NULL,
	`sender_name` text DEFAULT '',
	`content` text NOT NULL,
	`agent_id` text DEFAULT 'pero' NOT NULL,
	`raw_event_json` text DEFAULT '{}',
	`timestamp` text DEFAULT (datetime('now', 'localtime')),
	`is_summarized` integer DEFAULT false,
	`account_id` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_social_messages_channel` ON `social_messages` (`channel_id`,`channel_type`);--> statement-breakpoint
CREATE INDEX `idx_social_messages_agent` ON `social_messages` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_social_messages_timestamp` ON `social_messages` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_social_messages_unsummarized` ON `social_messages` (`is_summarized`,`agent_id`);--> statement-breakpoint
CREATE TABLE `stronghold_facilities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text,
	`created_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE TABLE `stronghold_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`facility_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`allowed_agents_json` text DEFAULT '[]',
	`environment_json` text DEFAULT '{}',
	`created_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_stronghold_rooms_facility_id` ON `stronghold_rooms` (`facility_id`);--> statement-breakpoint
CREATE TABLE `trivium_sync_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation` text NOT NULL,
	`memory_id` integer,
	`store_name` text DEFAULT 'memory',
	`dedupe_key` text,
	`payload_json` text DEFAULT '{}',
	`status` text DEFAULT 'pending',
	`retry_count` integer DEFAULT 0,
	`last_error` text,
	`agent_id` text DEFAULT 'pero' NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_trivium_sync_tasks_operation` ON `trivium_sync_tasks` (`operation`);--> statement-breakpoint
CREATE INDEX `idx_trivium_sync_tasks_status` ON `trivium_sync_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_trivium_sync_tasks_memory_id` ON `trivium_sync_tasks` (`memory_id`);--> statement-breakpoint
CREATE INDEX `idx_trivium_sync_tasks_dedupe_key` ON `trivium_sync_tasks` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_trivium_sync_tasks_agent_id` ON `trivium_sync_tasks` (`agent_id`);--> statement-breakpoint
CREATE TABLE `voice_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`api_key` text,
	`api_base` text,
	`model` text,
	`config_json` text DEFAULT '{}',
	`is_active` integer DEFAULT false,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_voice_configs_name` ON `voice_configs` (`name`);