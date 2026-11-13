// A database created by the first version ("guests", server-wide default limits) must upgrade without losing anything.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streaming-migration-'));
let server;

const V1_SCHEMA = `
CREATE TABLE guests (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, password TEXT,
  status TEXT NOT NULL DEFAULT 'pending', limits TEXT NOT NULL, referral_quota INTEGER NOT NULL DEFAULT 0,
  invited_by INTEGER REFERENCES guests(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, activated_at INTEGER, last_seen INTEGER);
CREATE TABLE keys (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE, hint TEXT NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, used_at INTEGER, used_by INTEGER REFERENCES guests(id) ON DELETE SET NULL, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE rooms (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  owner_id INTEGER REFERENCES guests(id) ON DELETE CASCADE, visibility TEXT NOT NULL, secret TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE usage (guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE, month TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guest_id, month));
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 1;
`;

before(async () => {
  const db = new DatabaseSync(path.join(dataDir, 'streaming.db'));
  db.exec(V1_SCHEMA);
  const limits = { maxRooms: 9, maxStreams: 2, maxBitrateMbps: 3, maxHeight: 720, maxFps: 30, maxViewersPerRoom: 10, maxStreamMinutes: 120, allowPublicRooms: true, allowAudio: true, monthlyGb: 0 };
  db.prepare("INSERT INTO guests (name, status, limits, referral_quota, created_at) VALUES ('old-user', 'pending', ?, 3, ?)").run(JSON.stringify(limits), Date.now());
  db.prepare("INSERT INTO rooms (id, slug, name, owner_id, visibility, secret, created_at) VALUES ('r1', 'old-room-abcd', 'Old room', 1, 'private', 's', ?)").run(Date.now());
  db.prepare("INSERT INTO usage (guest_id, month, bytes) VALUES (1, '2026-01', 12345)").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('global', ?)").run(
    JSON.stringify({ egressBudgetMbps: 321, guestStreamsPaused: true, defaultLimits: { ...limits, maxBitrateMbps: 7 } }),
  );
  db.close();

  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), RTC_PORT: String(43000 + Math.floor(Math.random() * 900)), ADMIN_PASSWORD: 'master-pass-1', MEDIASOUP_ANNOUNCED_IP: '127.0.0.1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill();
  setTimeout(() => fs.rmSync(dataDir, { recursive: true, force: true }), 500);
});

describe('upgrade from the first version', () => {
  let token;
  const get = async (url) => (await fetch(BASE + url, { headers: { authorization: `Bearer ${token}` } })).json();

  it('keeps users, rooms and settings; old default limits become the default preset', async () => {
    token = (await (await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: 'master-pass-1' }) })).json()).token;
    assert.ok(token);

    const { users } = await get('/api/admin/users');
    assert.equal(users.length, 1);
    assert.equal(users[0].name, 'old-user');
    assert.equal(users[0].limits.maxRooms, 9, 'the old user keeps their own limits');
    assert.equal(users[0].presetId, null, 'as custom limits');
    assert.equal(users[0].referralQuota, 3);

    const { presets } = await get('/api/admin/presets');
    assert.equal(presets.length, 1);
    assert.equal(presets[0].name, 'Default');
    assert.equal(presets[0].isDefault, true);
    assert.equal(presets[0].limits.maxBitrateMbps, 7, 'the old default limits were kept');

    const { settings } = await get('/api/admin/settings');
    assert.equal(settings.egressBudgetMbps, 321);
    assert.equal(settings.userStreamsPaused, true, 'renamed setting carried over');
    assert.equal(settings.defaultLimits, undefined);

    const { rooms } = await get('/api/rooms');
    const room = rooms.find((r) => r.slug === 'old-room-abcd');
    assert.equal(room.ownerName, 'old-user');
  });
});
