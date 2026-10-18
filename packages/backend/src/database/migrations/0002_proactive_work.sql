CREATE TABLE `proactive_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`title` text NOT NULL,
	`instruction` text NOT NULL,
	`reason` text NOT NULL,
	`source_execution_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`task_id` text,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_proactive_suggestions_agent_status` ON `proactive_suggestions` (`agent_id`,`status`);--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `thread_id` text;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `source_execution_id` text;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `claim_token` text;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `lease_until` text;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `next_attempt_at` text;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `task_id` text;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD `settled_at` text;--> statement-breakpoint
CREATE INDEX `idx_scheduled_tasks_due` ON `scheduled_tasks` (`status`,`time`);
--> statement-breakpoint
UPDATE `scheduled_tasks` SET `status` = 'completed' WHERE `is_triggered` = 1;
