CREATE TABLE thread_character_state_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  pair_id TEXT,
  tool_call_id TEXT,
  patch_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_thread_character_state_scope ON thread_character_state_events(thread_id, agent_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_thread_character_state_call ON thread_character_state_events(thread_id, agent_id, tool_call_id);
--> statement-breakpoint
-- 旧全局状态无法归属会话，仅从各会话仍有效的成功工具记录恢复三状态。
WITH legacy_tools AS (
  SELECT m.id, m.thread_id, m.agent_id, m.pair_id, m.timestamp, t.key,
    CASE WHEN t.type = 'object' THEN t.value ELSE '{}' END AS value
  FROM thread_messages m
  JOIN threads th ON th.id = m.thread_id
  JOIN json_each(CASE WHEN json_valid(m.metadata_json) THEN
    CASE WHEN json_type(m.metadata_json, '$.toolCalls') = 'array'
      THEN json_extract(m.metadata_json, '$.toolCalls') ELSE '[]' END
    ELSE '[]' END) t
  WHERE m.role = 'assistant' AND m.status = 'active' AND th.status != 'deleted'
    AND m.agent_id IS NOT NULL AND m.pair_id IS NOT NULL
)
INSERT OR IGNORE INTO thread_character_state_events
  (thread_id, agent_id, kind, pair_id, tool_call_id, patch_json, created_at)
SELECT m.thread_id, m.agent_id, 'update', m.pair_id,
  COALESCE(json_extract(m.value, '$.callId'), 'legacy-' || m.id || '-' || m.key),
  json_object(
    'mood', CASE WHEN json_type(m.value, '$.args.mood') = 'text' THEN json_extract(m.value, '$.args.mood') END,
    'vibe', CASE WHEN json_type(m.value, '$.args.vibe') = 'text' THEN json_extract(m.value, '$.args.vibe') END,
    'mind', CASE WHEN json_type(m.value, '$.args.mind') = 'text' THEN json_extract(m.value, '$.args.mind') END
  ), COALESCE(m.timestamp, datetime('now'))
FROM legacy_tools m
WHERE json_extract(m.value, '$.name') IN ('update_state', 'finish_task')
  AND COALESCE(json_extract(m.value, '$.isError'), 0) = 0
  AND (json_type(m.value, '$.args.mood') = 'text'
    OR json_type(m.value, '$.args.vibe') = 'text'
    OR json_type(m.value, '$.args.mind') = 'text')
ORDER BY m.id, CAST(m.key AS INTEGER);
