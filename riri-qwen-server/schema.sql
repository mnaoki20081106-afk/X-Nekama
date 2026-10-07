PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS messages(
 message_id TEXT PRIMARY KEY,
 sender_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL,
 text TEXT NOT NULL,
 timestamp_ms INTEGER NOT NULL,
 reply TEXT,
 status TEXT NOT NULL DEFAULT 'generating',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,timestamp_ms DESC);
CREATE TABLE IF NOT EXISTS profile(id INTEGER PRIMARY KEY CHECK(id=1),prompt TEXT NOT NULL);
