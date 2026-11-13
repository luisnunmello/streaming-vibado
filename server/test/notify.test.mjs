import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 4800 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streaming-notify-'));
const received = [];
const hook = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({ headers: req.headers, body });
    res.end('ok');
  });
});
await new Promise((r) => hook.listen(0, '127.0.0.1', r));
let server;

after(() => {
  server?.kill();
  hook.close();
  setTimeout(() => fs.rmSync(dataDir, { recursive: true, force: true }), 500);
});

const api = async (method, url, token, body) => {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};

describe('admin notifications', () => {
  it('sends a webhook message when a restricted user appeals', async () => {
    server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), RTC_PORT: String(45000 + Math.floor(Math.random() * 900)), ADMIN_PASSWORD: 'master-pass-1', MEDIASOUP_ANNOUNCED_IP: '127.0.0.1', NOTIFY_WEBHOOK_URL: `http://127.0.0.1:${hook.address().port}/topic` },
      stdio: 'ignore',
    });
    for (let i = 0; i < 160; i++) {
      try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    const admin = (await api('POST', '/api/login', null, { name: 'admin', password: 'master-pass-1' })).token;
    const u = await api('POST', '/api/admin/users', admin, { name: 'notifyme' });
    const a = await api('POST', '/api/activate', null, { key: u.key, password: 'notifyme-pass-1' });
    await api('POST', `/api/admin/users/${u.user.id}/restrict`, admin, { reason: 'testing' });
    assert.equal((await api('POST', '/api/me/appeal', a.token, { text: 'Please lift this, it was a mistake.' })).status, 200);
    for (let i = 0; i < 20 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(received.length, 1);
    assert.match(received[0].body, /New appeal from notifyme/);
    assert.match(received[0].body, /it was a mistake/);
  });
});
