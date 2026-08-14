CREATE TABLE IF NOT EXISTS `file_change_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `thread_id` text NOT NULL,
  `pair_id` text NOT NULL,
  `call_id` text NOT NULL,
  `file_path` text NOT NULL,
  `operation` text DEFAULT 'modify' NOT NULL,
  `rename_target_path` text,
  `original_content` text,
  `original_sha256` text,
  `final_sha256` text,
  `created_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_file_change_snapshots_pair_file` ON `file_change_snapshots` (`pair_id`,`file_path`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_file_change_snapshots_thread_id` ON `file_change_snapshots` (`thread_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_file_change_snapshots_pair_id` ON `file_change_snapshots` (`pair_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_file_change_snapshots_call_id` ON `file_change_snapshots` (`call_id`);
