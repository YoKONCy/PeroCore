-- Agent 应用层表结构（AgentApplication + GrantRegistry）
-- 第八阶段：AIOS 应用平台基础设施

CREATE TABLE `app_registry` (
	`app_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`install_path` text NOT NULL,
	`manifest_json` text NOT NULL,
	`installed_at` text DEFAULT (datetime('now', 'localtime')),
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint

CREATE TABLE `app_instances` (
	`instance_id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`host_agent_id` text NOT NULL,
	`status` text DEFAULT 'launching',
	`workspace_path` text,
	`task_context_json` text,
	`launched_by` text,
	`launched_at` text DEFAULT (datetime('now', 'localtime')),
	`stopped_at` text,
	`error` text
);
--> statement-breakpoint

CREATE INDEX `idx_app_instances_host` ON `app_instances` (`host_agent_id`, `status`);--> statement-breakpoint
CREATE INDEX `idx_app_instances_app` ON `app_instances` (`app_id`, `status`);--> statement-breakpoint

CREATE TABLE `app_checkpoints` (
	`instance_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`progress` real DEFAULT 0,
	`fields_json` text NOT NULL,
	`changed_artifacts_json` text,
	`blockers_json` text,
	`next_actions_json` text,
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint

CREATE TABLE `app_resource_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_agent_id` text NOT NULL,
	`holder_id` text NOT NULL,
	`holder_type` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_json` text NOT NULL,
	`permissions` text NOT NULL,
	`granted_by` text DEFAULT 'host_agent',
	`note` text,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`expires_at` text,
	`revoked` integer DEFAULT 0,
	`revoked_at` text
);
--> statement-breakpoint

CREATE INDEX `idx_grants_holder` ON `app_resource_grants` (`holder_id`, `revoked`);--> statement-breakpoint
CREATE INDEX `idx_grants_owner` ON `app_resource_grants` (`owner_agent_id`);
