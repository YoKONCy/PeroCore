CREATE TABLE `conversation_queue_threads` (
  `thread_id` text PRIMARY KEY NOT NULL,
  `paused` integer DEFAULT 0 NOT NULL,
  `reason` text
);
--> statement-breakpoint
CREATE TABLE `conversation_queue_items` (
  `id` text PRIMARY KEY NOT NULL,
  `thread_id` text NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `position` integer NOT NULL,
  `state` text DEFAULT 'queued' NOT NULL,
  `input_json` text NOT NULL,
  `immediate` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `error` text,
  `checkpoint_json` text
);
--> statement-breakpoint
CREATE INDEX `idx_conversation_queue_thread` ON `conversation_queue_items` (`thread_id`, `state`, `position`);
