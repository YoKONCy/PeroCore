CREATE TABLE IF NOT EXISTS social_turns (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  status TEXT NOT NULL,
  record_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_social_turns_status ON social_turns(status, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_social_turns_agent ON social_turns(agent_id,account_id,status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS privacy_deletions (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  agent_id TEXT,
  metadata_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_privacy_deletion_target ON privacy_deletions(kind, target_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS social_data_fences (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  channel_type TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  cleared_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS social_inbox (
  agent_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  msg_id TEXT NOT NULL,
  PRIMARY KEY(agent_id,account_id,msg_id)
);
