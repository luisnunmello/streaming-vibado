import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { config } from './config.js';

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
