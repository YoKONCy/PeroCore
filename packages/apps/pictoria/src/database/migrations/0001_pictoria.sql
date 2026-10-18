CREATE TABLE entities (
  owner TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
  value_json TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (owner, kind, id)
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, project_id TEXT NOT NULL,
  state TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX runs_owner_state ON runs(owner, state, updated_at);
CREATE TABLE requests (
  owner TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, run_id TEXT NOT NULL,
  PRIMARY KEY(owner, request_key), FOREIGN KEY(run_id) REFERENCES runs(id)
);
CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, value_json TEXT NOT NULL
);
CREATE INDEX assets_owner ON assets(owner);
CREATE TABLE secrets (
  owner TEXT NOT NULL, id TEXT NOT NULL, encrypted TEXT NOT NULL, PRIMARY KEY(owner, id)
);
CREATE TABLE outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL, run_id TEXT NOT NULL, value_json TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX outbox_pending ON outbox(acknowledged, sequence);
