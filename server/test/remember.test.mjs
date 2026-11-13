import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 4300 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streaming-remember-'));
let server;

async function start() {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), RTC_PORT: String(44000 + Math.floor(Math.random() * 900)), ADMIN_PASSWORD: 'master-pass-1', MEDIASOUP_ANNOUNCED_IP: '127.0.0.1' },
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
}
const stop = () => new Promise((resolve) => { server.once('exit', resolve); server.kill(); });
const login = async (remember) => (await (await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: 'master-pass-1', remember }) })).json()).token;
const me = async (token) => (await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer ${token}` } })).status;

after(() => {
  server?.kill();
  setTimeout(() => fs.rmSync(dataDir, { recursive: true, force: true }), 500);
});

describe('remember me', () => {
  it('a remembered session survives a restart, a normal one does not, logout ends it for good', async () => {
    await start();
    const kept = await login(true);
    const lost = await login(false);
    const loggedOut = await login(true);
    assert.equal(await me(kept), 200);
    await fetch(`${BASE}/api/logout`, { method: 'POST', headers: { authorization: `Bearer ${loggedOut}` } });
    await stop();
    await start();
    assert.equal(await me(kept), 200, 'remembered');
    assert.equal(await me(lost), 401, 'not remembered');
    assert.equal(await me(loggedOut), 401, 'logged out');
  });
});
