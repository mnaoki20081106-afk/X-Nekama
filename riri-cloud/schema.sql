CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY NOT NULL,
  sender_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  reply TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_riri_pending ON messages(status, timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_riri_context ON messages(conversation_id,timestamp_ms);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spend (
  month TEXT PRIMARY KEY NOT NULL,
  estimated_cents INTEGER NOT NULL DEFAULT 0,
  approved_extra_cents INTEGER NOT NULL DEFAULT 0
);

-- Additive schema: safe to apply repeatedly to an existing D1 database.
CREATE TABLE IF NOT EXISTS conversation_memory (
 conversation_id TEXT PRIMARY KEY NOT NULL,
 summary TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS persona_configs (
 scope TEXT PRIMARY KEY NOT NULL,
 config TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS conversation_leases (
 conversation_id TEXT PRIMARY KEY NOT NULL,
 lease_until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inference_metrics (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 conversation_id TEXT NOT NULL,
 elapsed_ms INTEGER NOT NULL,
 ok INTEGER NOT NULL CHECK(ok IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_metrics_created ON inference_metrics(created_at);

-- Per-conversation delivery cadence. Explicit activity times keep cross-timezone handling deterministic.
CREATE TABLE IF NOT EXISTS conversation_activity(
 conversation_id TEXT PRIMARY KEY NOT NULL,
 last_inbound_ms INTEGER NOT NULL DEFAULT 0,
 last_sent_ms INTEGER NOT NULL DEFAULT 0
);
