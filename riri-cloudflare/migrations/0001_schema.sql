CREATE TABLE IF NOT EXISTS messages (message_id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, conversation_id TEXT NOT NULL, text TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'generating', reply TEXT);
CREATE INDEX IF NOT EXISTS messages_sender ON messages(sender_id, timestamp_ms);
CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), prompt TEXT NOT NULL);
