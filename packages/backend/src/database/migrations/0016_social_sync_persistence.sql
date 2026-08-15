-- 社交持久化表：历史墓碑 / 同步游标 / 联系人印象
-- 此前仅存在于 connection.ts applySchemaFixups 的增量修补中，
-- fresh 安装路径（首次启动执行全部迁移）不会建表，导致对应功能首次调用即报 no such table。
-- 新增本迁移让 fresh 安装与已有库增量修补两条路径的 schema 保持一致。
CREATE TABLE IF NOT EXISTS `social_history_tombstones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`platform` text NOT NULL,
	`account_id` text DEFAULT '' NOT NULL,
	`channel_type` text DEFAULT '*' NOT NULL,
	`channel_id` text DEFAULT '*' NOT NULL,
	`deleted_before` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_social_history_tombstone_scope` ON `social_history_tombstones` (`agent_id`,`platform`,`account_id`,`channel_type`,`channel_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `social_sync_cursors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`platform` text NOT NULL,
	`account_id` text NOT NULL,
	`last_successful_sync_at` integer DEFAULT 0 NOT NULL,
	`sync_started_at` integer,
	`status` text DEFAULT 'idle' NOT NULL,
	`last_error` text,
	`updated_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_social_sync_cursor_scope` ON `social_sync_cursors` (`agent_id`,`platform`,`account_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `social_contact_impressions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`platform` text DEFAULT 'qq' NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`identity` text DEFAULT '' NOT NULL,
	`impression` text NOT NULL,
	`source_channel_id` text,
	`updated_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_social_contact_impressions_scope` ON `social_contact_impressions` (`agent_id`,`platform`,`user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_social_contact_impressions_user` ON `social_contact_impressions` (`user_id`);
