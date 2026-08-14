CREATE TABLE IF NOT EXISTS `flow_states` (
  `thread_id` text NOT NULL,
  `agent_id` text NOT NULL,
  `current_goal` text DEFAULT '' NOT NULL,
  `private_facts` text DEFAULT '' NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `updated_by_pair_id` text,
  `updated_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_flow_states_thread_agent` ON `flow_states` (`thread_id`,`agent_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_flow_states_thread_id` ON `flow_states` (`thread_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `flow_state_revisions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `thread_id` text NOT NULL,
  `agent_id` text NOT NULL,
  `pair_id` text,
  `before_current_goal` text DEFAULT '' NOT NULL,
  `before_private_facts` text DEFAULT '' NOT NULL,
  `after_current_goal` text DEFAULT '' NOT NULL,
  `after_private_facts` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_flow_revisions_thread_id` ON `flow_state_revisions` (`thread_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_flow_revisions_pair_id` ON `flow_state_revisions` (`pair_id`);
