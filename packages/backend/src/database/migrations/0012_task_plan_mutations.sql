CREATE TABLE `task_plan_mutations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `thread_id` text NOT NULL,
  `agent_id` text NOT NULL,
  `pair_id` text NOT NULL,
  `call_id` text,
  `before_json` text NOT NULL,
  `after_json` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_task_plan_mutations_thread_pair` ON `task_plan_mutations` (`thread_id`, `pair_id`);
