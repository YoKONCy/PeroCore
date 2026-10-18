CREATE TABLE `__new_flow_state_revisions` (
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
INSERT INTO `__new_flow_state_revisions` (`id`, `thread_id`, `agent_id`, `pair_id`, `before_current_goal`, `before_private_facts`, `after_current_goal`, `after_private_facts`, `created_at`)
SELECT `id`, `thread_id`, `agent_id`, `pair_id`, `before_current_goal`, `before_private_facts`, `after_current_goal`, `after_private_facts`, `created_at` FROM `flow_state_revisions`;
--> statement-breakpoint
DROP TABLE `flow_state_revisions`;
--> statement-breakpoint
ALTER TABLE `__new_flow_state_revisions` RENAME TO `flow_state_revisions`;
--> statement-breakpoint
CREATE INDEX `idx_flow_revisions_thread_id` ON `flow_state_revisions` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `idx_flow_revisions_pair_id` ON `flow_state_revisions` (`pair_id`);
--> statement-breakpoint
CREATE TABLE `__new_flow_states` (
	`thread_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`current_goal` text DEFAULT '' NOT NULL,
	`private_facts` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by_pair_id` text,
	`updated_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_flow_states` (`thread_id`, `agent_id`, `current_goal`, `private_facts`, `revision`, `updated_by_pair_id`, `updated_at`)
SELECT `thread_id`, `agent_id`, `current_goal`, `private_facts`, `revision`, `updated_by_pair_id`, `updated_at` FROM `flow_states`;
--> statement-breakpoint
DROP TABLE `flow_states`;
--> statement-breakpoint
ALTER TABLE `__new_flow_states` RENAME TO `flow_states`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_flow_states_thread_agent` ON `flow_states` (`thread_id`,`agent_id`);
--> statement-breakpoint
CREATE INDEX `idx_flow_states_thread_id` ON `flow_states` (`thread_id`);
--> statement-breakpoint
DROP TABLE IF EXISTS `work_context_entries`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tool_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`pair_id` text NOT NULL,
	`call_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_ref` text NOT NULL,
	`version` text,
	`range_start` integer,
	`range_end` integer,
	`excerpt` text NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`observed_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_observations_scope` ON `tool_observations` (`thread_id`,`agent_id`,`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_observations_pair` ON `tool_observations` (`thread_id`,`pair_id`);
--> statement-breakpoint
UPDATE `configs`
SET `value` = json_remove(`value`, '$.workContextExpirationPairs')
WHERE `key` = 'memory.runtime' AND json_valid(`value`);
