CREATE TABLE `tarot_days` (
  `day` text PRIMARY KEY NOT NULL,
  `time_zone` text NOT NULL,
  `question` text NOT NULL,
  `user_card_json` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tarot_readings` (
  `id` text PRIMARY KEY NOT NULL,
  `day` text NOT NULL REFERENCES `tarot_days`(`day`) ON DELETE CASCADE,
  `agent_id` text NOT NULL,
  `reading_json` text NOT NULL,
  `persona` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tarot_day_agent` ON `tarot_readings` (`day`, `agent_id`);
--> statement-breakpoint
CREATE INDEX `idx_tarot_agent_created` ON `tarot_readings` (`agent_id`, `created_at`);
