-- 旧库通过启动补表创建通知表；全新数据库需要先建立同一基线，再执行升级。
CREATE TABLE IF NOT EXISTS durable_notifications (
  notification_id TEXT PRIMARY KEY NOT NULL,
  principal_id TEXT NOT NULL,
  audience_json TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  level TEXT DEFAULT 'info' NOT NULL,
  status TEXT DEFAULT 'unread' NOT NULL,
  revision INTEGER DEFAULT 1 NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
--> statement-breakpoint
ALTER TABLE durable_notifications ADD COLUMN metadata_json TEXT DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE durable_notifications ADD COLUMN expires_at TEXT;
--> statement-breakpoint
CREATE TABLE notification_feed (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  notification_id TEXT NOT NULL UNIQUE REFERENCES durable_notifications(notification_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE notification_device_receipts (
  device_id TEXT NOT NULL,
  notification_id TEXT NOT NULL REFERENCES durable_notifications(notification_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  presented_at TEXT,
  read_at TEXT,
  PRIMARY KEY (device_id, notification_id)
);
--> statement-breakpoint
-- 历史通知只补收近期未读项，避免升级后推送已经展示过的旧消息。
INSERT INTO notification_feed(notification_id)
SELECT notification_id FROM durable_notifications
WHERE status = 'unread' AND julianday(created_at) >= julianday('now', '-7 days')
ORDER BY created_at, notification_id;
