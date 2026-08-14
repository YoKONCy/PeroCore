CREATE TABLE `message_attachments` (
  `id` text PRIMARY KEY NOT NULL,
  `thread_id` text NOT NULL,
  `message_id` integer,
  `kind` text NOT NULL,
  `original_name` text NOT NULL,
  `mime_type` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `sha256` text NOT NULL,
  `storage_key` text NOT NULL,
  `context_policy` text DEFAULT 'once' NOT NULL,
  `status` text DEFAULT 'uploaded' NOT NULL,
  `extracted_text` text,
  `token_estimate` integer,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `created_at` text DEFAULT (datetime('now', 'localtime')),
  `bound_at` text,
  `deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_message_attachments_message_id` ON `message_attachments` (`message_id`);
--> statement-breakpoint
CREATE INDEX `idx_message_attachments_thread_id` ON `message_attachments` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `idx_message_attachments_status` ON `message_attachments` (`status`);
