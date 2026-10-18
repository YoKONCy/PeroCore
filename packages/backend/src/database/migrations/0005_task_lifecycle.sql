ALTER TABLE `background_tasks` ADD `revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `background_tasks` ADD `lifecycle_json` text;
--> statement-breakpoint
CREATE TABLE `task_deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL,
  `channel` text NOT NULL,
  `payload_json` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `next_attempt_at` text,
  `last_error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_task_deliveries_pending` ON `task_deliveries` (`status`, `next_attempt_at`);
