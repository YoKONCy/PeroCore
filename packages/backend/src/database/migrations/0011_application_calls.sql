CREATE TABLE `application_calls` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `agent_id` text NOT NULL,
  `thread_id` text NOT NULL,
  `request_json` text NOT NULL,
  `run_id` text,
  `state` text DEFAULT 'submitting' NOT NULL,
  `revision` integer DEFAULT 0 NOT NULL,
  `message_id` integer,
  `delivery_status` text DEFAULT 'pending' NOT NULL,
  `result_json` text,
  `error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_application_calls_run` ON `application_calls` (`app_id`, `run_id`);
--> statement-breakpoint
CREATE INDEX `idx_application_calls_owner` ON `application_calls` (`agent_id`, `created_at`);
