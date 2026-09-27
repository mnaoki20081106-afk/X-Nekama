import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export const dataDir=process.env.DATA_DIR || './data';
mkdirSync(dataDir,{recursive:true,mode:0o700});
export const db=new DatabaseSync(join(dataDir,'app.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 character_name TEXT NOT NULL, age INTEGER, location TEXT DEFAULT '', tone TEXT DEFAULT '',
 personality TEXT DEFAULT '', hobbies TEXT DEFAULT '', bio TEXT DEFAULT '',
 emoji_style TEXT DEFAULT '', ng_topics TEXT DEFAULT '', posting_frequency INTEGER DEFAULT 7,
 active_hours TEXT DEFAULT '10:00-22:00', base_image_id TEXT,
 session_cipher TEXT, session_status TEXT DEFAULT 'unconnected', enabled INTEGER DEFAULT 0,
 auto_approve INTEGER DEFAULT 0,
 created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS refs (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT DEFAULT '',
 account_id TEXT, summary TEXT DEFAULT '', fetched_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ref_posts (
 id TEXT PRIMARY KEY, ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
 text TEXT NOT NULL, posted_at TEXT, metrics_json TEXT DEFAULT '{}', media_json TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS assets (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('base','style')),
 category TEXT, account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
 name TEXT DEFAULT '', mime TEXT NOT NULL, filename TEXT NOT NULL,
 created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS drafts (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 text TEXT NOT NULL, image_style TEXT, image_prompt TEXT DEFAULT '', image_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
 status TEXT NOT NULL DEFAULT 'needs_review' CHECK(status IN ('needs_review','scheduled','publishing','posted','failed')),
 scheduled_at TEXT, posted_at TEXT, x_post_id TEXT, error TEXT, attempt_count INTEGER DEFAULT 0,
 created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, account_id TEXT, kind TEXT, status TEXT, detail TEXT DEFAULT '',
 created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS publish_locks (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
 draft_id TEXT NOT NULL, locked_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS drafts_due ON drafts(status,scheduled_at);
CREATE INDEX IF NOT EXISTS ref_posts_ref ON ref_posts(ref_id);
`);
if (!db.prepare('PRAGMA table_info(accounts)').all().some(c=>c.name==='auto_approve')) db.exec('ALTER TABLE accounts ADD COLUMN auto_approve INTEGER DEFAULT 0');
const draftColumns=()=>db.prepare('PRAGMA table_info(drafts)').all();
if (!draftColumns().some(c=>c.name==='image_prompt')) db.exec("ALTER TABLE drafts ADD COLUMN image_prompt TEXT DEFAULT ''");
if (!draftColumns().some(c=>c.name==='content_fingerprint')) db.exec("ALTER TABLE drafts ADD COLUMN content_fingerprint TEXT DEFAULT ''");
if (!draftColumns().some(c=>c.name==='queue_key')) db.exec('ALTER TABLE drafts ADD COLUMN queue_key TEXT');
if (!draftColumns().some(c=>c.name==='next_attempt_at')) db.exec('ALTER TABLE drafts ADD COLUMN next_attempt_at TEXT');
if (!draftColumns().some(c=>c.name==='last_attempt_at')) db.exec('ALTER TABLE drafts ADD COLUMN last_attempt_at TEXT');
if (!draftColumns().some(c=>c.name==='last_error_kind')) db.exec("ALTER TABLE drafts ADD COLUMN last_error_kind TEXT DEFAULT ''");
db.exec("CREATE INDEX IF NOT EXISTS drafts_retry_due ON drafts(status,scheduled_at,next_attempt_at); CREATE UNIQUE INDEX IF NOT EXISTS drafts_queue_key ON drafts(queue_key) WHERE queue_key IS NOT NULL; CREATE INDEX IF NOT EXISTS drafts_fingerprint ON drafts(account_id,content_fingerprint,status);");
export const uid=()=>crypto.randomUUID();
export const row=(sql,...args)=>db.prepare(sql).get(...args);
export const all=(sql,...args)=>db.prepare(sql).all(...args);
export const run=(sql,...args)=>db.prepare(sql).run(...args);
export const publicAccount=(a)=>a&&Object.fromEntries(Object.entries(a).filter(([k])=>k!=='session_cipher'));
