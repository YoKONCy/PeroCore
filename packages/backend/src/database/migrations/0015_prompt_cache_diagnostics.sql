ALTER TABLE llm_usage_records ADD COLUMN channel TEXT;
--> statement-breakpoint
ALTER TABLE llm_usage_records ADD COLUMN thread_id TEXT;
--> statement-breakpoint
ALTER TABLE llm_usage_records ADD COLUMN application_id TEXT;
--> statement-breakpoint
ALTER TABLE llm_usage_records ADD COLUMN execution_id TEXT;
--> statement-breakpoint
ALTER TABLE llm_usage_records ADD COLUMN step INTEGER;
--> statement-breakpoint
ALTER TABLE llm_usage_records ADD COLUMN prompt_hash TEXT;
--> statement-breakpoint
ALTER TABLE llm_usage_records ADD COLUMN prefix_hash TEXT;
--> statement-breakpoint
ALTER TABLE llm_usage_records ADD COLUMN tools_hash TEXT;
--> statement-breakpoint
CREATE INDEX idx_llm_usage_channel_started ON llm_usage_records(channel, started_at);
