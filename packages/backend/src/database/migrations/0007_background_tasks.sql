-- M05 统一任务中心：BackgroundTask 持久化 + Thread 用途区分
-- 详见 .docs/M05_TASK_CENTER_TODO.md §3 数据模型与 §5.1 已确认决策
ALTER TABLE `threads` ADD COLUMN `purpose` text DEFAULT 'conversation';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_threads_purpose` ON `threads` (`purpose`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `background_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_id` text NOT NULL,
  `thread_id` text NOT NULL,
  `title` text NOT NULL,
  `instruction` text NOT NULL,
  `status` text DEFAULT 'queued' NOT NULL,
  `progress` integer,
  `current_stage` text,
  `workspace` text,
  `result` text,
  `error_message` text,
  `tool_call_count` integer DEFAULT 0 NOT NULL,
  `priority` integer DEFAULT 5 NOT NULL,
  `parent_task_id` text,
  `requested_by` text DEFAULT 'user' NOT NULL,
  `completion_action` text DEFAULT 'notify' NOT NULL,
  `checkpoint_json` text,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `created_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL,
  `started_at` text,
  `completed_at` text,
  `updated_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL,
  `read_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_background_tasks_agent_id` ON `background_tasks` (`agent_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_background_tasks_status` ON `background_tasks` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_background_tasks_thread_id` ON `background_tasks` (`thread_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_background_tasks_created_at` ON `background_tasks` (`created_at`);
