ALTER TABLE threads ADD model_config_id integer REFERENCES ai_model_configs(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE threads ADD reasoning_effort text;
