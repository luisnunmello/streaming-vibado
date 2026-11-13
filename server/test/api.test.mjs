// End-to-end tests for accounts, keys, referrals, limits and rooms.
// Starts the real server against a temporary data directory. Run: npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const PORT = 3400 + Math.floor(Math.random() * 400);
const RTC_PORT = 42000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streaming-test-'));
let server;

async function api(method, url, { token, body } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

const login = async (name, password) => (await api('POST', '/api/login', { body: { name, password } })).token;

/** Connects a socket and joins a room; resolves with the join reply. */
async function join(slug, { token, key } = {}) {
  const socket = io(BASE, { auth: token ? { token } : {}, transports: ['websocket'], forceNew: true });
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  const reply = await socket.timeout(5000).emitWithAck('joinRoom', { slug, key });
  return { socket, reply };
}

before(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), RTC_PORT: String(RTC_PORT), ADMIN_PASSWORD: 'master-pass-1', MEDIASOUP_ANNOUNCED_IP: '127.0.0.1' },
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

describe('accounts, referrals and rooms', () => {
  let admin;
  let alice;
  let aliceKey;
  let bob;
  const state = {};

  it('admin signs in; wrong password is rejected', async () => {
    assert.equal((await api('POST', '/api/login', { body: { name: 'admin', password: 'nope' } })).status, 401);
    admin = await login('admin', 'master-pass-1');
    assert.ok(admin);
    assert.equal((await api('GET', '/api/me', { token: admin })).role, 'admin');
  });

  it('only admins can use the guest endpoints', async () => {
    assert.equal((await api('GET', '/api/admin/guests')).status, 401);
    const created = await api('POST', '/api/admin/guests', { token: admin, body: { name: 'tmp', referralQuota: 0 } });
    assert.equal(created.status, 201);
    const tmpKey = created.key;
    const tmp = await api('POST', '/api/activate', { body: { key: tmpKey, password: 'tmp-password-1' } });
    assert.equal((await api('GET', '/api/admin/guests', { token: tmp.token })).status, 403);
    await api('DELETE', `/api/admin/guests/${created.guest.id}`, { token: admin });
  });

  it('creates a guest with limits and a random activation key', async () => {
    const r = await api('POST', '/api/admin/guests', {
      token: admin,
      body: { name: 'alice', referralQuota: 2, limits: { maxRooms: 2, maxBitrateMbps: 2, maxViewersPerRoom: 1 } },
    });
    assert.equal(r.status, 201);
    assert.match(r.key, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
    assert.equal(r.guest.status, 'pending');
    assert.equal(r.guest.limits.maxRooms, 2);
    alice = r.guest;
    aliceKey = r.key;
    // names are unique (case-insensitive), "admin" is reserved, limits are validated
    assert.equal((await api('POST', '/api/admin/guests', { token: admin, body: { name: 'ALICE' } })).status, 409);
    assert.equal((await api('POST', '/api/admin/guests', { token: admin, body: { name: 'admin2' } })).status, 400);
    assert.equal((await api('POST', '/api/admin/guests', { token: admin, body: { name: 'carl', limits: { maxFps: 9999 } } })).status, 400);
  });

  it('a pending guest cannot sign in; the key activates the account with a password they choose', async () => {
    assert.equal((await api('POST', '/api/login', { body: { name: 'alice', password: 'anything-1' } })).status, 401);
    const check = await api('GET', `/api/activate/check?key=${aliceKey}`);
    assert.deepEqual([check.kind, check.name], ['activation', 'alice']);
    assert.equal((await api('POST', '/api/activate', { body: { key: aliceKey, password: 'short' } })).status, 400);
    const act = await api('POST', '/api/activate', { body: { key: aliceKey.toLowerCase(), password: 'alice-password-1' } });
    assert.equal(act.status, 200);
    assert.ok(act.token);
    // single use
    assert.equal((await api('POST', '/api/activate', { body: { key: aliceKey, password: 'other-password-1' } })).status, 404);
    assert.equal((await api('POST', '/api/login', { body: { name: 'alice', password: 'wrong-password' } })).status, 401);
    state.aliceToken = await login('alice', 'alice-password-1');
    assert.ok(state.aliceToken);
    const me = await api('GET', '/api/me', { token: state.aliceToken });
    assert.equal(me.limits.maxBitrateMbps, 2);
    assert.deepEqual(me.referrals, { quota: 2, used: 0 });
  });

  it('enforces the room limit and public-room permission', async () => {
    const t = state.aliceToken;
    const a = await api('POST', '/api/rooms', { token: t, body: { name: 'Alice Games', visibility: 'public' } });
    const b = await api('POST', '/api/rooms', { token: t, body: { name: 'Secret Club', visibility: 'private' } });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.match(a.room.slug, /^alice-games-[0-9a-f]{4}$/);
    assert.equal(a.room.link, `/r/${a.room.slug}`);
    assert.match(b.room.link, new RegExp(`^/r/${b.room.slug}\\?key=.+`));
    assert.equal((await api('POST', '/api/rooms', { token: t, body: { name: 'Third', visibility: 'public' } })).status, 403);
    state.pub = a.room;
    state.priv = b.room;
    // guests only see their own rooms; admin sees all
    assert.equal((await api('GET', '/api/rooms', { token: t })).rooms.length, 2);
    assert.ok((await api('GET', '/api/rooms', { token: admin })).rooms.length >= 3);
  });

  it('lists only public rooms in the lobby and hides private ones without the key', async () => {
    const lobby = await api('GET', '/api/lobbies');
    const slugs = lobby.rooms.map((r) => r.slug);
    assert.ok(slugs.includes('main'));
    assert.ok(slugs.includes(state.pub.slug));
    assert.ok(!slugs.includes(state.priv.slug));
    assert.equal((await api('GET', `/api/rooms/${state.priv.slug}/info`)).status, 404);
    assert.equal((await api('GET', `/api/rooms/${state.priv.slug}/info?key=wrong`)).status, 404);
    const secret = state.priv.link.split('key=')[1];
    assert.equal((await api('GET', `/api/rooms/${state.priv.slug}/info?key=${secret}`)).status, 200);
    state.secret = secret;
  });

  it('referrals: quota, single use, no referrals for invited guests, limits never exceed the inviter', async () => {
    const t = state.aliceToken;
    const k1 = await api('POST', '/api/me/referrals', { token: t });
    const k2 = await api('POST', '/api/me/referrals', { token: t });
    assert.equal(k1.status, 200);
    assert.equal((await api('POST', '/api/me/referrals', { token: t })).status, 403, 'quota of 2 reached');
    // revoking an unused key frees its slot
    const list = await api('GET', '/api/me/referrals', { token: t });
    assert.equal(list.used, 2);
    const unused = list.keys.find((k) => k.status === 'unused');
    assert.equal((await api('DELETE', `/api/me/referrals/${unused.id}`, { token: t })).status, 200);
    const k3 = await api('POST', '/api/me/referrals', { token: t });
    assert.equal(k3.status, 200);

    // the revoked key no longer works; a valid one needs a name
    const revoked = [k1, k2].find((k) => list.keys.find((x) => x.id === unused.id)?.hint === k.key.replace(/-/g, '').slice(-4));
    if (revoked) assert.equal((await api('GET', `/api/activate/check?key=${revoked.key}`)).status, 404);
    assert.equal((await api('GET', `/api/activate/check?key=${k3.key}`)).kind, 'referral');
    assert.equal((await api('POST', '/api/activate', { body: { key: k3.key, password: 'bob-password-1' } })).status, 400, 'name required');
    const act = await api('POST', '/api/activate', { body: { key: k3.key, password: 'bob-password-1', name: 'bob' } });
    assert.equal(act.status, 200);
    bob = act;
    assert.equal((await api('POST', '/api/activate', { body: { key: k3.key, password: 'bob-password-1', name: 'bob2' } })).status, 404);

    const me = await api('GET', '/api/me', { token: bob.token });
    assert.equal(me.invitedByName, 'alice');
    assert.ok(me.limits.maxBitrateMbps <= 2, 'clamped to the inviter');
    assert.ok(me.limits.maxViewersPerRoom <= 1);
    assert.deepEqual(me.referrals, { quota: 0, used: 0 });
    assert.equal((await api('POST', '/api/me/referrals', { token: bob.token })).status, 403);
  });

  it('admin can edit limits and the referral quota of a guest', async () => {
    const r = await api('PATCH', `/api/admin/guests/${alice.id}`, { token: admin, body: { referralQuota: 5, limits: { maxViewersPerRoom: 2 } } });
    assert.equal(r.guest.referralQuota, 5);
    assert.equal(r.guest.limits.maxViewersPerRoom, 2);
    assert.equal(r.guest.limits.maxRooms, 2, 'other limits untouched');
    assert.equal((await api('PATCH', `/api/admin/guests/${alice.id}`, { token: admin, body: { limits: { maxRooms: -1 } } })).status, 400);
  });

  it('sockets: private rooms need the key, viewer cap applies, owner is recognised', async () => {
    const open = [];
    try {
      const main = await join('main');
      open.push(main.socket);
      assert.equal(main.reply.ok, true);
      assert.equal(main.reply.role, 'viewer');

      const noKey = await join(state.priv.slug);
      open.push(noKey.socket);
      assert.equal(noKey.reply.ok, false);
      const withKey = await join(state.priv.slug, { key: state.secret });
      open.push(withKey.socket);
      assert.equal(withKey.reply.ok, true);

      // alice allows 2 viewers per room (edited above): third is refused
      const v1 = await join(state.pub.slug);
      const v2 = await join(state.pub.slug);
      const v3 = await join(state.pub.slug);
      open.push(v1.socket, v2.socket, v3.socket);
      assert.equal(v1.reply.ok && v2.reply.ok, true);
      assert.equal(v3.reply.ok, false);
      assert.match(v3.reply.error, /full/i);

      const owner = await join(state.pub.slug, { token: state.aliceToken });
      open.push(owner.socket);
      assert.equal(owner.reply.role, 'owner');
      assert.equal(owner.reply.limits.maxBitrateMbps, 2);
      // bob is not the owner of alice's room
      const notOwner = await join(state.pub.slug, { token: bob.token });
      open.push(notOwner.socket);
      assert.equal(notOwner.reply.role ?? 'viewer', 'viewer');
      // viewers cannot create send transports
      const t = await v1.socket.timeout(5000).emitWithAck('createTransport', { direction: 'send' });
      assert.equal(t.ok, false);
    } finally {
      open.forEach((s) => s.close());
    }
  });

  it('per-IP connection cap is enforced', async () => {
    assert.equal((await api('PUT', '/api/admin/settings', { token: admin, body: { maxConnectionsPerIp: 2 } })).settings.maxConnectionsPerIp, 2);
    const open = [];
    try {
      const a = await join('main');
      const b = await join('main');
      const c = await join('main');
      open.push(a.socket, b.socket, c.socket);
      assert.equal(a.reply.ok && b.reply.ok, true);
      assert.equal(c.reply.ok, false);
    } finally {
      open.forEach((s) => s.close());
      await api('PUT', '/api/admin/settings', { token: admin, body: { maxConnectionsPerIp: 4 } });
    }
  });

  it('changing a room link or visibility is reflected for viewers', async () => {
    const watcher = await join(state.priv.slug, { key: state.secret });
    const kicked = new Promise((resolve) => watcher.socket.on('kicked', resolve));
    const r = await api('PATCH', `/api/rooms/${state.priv.id}`, { token: state.aliceToken, body: { regenerateSecret: true } });
    assert.equal(r.status, 200);
    assert.notEqual(r.room.link.split('key=')[1], state.secret);
    await kicked;
    assert.equal((await api('GET', `/api/rooms/${state.priv.slug}/info?key=${state.secret}`)).status, 404, 'old link is dead');
    watcher.socket.close();
    // only owner/admin may edit
    assert.equal((await api('PATCH', `/api/rooms/${state.priv.id}`, { token: bob.token, body: { name: 'hax' } })).status, 404);
    // the main room cannot be deleted or made private
    const main = (await api('GET', '/api/rooms', { token: admin })).rooms.find((r) => r.slug === 'main');
    assert.equal((await api('DELETE', `/api/rooms/${main.id}`, { token: admin })).status, 400);
    assert.equal((await api('PATCH', `/api/rooms/${main.id}`, { token: admin, body: { visibility: 'private' } })).status, 400);
  });

  it('password changes sign other sessions out', async () => {
    const second = await login('admin', 'master-pass-1');
    assert.equal((await api('PUT', '/api/me/password', { token: admin, body: { currentPassword: 'wrong', newPassword: 'new-master-pass-1' } })).status, 403);
    assert.equal((await api('PUT', '/api/me/password', { token: admin, body: { currentPassword: 'master-pass-1', newPassword: 'new-master-pass-1' } })).status, 200);
    assert.equal((await api('GET', '/api/me', { token: second })).status, 401, 'other session revoked');
    assert.equal((await api('GET', '/api/me', { token: admin })).status, 200, 'this session stays');
    assert.equal((await api('POST', '/api/login', { body: { name: 'admin', password: 'master-pass-1' } })).status, 401);
    assert.ok(await login('admin', 'new-master-pass-1'));
  });

  it('disabling a guest (with cascade) ends sessions and hides their rooms', async () => {
    const r = await api('PATCH', `/api/admin/guests/${alice.id}`, { token: admin, body: { status: 'disabled', cascade: true } });
    assert.equal(r.guest.status, 'disabled');
    assert.equal((await api('GET', '/api/me', { token: state.aliceToken })).status, 401);
    assert.equal((await api('GET', '/api/me', { token: bob.token })).status, 401, 'invited guest disabled too');
    assert.equal((await api('POST', '/api/login', { body: { name: 'alice', password: 'alice-password-1' } })).status, 401);
    const slugs = (await api('GET', '/api/lobbies')).rooms.map((x) => x.slug);
    assert.ok(!slugs.includes(state.pub.slug));
    assert.equal((await api('GET', `/api/rooms/${state.pub.slug}/info`)).status, 404);
  });

  it('re-enabling plus a reissued key resets a forgotten password', async () => {
    await api('PATCH', `/api/admin/guests/${alice.id}`, { token: admin, body: { status: 'active' } });
    const k = await api('POST', `/api/admin/guests/${alice.id}/key`, { token: admin });
    assert.equal((await api('POST', '/api/activate', { body: { key: k.key, password: 'alice-new-password' } })).status, 200);
    assert.ok(await login('alice', 'alice-new-password'));
    assert.equal(await login('alice', 'alice-password-1'), undefined);
  });

  it('deleting a guest removes their rooms', async () => {
    assert.equal((await api('DELETE', `/api/admin/guests/${alice.id}`, { token: admin })).status, 200);
    const slugs = (await api('GET', '/api/rooms', { token: admin })).rooms.map((x) => x.slug);
    assert.ok(!slugs.includes(state.pub.slug));
  });

  it('admin settings are validated and persisted', async () => {
    const bad = await api('PUT', '/api/admin/settings', { token: admin, body: { adminReservePct: 99 } });
    assert.equal(bad.status, 400);
    const ok = await api('PUT', '/api/admin/settings', { token: admin, body: { egressBudgetMbps: 400, defaultLimits: { maxBitrateMbps: 4 } } });
    assert.equal(ok.settings.egressBudgetMbps, 400);
    assert.equal(ok.settings.defaultLimits.maxBitrateMbps, 4);
    assert.equal((await api('GET', '/api/admin/settings', { token: admin })).settings.egressBudgetMbps, 400);
    const bw = await api('GET', '/api/admin/bandwidth', { token: admin });
    assert.equal(bw.budget.egressMbps, 400);
  });
});
