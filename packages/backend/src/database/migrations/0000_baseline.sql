CREATE TABLE `kernel_outbox_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`durability` text DEFAULT 'durable' NOT NULL,
	`principal_id` text NOT NULL,
	`process_id` text,
	`execution_id` text,
	`correlation_id` text,
	`causation_id` text,
	`object_type` text,
	`object_id` text,
	`object_generation` integer,
	`payload_json` text NOT NULL,
	`occurred_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`next_attempt_at` text,
	`created_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL,
	`published_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_kernel_outbox_status_created` ON `kernel_outbox_events` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_kernel_outbox_execution` ON `kernel_outbox_events` (`execution_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_kernel_outbox_correlation` ON `kernel_outbox_events` (`correlation_id`);--> statement-breakpoint
CREATE TABLE `agent_locations` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE TABLE `ai_model_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`model_id` text NOT NULL,
	`provider` text DEFAULT 'openai',
	`provider_type` text DEFAULT 'global',
	`api_key` text,
	`api_base` text,
	`temperature` real,
	`top_p` real,
	`max_tokens` integer,
	`context_window_tokens` integer,
	`reasoning_effort` text,
	`return_native_reasoning` integer DEFAULT false,
	`wire_api` text DEFAULT 'chat_completions',
	`reasoning_dialect` text DEFAULT 'auto',
	`stream` integer DEFAULT true,
	`enable_vision` integer DEFAULT false,
	`enable_audio_input` integer DEFAULT false,
	`enable_voice` integer DEFAULT false,
	`enable_video` integer DEFAULT false,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ai_model_configs_name` ON `ai_model_configs` (`name`);--> statement-breakpoint
CREATE TABLE `app_checkpoints` (
	`instance_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`progress` real DEFAULT 0,
	`fields_json` text NOT NULL,
	`changed_artifacts_json` text,
	`blockers_json` text,
	`next_actions_json` text,
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE TABLE `app_instances` (
	`instance_id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`host_agent_id` text NOT NULL,
	`status` text DEFAULT 'launching',
	`workspace_path` text,
	`task_context_json` text,
	`launched_by` text,
	`launched_at` text DEFAULT (datetime('now', 'localtime')),
	`stopped_at` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `idx_app_instances_host` ON `app_instances` (`host_agent_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_app_instances_app` ON `app_instances` (`app_id`,`status`);--> statement-breakpoint
CREATE TABLE `app_registry` (
	`app_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`install_path` text NOT NULL,
	`manifest_json` text NOT NULL,
	`installed_at` text DEFAULT (datetime('now', 'localtime')),
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE TABLE `app_resource_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_agent_id` text NOT NULL,
	`holder_id` text NOT NULL,
	`holder_type` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_json` text NOT NULL,
	`permissions` text NOT NULL,
	`granted_by` text DEFAULT 'host_agent',
	`note` text,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`expires_at` text,
	`revoked` integer DEFAULT 0,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_grants_holder` ON `app_resource_grants` (`holder_id`,`revoked`);--> statement-breakpoint
CREATE INDEX `idx_grants_owner` ON `app_resource_grants` (`owner_agent_id`);--> statement-breakpoint
CREATE TABLE `background_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`target_thread_id` text,
	`title` text NOT NULL,
	`instruction` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer,
	`current_stage` text,
	`result` text,
	`error_message` text,
	`tool_call_count` integer DEFAULT 0 NOT NULL,
	`priority` integer DEFAULT 5 NOT NULL,
	`parent_task_id` text,
	`requested_by` text DEFAULT 'user' NOT NULL,
	`completion_action` text DEFAULT 'notify' NOT NULL,
	`category` text DEFAULT 'agent_task' NOT NULL,
	`input_question` text,
	`input_context_json` text,
	`checkpoint_json` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL,
	`started_at` text,
	`completed_at` text,
	`updated_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_background_tasks_agent_id` ON `background_tasks` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_background_tasks_status` ON `background_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_background_tasks_thread_id` ON `background_tasks` (`thread_id`);--> statement-breakpoint
CREATE INDEX `idx_background_tasks_target_thread_id` ON `background_tasks` (`target_thread_id`);--> statement-breakpoint
CREATE INDEX `idx_background_tasks_created_at` ON `background_tasks` (`created_at`);--> statement-breakpoint
CREATE TABLE `butler_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text DEFAULT 'Butler' NOT NULL,
	`persona` text,
	`enabled` integer DEFAULT true,
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE TABLE `configs` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE TABLE `conversation_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`source` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`raw_content` text,
	`timestamp` text DEFAULT (datetime('now', 'localtime')),
	`metadata_json` text DEFAULT '{}',
	`pair_id` text,
	`sentiment` text,
	`importance` integer,
	`memory_id` integer,
	`analysis_status` text DEFAULT 'pending',
	`retry_count` integer DEFAULT 0,
	`last_error` text,
	`agent_id` text DEFAULT 'pero' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_conversation_logs_session_id` ON `conversation_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_conversation_logs_source` ON `conversation_logs` (`source`);--> statement-breakpoint
CREATE INDEX `idx_conversation_logs_pair_id` ON `conversation_logs` (`pair_id`);--> statement-breakpoint
CREATE INDEX `idx_conversation_logs_agent_id` ON `conversation_logs` (`agent_id`);--> statement-breakpoint
CREATE TABLE `file_change_snapshots` (
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
CREATE UNIQUE INDEX `uq_file_change_snapshots_pair_file` ON `file_change_snapshots` (`pair_id`,`file_path`);--> statement-breakpoint
CREATE INDEX `idx_file_change_snapshots_thread_id` ON `file_change_snapshots` (`thread_id`);--> statement-breakpoint
CREATE INDEX `idx_file_change_snapshots_pair_id` ON `file_change_snapshots` (`pair_id`);--> statement-breakpoint
CREATE INDEX `idx_file_change_snapshots_call_id` ON `file_change_snapshots` (`call_id`);--> statement-breakpoint
CREATE TABLE `flow_state_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`pair_id` text,
	`before_current_goal` text DEFAULT '' NOT NULL,
	`before_private_facts` text DEFAULT '' NOT NULL,
	`after_current_goal` text DEFAULT '' NOT NULL,
	`after_private_facts` text DEFAULT '' NOT NULL,
	`before_work_context` text DEFAULT '' NOT NULL,
	`before_work_context_updated_at_pair_count` integer DEFAULT 0 NOT NULL,
	`after_work_context` text DEFAULT '' NOT NULL,
	`after_work_context_updated_at_pair_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_flow_revisions_thread_id` ON `flow_state_revisions` (`thread_id`);--> statement-breakpoint
CREATE INDEX `idx_flow_revisions_pair_id` ON `flow_state_revisions` (`pair_id`);--> statement-breakpoint
CREATE TABLE `flow_states` (
	`thread_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`current_goal` text DEFAULT '' NOT NULL,
	`private_facts` text DEFAULT '' NOT NULL,
	`work_context` text DEFAULT '' NOT NULL,
	`work_context_updated_at_pair_count` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by_pair_id` text,
	`updated_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_flow_states_thread_agent` ON `flow_states` (`thread_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_flow_states_thread_id` ON `flow_states` (`thread_id`);--> statement-breakpoint
CREATE TABLE `group_chat_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`joined_at` text DEFAULT (datetime('now', 'localtime')),
	`role` text DEFAULT 'member'
);
--> statement-breakpoint
CREATE INDEX `idx_group_chat_members_room_id` ON `group_chat_members` (`room_id`);--> statement-breakpoint
CREATE INDEX `idx_group_chat_members_agent_id` ON `group_chat_members` (`agent_id`);--> statement-breakpoint
CREATE TABLE `group_chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`content` text NOT NULL,
	`role` text NOT NULL,
	`timestamp` text DEFAULT (datetime('now', 'localtime')),
	`mentions_json` text DEFAULT '[]',
	`pair_id` text,
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_group_chat_messages_room_id` ON `group_chat_messages` (`room_id`);--> statement-breakpoint
CREATE INDEX `idx_group_chat_messages_sender_id` ON `group_chat_messages` (`sender_id`);--> statement-breakpoint
CREATE INDEX `idx_group_chat_messages_pair_id` ON `group_chat_messages` (`pair_id`);--> statement-breakpoint
CREATE TABLE `stronghold_agent_pair_visibility` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`room_id` text NOT NULL,
	`pair_id` text NOT NULL,
	`observed_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stronghold_agent_pair_visibility` ON `stronghold_agent_pair_visibility` (`agent_id`,`pair_id`);--> statement-breakpoint
CREATE INDEX `idx_stronghold_visibility_agent_observed` ON `stronghold_agent_pair_visibility` (`agent_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `idx_stronghold_visibility_pair` ON `stronghold_agent_pair_visibility` (`pair_id`);--> statement-breakpoint
CREATE TABLE `group_chat_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`creator_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inbound_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`identifier` text NOT NULL,
	`agent_id` text NOT NULL,
	`channel` text DEFAULT 'social' NOT NULL,
	`thread_id` text,
	`config` text DEFAULT '{}',
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_inbound_routes_source` ON `inbound_routes` (`source`);--> statement-breakpoint
CREATE INDEX `idx_inbound_routes_agent` ON `inbound_routes` (`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_inbound_routes_source_identifier` ON `inbound_routes` (`source`,`identifier`);--> statement-breakpoint
CREATE TABLE `mcp_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'stdio',
	`command` text,
	`args` text DEFAULT '[]',
	`env` text DEFAULT '{}',
	`url` text,
	`enabled` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mcp_configs_name` ON `mcp_configs` (`name`);--> statement-breakpoint
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
CREATE INDEX `idx_message_attachments_message_id` ON `message_attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_message_attachments_thread_id` ON `message_attachments` (`thread_id`);--> statement-breakpoint
CREATE INDEX `idx_message_attachments_status` ON `message_attachments` (`status`);--> statement-breakpoint
CREATE TABLE `node_capability_registrations` (
	`node_id` text PRIMARY KEY NOT NULL,
	`node_type` text NOT NULL,
	`url` text,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'online' NOT NULL,
	`registered_at` text DEFAULT (datetime('now', 'localtime')),
	`last_heartbeat` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_node_capability_registrations_status` ON `node_capability_registrations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_node_capability_registrations_type` ON `node_capability_registrations` (`node_type`);--> statement-breakpoint
CREATE TABLE `pet_states` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text DEFAULT 'pero' NOT NULL,
	`mood` text DEFAULT '开心',
	`vibe` text DEFAULT '活泼',
	`mind` text DEFAULT '正在发呆...',
	`click_messages_json` text DEFAULT '{}',
	`idle_messages_json` text DEFAULT '[]',
	`back_messages_json` text DEFAULT '[]',
	`text_expires_at` text,
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_pet_states_agent_id` ON `pet_states` (`agent_id`);--> statement-breakpoint
CREATE TABLE `scheduled_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`time` text NOT NULL,
	`content` text NOT NULL,
	`is_triggered` integer DEFAULT false,
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`agent_id` text DEFAULT 'pero' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_tasks_agent_id` ON `scheduled_tasks` (`agent_id`);--> statement-breakpoint
CREATE TABLE `social_contact_impressions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`platform` text DEFAULT 'qq' NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`identity` text DEFAULT '' NOT NULL,
	`impression` text NOT NULL,
	`source_channel_id` text,
	`updated_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_social_contact_impressions_scope` ON `social_contact_impressions` (`agent_id`,`platform`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_social_contact_impressions_user` ON `social_contact_impressions` (`user_id`);--> statement-breakpoint
CREATE TABLE `social_history_tombstones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`platform` text NOT NULL,
	`account_id` text DEFAULT '' NOT NULL,
	`channel_type` text DEFAULT '*' NOT NULL,
	`channel_id` text DEFAULT '*' NOT NULL,
	`deleted_before` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_social_history_tombstone_scope` ON `social_history_tombstones` (`agent_id`,`platform`,`account_id`,`channel_type`,`channel_id`);--> statement-breakpoint
CREATE TABLE `social_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`msg_id` text NOT NULL,
	`platform` text DEFAULT 'qq' NOT NULL,
	`account_id` text DEFAULT '' NOT NULL,
	`channel_id` text NOT NULL,
	`channel_type` text NOT NULL,
	`sender_id` text NOT NULL,
	`sender_name` text DEFAULT '',
	`content` text NOT NULL,
	`agent_id` text DEFAULT 'pero' NOT NULL,
	`raw_event_json` text DEFAULT '{}',
	`timestamp` text DEFAULT (datetime('now', 'localtime')),
	`is_summarized` integer DEFAULT false
);
--> statement-breakpoint
CREATE INDEX `idx_social_messages_channel` ON `social_messages` (`channel_id`,`channel_type`);--> statement-breakpoint
CREATE INDEX `idx_social_messages_agent` ON `social_messages` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_social_messages_timestamp` ON `social_messages` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_social_messages_unsummarized` ON `social_messages` (`is_summarized`,`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_social_messages_platform_message` ON `social_messages` (`agent_id`,`platform`,`account_id`,`msg_id`);--> statement-breakpoint
CREATE TABLE `social_sync_cursors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`platform` text NOT NULL,
	`account_id` text NOT NULL,
	`last_successful_sync_at` integer DEFAULT 0 NOT NULL,
	`sync_started_at` integer,
	`status` text DEFAULT 'idle' NOT NULL,
	`last_error` text,
	`updated_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_social_sync_cursor_scope` ON `social_sync_cursors` (`agent_id`,`platform`,`account_id`);--> statement-breakpoint
CREATE TABLE `stronghold_facilities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text,
	`created_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE TABLE `stronghold_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`facility_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`allowed_agents_json` text DEFAULT '[]',
	`environment_json` text DEFAULT '{}',
	`created_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_stronghold_rooms_facility_id` ON `stronghold_rooms` (`facility_id`);--> statement-breakpoint
CREATE TABLE `thread_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`raw_content` text,
	`status` text DEFAULT 'active',
	`pair_id` text,
	`sender_id` text,
	`revision` integer DEFAULT 1,
	`agent_id` text,
	`metadata_json` text DEFAULT '{}',
	`scorer_status` text DEFAULT 'pending',
	`timestamp` text DEFAULT (datetime('now', 'localtime')),
	`deleted_at` text,
	`deleted_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_thread_messages_thread_id` ON `thread_messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `idx_thread_messages_pair_id` ON `thread_messages` (`pair_id`);--> statement-breakpoint
CREATE INDEX `idx_thread_messages_status` ON `thread_messages` (`status`);--> statement-breakpoint
CREATE INDEX `idx_thread_messages_agent_id` ON `thread_messages` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_thread_messages_scorer_status` ON `thread_messages` (`scorer_status`);--> statement-breakpoint
CREATE TABLE `thread_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`content` text NOT NULL,
	`covers_message_ids` text DEFAULT '[]',
	`revision` integer DEFAULT 1,
	`is_stale` integer DEFAULT false,
	`created_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_thread_summaries_thread_id` ON `thread_summaries` (`thread_id`);--> statement-breakpoint
CREATE INDEX `idx_thread_summaries_stale` ON `thread_summaries` (`is_stale`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`channel` text DEFAULT 'desktop' NOT NULL,
	`platform` text,
	`platform_identifier` text,
	`title` text DEFAULT '',
	`message_count` integer DEFAULT 0,
	`pair_count` integer DEFAULT 0,
	`last_message_at` text,
	`status` text DEFAULT 'active',
	`context_policy` text,
	`disabled_tools_json` text DEFAULT '[]' NOT NULL,
	`auto_execute_tools` integer DEFAULT false NOT NULL,
	`purpose` text DEFAULT 'conversation',
	`created_at` text DEFAULT (datetime('now', 'localtime')),
	`updated_at` text DEFAULT (datetime('now', 'localtime'))
);
--> statement-breakpoint
CREATE INDEX `idx_threads_agent_id` ON `threads` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_threads_channel` ON `threads` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_threads_platform` ON `threads` (`platform`);--> statement-breakpoint
CREATE INDEX `idx_threads_status` ON `threads` (`status`);--> statement-breakpoint
CREATE INDEX `idx_threads_purpose` ON `threads` (`purpose`);--> statement-breakpoint
CREATE TABLE `agent_input_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`channel` text NOT NULL,
	`session_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`task_id` text,
	`question` text NOT NULL,
	`context` text,
	`options_json` text DEFAULT '[]' NOT NULL,
	`allow_free_text` integer DEFAULT true NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`selected_option_ids_json` text DEFAULT '[]' NOT NULL,
	`response_message` text,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_agent_input_status` ON `agent_input_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_input_thread` ON `agent_input_requests` (`thread_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_input_session` ON `agent_input_requests` (`session_id`,`status`);--> statement-breakpoint
CREATE TABLE `tool_approval_audit_logs` (
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
CREATE INDEX `idx_tool_approval_audit_approval` ON `tool_approval_audit_logs` (`approval_id`);--> statement-breakpoint
CREATE INDEX `idx_tool_approval_audit_session` ON `tool_approval_audit_logs` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `tool_approval_requests` (
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
	`risk_level` text DEFAULT 'low' NOT NULL,
	`status` text NOT NULL,
	`decision` text,
	`resolution_message` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_tool_approval_status` ON `tool_approval_requests` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_tool_approval_session` ON `tool_approval_requests` (`session_id`,`tool_name`);--> statement-breakpoint
CREATE INDEX `idx_tool_approval_agent` ON `tool_approval_requests` (`agent_id`,`tool_name`);--> statement-breakpoint
CREATE TABLE `kernel_assets` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`object_type` text DEFAULT 'asset' NOT NULL,
	`object_generation` integer DEFAULT 1 NOT NULL,
	`owner_principal_id` text NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`source` text NOT NULL,
	`storage_ref` text NOT NULL,
	`retention` text NOT NULL,
	`created_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_kernel_assets_owner` ON `kernel_assets` (`owner_principal_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_kernel_assets_sha256` ON `kernel_assets` (`sha256`);--> statement-breakpoint
CREATE TABLE `kernel_transfers` (
	`transfer_id` text PRIMARY KEY NOT NULL,
	`object_generation` integer DEFAULT 1 NOT NULL,
	`direction` text NOT NULL,
	`state` text NOT NULL,
	`source_ref_json` text,
	`destination_ref_json` text,
	`bytes_total` integer,
	`bytes_transferred` integer DEFAULT 0 NOT NULL,
	`checksum` text,
	`result_asset_ref_json` text,
	`principal_id` text NOT NULL,
	`process_id` text,
	`execution_id` text,
	`correlation_id` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text
);--> statement-breakpoint
CREATE INDEX `idx_kernel_transfers_principal` ON `kernel_transfers` (`principal_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_kernel_transfers_state` ON `kernel_transfers` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_kernel_transfers_execution` ON `kernel_transfers` (`execution_id`,`created_at`);
