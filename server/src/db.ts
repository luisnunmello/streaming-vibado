import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { config } from './config.js';
import { FALLBACK_LIMITS } from './limits.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'streaming.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

const SCHEMA_V1 = `
CREATE TABLE guests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password       TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','disabled')),
  limits         TEXT NOT NULL,
  referral_quota INTEGER NOT NULL DEFAULT 0,
  invited_by     INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL,
  activated_at   INTEGER,
  last_seen      INTEGER
);
CREATE TABLE keys (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  hash       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('activation','referral')),
  guest_id   INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  hint       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  used_by    INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE rooms (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  owner_id   INTEGER REFERENCES guests(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL CHECK (visibility IN ('public','private')),
  secret     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE usage (
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  month    TEXT NOT NULL,
  bytes    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guest_id, month)
);
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
if (version < 1) {
  db.exec('BEGIN');
  try {
    db.exec(SCHEMA_V1);
    db.exec('PRAGMA user_version = 1');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * v2: "guests" become "users", and limit presets are introduced.
 * The old server-wide "default limits" setting becomes the first (default) preset.
 */
if (version < 2) {
  db.exec('BEGIN');
  try {
    db.exec(`
      ALTER TABLE guests RENAME TO users;
      ALTER TABLE keys RENAME COLUMN guest_id TO user_id;
      ALTER TABLE usage RENAME COLUMN guest_id TO user_id;
      CREATE TABLE presets (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        limits     TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      ALTER TABLE users ADD COLUMN preset_id INTEGER REFERENCES presets(id) ON DELETE SET NULL;
    `);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'global'").get() as { value: string } | undefined;
    let stored: Record<string, unknown> = {};
    try {
      stored = row ? JSON.parse(row.value) : {};
    } catch {
      /* ignore a corrupt value */
    }
    const defaultLimits = { ...FALLBACK_LIMITS, ...((stored['defaultLimits'] as object | undefined) ?? {}) };
    db.prepare("INSERT INTO presets (name, limits, is_default, created_at) VALUES ('Default', ?, 1, ?)").run(JSON.stringify(defaultLimits), Date.now());
    if ('guestStreamsPaused' in stored) stored['userStreamsPaused'] = stored['guestStreamsPaused'];
    delete stored['guestStreamsPaused'];
    delete stored['defaultLimits'];
    if (row) db.prepare("UPDATE settings SET value = ? WHERE key = 'global'").run(JSON.stringify(stored));
    db.exec('PRAGMA user_version = 2');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

if (version < 3) {
  // "Remember me" sessions survive restarts; only a hash of the token is stored.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      user_id INTEGER,
      expires_at INTEGER NOT NULL
    );
    PRAGMA user_version = 3;
  `);
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]): { changes: number; id: number } {
  const r = db.prepare(sql).run(...params);
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const currentMonth = (): string => new Date().toISOString().slice(0, 7);
