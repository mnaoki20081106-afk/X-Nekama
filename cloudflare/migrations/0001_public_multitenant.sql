PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  login_x_user_id TEXT NOT NULL UNIQUE,
  login_username TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  x_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  character_name TEXT NOT NULL DEFAULT '',
  age INTEGER,
  gender TEXT NOT NULL DEFAULT '',
  occupation TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  first_person TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  hobbies TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  emoji_style TEXT NOT NULL DEFAULT '',
  ng_topics TEXT NOT NULL DEFAULT '',
  posting_frequency INTEGER NOT NULL DEFAULT 7,
  activity_interval_days INTEGER NOT NULL DEFAULT 1,
  active_hours TEXT NOT NULL DEFAULT '10:00-22:00',
  auto_approve INTEGER NOT NULL DEFAULT 0,
  auto_generate_images INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0,
  session_cipher TEXT NOT NULL,
  session_status TEXT NOT NULL DEFAULT 'connected',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, x_user_id)
);
CREATE INDEX IF NOT EXISTS accounts_owner ON accounts(owner_id);

CREATE TABLE IF NOT EXISTS refs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  summary TEXT NOT NULL DEFAULT '',
  fetched_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, username)
);
CREATE INDEX IF NOT EXISTS refs_owner ON refs(owner_id);

CREATE TABLE IF NOT EXISTS ref_posts (
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  posted_at TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  media_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY(owner_id, ref_id, id)
);
CREATE INDEX IF NOT EXISTS ref_posts_ref ON ref_posts(owner_id,ref_id,posted_at);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('base','style','generated')),
  category TEXT,
  name TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS assets_owner ON assets(owner_id);
CREATE INDEX IF NOT EXISTS assets_account ON assets(owner_id,account_id);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  image_style TEXT,
  image_prompt TEXT NOT NULL DEFAULT '',
  image_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK(status IN ('needs_review','scheduled','publishing','posted','failed')),
  scheduled_at TEXT,
  posted_at TEXT,
  x_post_id TEXT,
  queue_key TEXT,
  content_fingerprint TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  last_error_kind TEXT NOT NULL DEFAULT '',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS drafts_owner ON drafts(owner_id);
CREATE INDEX IF NOT EXISTS drafts_due ON drafts(status,scheduled_at,next_attempt_at);
CREATE INDEX IF NOT EXISTS drafts_account ON drafts(owner_id,account_id);
CREATE UNIQUE INDEX IF NOT EXISTS drafts_queue_key ON drafts(queue_key) WHERE queue_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner_id);

CREATE TABLE IF NOT EXISTS publish_locks (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL,
  locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  kind TEXT NOT NULL,
  object_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS audit_owner ON audit_events(owner_id,created_at);


