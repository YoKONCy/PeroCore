DROP TABLE `agent_profiles`;--> statement-breakpoint
DROP TABLE `voice_configs`;--> statement-breakpoint
DROP INDEX `idx_trivium_sync_tasks_dedupe_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `trivium_sync_tasks_dedupe_key_unique` ON `trivium_sync_tasks` (`dedupe_key`);