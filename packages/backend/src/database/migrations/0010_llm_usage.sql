CREATE TABLE `llm_usage_records` (
  `id` text PRIMARY KEY NOT NULL,
  `started_at` integer NOT NULL,
  `finished_at` integer NOT NULL,
  `provider` text NOT NULL,
  `model_id` text NOT NULL,
  `agent_id` text,
  `purpose` text NOT NULL,
  `status` text NOT NULL,
  `input_tokens` integer,
  `output_tokens` integer,
  `total_tokens` integer,
  `cached_read_tokens` integer,
  `cached_write_tokens` integer,
  `reasoning_tokens` integer
);
--> statement-breakpoint
CREATE INDEX `idx_llm_usage_started` ON `llm_usage_records` (`started_at`);
--> statement-breakpoint
CREATE INDEX `idx_llm_usage_agent_started` ON `llm_usage_records` (`agent_id`, `started_at`);
