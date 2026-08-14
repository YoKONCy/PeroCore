CREATE TABLE IF NOT EXISTS `tool_approval_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_id` text NOT NULL,
  `channel` text NOT NULL,
  `session_id` text NOT NULL,
  `thread_id` text NOT NULL,
  `task_id` text,
  `tool_name` text NOT NULL,
  `args_summary_json` text NOT NULL,
  `args_fingerprint` text NOT NULL,
  `reason` text NOT NULL,
  `status` text NOT NULL,
  `decision` text,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `resolved_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_approval_status` ON `tool_approval_requests` (`status`, `expires_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_approval_session` ON `tool_approval_requests` (`session_id`, `tool_name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_approval_agent` ON `tool_approval_requests` (`agent_id`, `tool_name`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tool_approval_audit_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `approval_id` text,
  `event` text NOT NULL,
  `agent_id` text NOT NULL,
  `session_id` text NOT NULL,
  `tool_name` text NOT NULL,
  `detail_json` text DEFAULT '{}' NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_approval_audit_approval` ON `tool_approval_audit_logs` (`approval_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_approval_audit_session` ON `tool_approval_audit_logs` (`session_id`, `created_at`);
