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
