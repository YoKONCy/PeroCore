CREATE TABLE `canonical_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`summary` text,
	`importance` real DEFAULT 0.5,
	`confidence` real DEFAULT 0.5,
	`status` text DEFAULT 'active',
	`provenance` text NOT NULL,
	`superseded_by` text,
	`supersedes` text,
	`vector_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_canonical_memories_agent_id` ON `canonical_memories` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_canonical_memories_type` ON `canonical_memories` (`type`);--> statement-breakpoint
CREATE INDEX `idx_canonical_memories_status` ON `canonical_memories` (`status`);--> statement-breakpoint
CREATE INDEX `idx_canonical_memories_created_at` ON `canonical_memories` (`created_at`);--> statement-breakpoint
CREATE TABLE `inbound_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`identifier` text NOT NULL,
	`agent_id` text NOT NULL,
	`channel` text DEFAULT 'social' NOT NULL,
	`thread_id` text,
	`config` text DEFAULT '{}',
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_inbound_routes_source` ON `inbound_routes` (`source`);--> statement-breakpoint
CREATE INDEX `idx_inbound_routes_agent` ON `inbound_routes` (`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_inbound_routes_source_identifier` ON `inbound_routes` (`source`,`identifier`);--> statement-breakpoint
CREATE TABLE `memory_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`source` text NOT NULL,
	`origin_thread_id` text,
	`origin_message_ids` text,
	`summary` text NOT NULL,
	`evidence_refs` text,
	`importance` real DEFAULT 0.5,
	`confidence` real DEFAULT 0.5,
	`suggested_type` text NOT NULL,
	`status` text DEFAULT 'pending',
	`created_at` text NOT NULL,
	`processed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_memory_candidates_agent_id` ON `memory_candidates` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_candidates_status` ON `memory_candidates` (`status`);--> statement-breakpoint
CREATE INDEX `idx_memory_candidates_origin_thread` ON `memory_candidates` (`origin_thread_id`);--> statement-breakpoint
CREATE TABLE `node_capability_registrations` (
	`node_id` text PRIMARY KEY NOT NULL,
	`node_type` text NOT NULL,
	`url` text,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'online' NOT NULL,
	`registered_at` text DEFAULT (datetime('now', 'localtime')),
	`last_heartbeat` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_node_capability_registrations_status` ON `node_capability_registrations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_node_capability_registrations_type` ON `node_capability_registrations` (`node_type`);--> statement-breakpoint
CREATE TABLE `thread_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`raw_content` text,
	`status` text DEFAULT 'active',
	`pair_id` text,
	`sender_id` text,
	`revision` integer DEFAULT 1,
	`agent_id` text,
	`metadata_json` text DEFAULT '{}',
	`scorer_status` text DEFAULT 'pending',
	`timestamp` text DEFAULT (datetime('now', 'localtime')),
	`deleted_at` text,
	`deleted_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_thread_messages_thread_id` ON `thread_messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `idx_thread_messages_pair_id` ON `thread_messages` (`pair_id`);--> statement-breakpoint
CREATE INDEX `idx_thread_messages_status` ON `thread_messages` (`status`);--> statement-breakpoint
CREATE INDEX `idx_thread_messages_agent_id` ON `thread_messages` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_thread_messages_scorer_status` ON `thread_messages` (`scorer_status`);--> statement-breakpoint
CREATE TABLE `thread_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`content` text NOT NULL,
	`covers_message_ids` text DEFAULT '[]',
	`revision` integer DEFAULT 1,
	`is_stale` integer DEFAULT false,
	`created_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_thread_summaries_thread_id` ON `thread_summaries` (`thread_id`);--> statement-breakpoint
CREATE INDEX `idx_thread_summaries_stale` ON `thread_summaries` (`is_stale`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`channel` text DEFAULT 'desktop' NOT NULL,
	`platform` text,
	`platform_identifier` text,
	`title` text DEFAULT '',
	`message_count` integer DEFAULT 0,
	`pair_count` integer DEFAULT 0,
	`last_message_at` text,
	`status` text DEFAULT 'active',
	`context_policy` text,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_threads_agent_id` ON `threads` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_threads_channel` ON `threads` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_threads_platform` ON `threads` (`platform`);--> statement-breakpoint
CREATE INDEX `idx_threads_status` ON `threads` (`status`);