import { autoRoomName } from './rooms.js';
import { all, currentMonth, get, run, tx } from './db.js';
import { HttpError } from './errors.js';
import { hashKey, keyHint, newKey, normalizeKey } from './keys.js';
import { clampToParent, parseStoredLimits, sanitizeLimits, type Limits } from './limits.js';
import { checkNewPassword, hashPassword, verifyStoredPassword } from './password.js';
import { defaultPreset, getPreset } from './presets.js';

const DAY = 24 * 60 * 60 * 1000;
const ACTIVATION_TTL = 7 * DAY;
const REFERRAL_TTL = 14 * DAY;

export type UserStatus = 'pending' | 'active' | 'disabled';

export interface User {
  id: number;
  name: string;
  status: UserStatus;
  /** What the user may do right now: their preset (or custom limits), never above the inviter's. */
  limits: Limits;
  /** The preset the user follows, or null for custom limits. */
  presetId: number | null;
  presetName: string | null;
  referralQuota: number;
  invitedBy: number | null;
  createdAt: number;
  activatedAt: number | null;
  lastSeen: number | null;
  /** Can sign in, but may not use the service; `restrictedReason` is shown to them. */
  restricted: boolean;
  restrictedReason: string;
  /** The user whose restriction caused this one (null when restricted directly). */
  restrictedBy: number | null;
  /** '' = no appeal, 'pending' = waiting for the admin, 'denied' = the admin said no (see appealReply). */
  appealStatus: '' | 'pending' | 'denied';
  appealText: string;
  appealAt: number | null;
  appealReply: string;
}

interface UserRow {
  id: number;
  name: string;
  password: string | null;
  status: UserStatus;
  limits: string;
  preset_id: number | null;
  referral_quota: number;
  invited_by: number | null;
  created_at: number;
  activated_at: number | null;
  last_seen: number | null;
  restricted: number;
  restricted_reason: string;
  restricted_by: number | null;
  appeal_text: string;
  appeal_at: number | null;
  appeal_status: '' | 'pending' | 'denied';
  appeal_reply: string;
}

interface KeyRow {
  id: number;
  hash: string;
  kind: 'activation' | 'referral';
  user_id: number;
  hint: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  used_by: number | null;
  revoked: number;
}

/** Limits before the inviter's ceiling is applied: the linked preset, or the user's own custom values. */
function baseLimitsOf(r: UserRow): { limits: Limits; presetName: string | null } {
  if (r.preset_id) {
    const p = getPreset(r.preset_id);
    if (p) return { limits: p.limits, presetName: p.name };
  }
  return { limits: parseStoredLimits(r.limits), presetName: null };
}

const toUser = (r: UserRow): User => {
  const base = baseLimitsOf(r);
  let limits = base.limits;
  if (r.invited_by) {
    // Invited users never get more than the user who invited them (inviters are never invited themselves).
    const inviter = get<UserRow>('SELECT * FROM users WHERE id = ?', r.invited_by);
    if (inviter) limits = clampToParent(limits, baseLimitsOf(inviter).limits);
  }
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    limits,
    presetId: base.presetName ? r.preset_id : null,
    presetName: base.presetName,
    referralQuota: r.referral_quota,
    invitedBy: r.invited_by,
    createdAt: r.created_at,
    activatedAt: r.activated_at,
    lastSeen: r.last_seen,
    restricted: r.restricted === 1,
    restrictedReason: r.restricted_reason,
    restrictedBy: r.restricted_by,
    appealStatus: r.appeal_status,
    appealText: r.appeal_text,
    appealAt: r.appeal_at,
    appealReply: r.appeal_reply,
  };
};

export const getUser = (id: number): User | undefined => {
  const r = get<UserRow>('SELECT * FROM users WHERE id = ?', id);
  return r && toUser(r);
};

export const listUsers = (): User[] => all<UserRow>('SELECT * FROM users ORDER BY created_at DESC').map(toUser);

export function validateName(name: unknown): string {
  if (typeof name !== 'string') throw new HttpError(400, 'A name is required');
  const n = name.trim();
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(n)) {
    throw new HttpError(400, 'The name must have 3 to 24 letters, digits, "_" or "-"');
  }
  if (/^admin/i.test(n)) throw new HttpError(400, 'That name is reserved');
  return n;
}

/** True when the user may use the service (active and not restricted). */
export const canUse = (u: User | undefined | null): boolean => !!u && u.status === 'active' && !u.restricted;

export function setRestriction(id: number, restricted: boolean, reason = '', causedBy: number | null = null): void {
  // a new restriction starts without an appeal; lifting one closes any appeal
  run(
    "UPDATE users SET restricted = ?, restricted_reason = ?, restricted_by = ?, appeal_status = '', appeal_text = '', appeal_at = NULL, appeal_reply = '' WHERE id = ?",
    restricted ? 1 : 0,
    restricted ? reason : '',
    restricted ? causedBy : null,
    id,
  );
}

export function submitAppeal(id: number, textInput: unknown): void {
  const text = typeof textInput === 'string' ? textInput.trim() : '';
  if (text.length < 5) throw new HttpError(400, 'Please explain why the restriction should be lifted (at least a few words)');
  if (text.length > 1000) throw new HttpError(400, 'The appeal is too long (1000 characters at most)');
  const u = getUser(id);
  if (!u?.restricted) throw new HttpError(400, 'Your account is not restricted');
  if (u.appealStatus === 'pending') throw new HttpError(409, 'Your appeal is already waiting for the administrator');
  run("UPDATE users SET appeal_status = 'pending', appeal_text = ?, appeal_at = ?, appeal_reply = '' WHERE id = ?", text, Date.now(), id);
}

export function denyAppeal(id: number, replyInput: unknown): void {
  const u = getUser(id);
  if (!u || u.appealStatus !== 'pending') throw new HttpError(400, 'There is no pending appeal');
  const reply = typeof replyInput === 'string' ? replyInput.trim().slice(0, 500) : '';
  run("UPDATE users SET appeal_status = 'denied', appeal_reply = ? WHERE id = ?", reply, id);
}

export const countPendingAppeals = (): number => get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE appeal_status = 'pending'")?.n ?? 0;

/** A user changes their own name (it is also the name they sign in with). */
export function renameUser(id: number, nameInput: unknown): User {
  const name = validateName(nameInput);
  const taken = get<{ id: number }>('SELECT id FROM users WHERE name = ?', name);
  if (taken && taken.id !== id) throw new HttpError(409, 'That name is already taken');
  const old = get<{ name: string }>('SELECT name FROM users WHERE id = ?', id)?.name;
  run('UPDATE users SET name = ? WHERE id = ?', name, id);
  // a room named after its owner follows the new name
  if (old && old !== name) run('UPDATE rooms SET name = ? WHERE owner_id = ? AND name = ?', autoRoomName(name), id, autoRoomName(old));
  return getUser(id)!;
}

function ensureNameFree(name: string): void {
  if (get('SELECT 1 FROM users WHERE name = ?', name)) throw new HttpError(409, 'That name is already taken');
}

function insertKey(kind: 'activation' | 'referral', userId: number, ttl: number): { key: string; expiresAt: number } {
  const key = newKey();
  const now = Date.now();
  const expiresAt = now + ttl;
  run(
    'INSERT INTO keys (hash, kind, user_id, hint, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    hashKey(key),
    kind,
    userId,
    keyHint(key),
    now,
    expiresAt,
  );
  return { key, expiresAt };
}

// ---------------------------------------------------------------- admin: create / edit

/** New user. They follow `presetId` (default preset if omitted), unless custom `limits` are given. */
export function createUser(nameInput: unknown, referralQuota: unknown, opts: { presetId?: unknown; limits?: unknown } = {}) {
  const name = validateName(nameInput);
  const quota = Number(referralQuota ?? 0);
  if (!Number.isInteger(quota) || quota < 0 || quota > 1000) throw new HttpError(400, 'referralQuota must be a whole number from 0 to 1000');
  let presetId: number | null = null;
  let limits: Limits;
  if (opts.limits !== undefined && opts.limits !== null) {
    limits = sanitizeLimits(opts.limits, defaultPreset().limits);
  } else {
    const preset = opts.presetId === undefined || opts.presetId === null ? defaultPreset() : getPreset(Number(opts.presetId));
    if (!preset) throw new HttpError(404, 'Preset not found');
    presetId = preset.id;
    limits = preset.limits;
  }
  return tx(() => {
    ensureNameFree(name);
    const { id } = run(
      "INSERT INTO users (name, status, limits, preset_id, referral_quota, created_at) VALUES (?, 'pending', ?, ?, ?, ?)",
      name,
      JSON.stringify(limits),
      presetId,
      quota,
      Date.now(),
    );
    const { key, expiresAt } = insertKey('activation', id, ACTIVATION_TTL);
    return { user: getUser(id)!, key, expiresAt };
  });
}

/** New activation key for a user: used for first activation and for password resets. */
export function reissueActivationKey(userId: number) {
  const user = getUser(userId);
  if (!user) throw new HttpError(404, 'User not found');
  if (user.status === 'disabled') throw new HttpError(409, 'Enable the user first');
  return tx(() => {
    run("UPDATE keys SET revoked = 1 WHERE user_id = ? AND kind = 'activation' AND used_at IS NULL", userId);
    return insertKey('activation', userId, ACTIVATION_TTL);
  });
}

export function updateUser(id: number, patch: Record<string, unknown>): User {
  const user = getUser(id);
  if (!user) throw new HttpError(404, 'User not found');
  let { limits, referralQuota, status, presetId } = user;
  if (patch['presetId'] !== undefined) {
    if (patch['presetId'] === null) {
      presetId = null; // stop following the preset; keep today's limits as custom values
    } else {
      const preset = getPreset(Number(patch['presetId']));
      if (!preset) throw new HttpError(404, 'Preset not found');
      presetId = preset.id;
      limits = preset.limits;
    }
  }
  if (patch['limits'] !== undefined) {
    limits = sanitizeLimits(patch['limits'], limits);
    presetId = null; // editing limits by hand makes them custom
  }
  if (patch['referralQuota'] !== undefined) {
    const q = Number(patch['referralQuota']);
    if (!Number.isInteger(q) || q < 0 || q > 1000) throw new HttpError(400, 'referralQuota must be a whole number from 0 to 1000');
    referralQuota = q;
  }
  if (patch['status'] !== undefined) {
    if (patch['status'] !== 'active' && patch['status'] !== 'disabled') throw new HttpError(400, 'status must be "active" or "disabled"');
    if (user.status === 'pending') throw new HttpError(409, 'The user has not activated the account yet');
    status = patch['status'];
  }
  run('UPDATE users SET limits = ?, preset_id = ?, referral_quota = ?, status = ? WHERE id = ?', JSON.stringify(limits), presetId, referralQuota, status, id);
  return getUser(id)!;
}

/** Users invited (directly) by `id`. */
export const invitedBy = (id: number): number[] => all<{ id: number }>('SELECT id FROM users WHERE invited_by = ?', id).map((r) => r.id);

/** The given users plus the users they invited: an inviter's limits cap theirs. */
export function withInvitees(ids: number[]): number[] {
  return [...new Set([...ids, ...ids.flatMap(invitedBy)])];
}

export function deleteUser(id: number): void {
  if (!run('DELETE FROM users WHERE id = ?', id).changes) throw new HttpError(404, 'User not found');
}

export function setPassword(userId: number, password: unknown): void {
  run('UPDATE users SET password = ? WHERE id = ?', hashPassword(checkNewPassword(password)), userId);
}

// ---------------------------------------------------------------- activation

const keyUsable = (k: KeyRow | undefined): k is KeyRow => !!k && !k.used_at && !k.revoked && k.expires_at > Date.now();

function findKey(key: unknown): KeyRow | undefined {
  if (typeof key !== 'string' || normalizeKey(key).length !== 16) return undefined;
  return get<KeyRow>('SELECT * FROM keys WHERE hash = ?', hashKey(key));
}

/** What a key is for, without using it. Lets the activation page ask for the right fields. */
export function inspectKey(key: unknown): { kind: 'activation' | 'referral'; name?: string } {
  const k = findKey(key);
  if (!keyUsable(k)) throw new HttpError(404, 'This key is invalid, expired or already used');
  const owner = getUser(k.user_id);
  if (!owner || owner.status === 'disabled') throw new HttpError(404, 'This key is invalid, expired or already used');
  return k.kind === 'activation' ? { kind: 'activation', name: owner.name } : { kind: 'referral' };
}

export function activate(key: unknown, passwordInput: unknown, nameInput?: unknown): User {
  const password = checkNewPassword(passwordInput);
  const k = findKey(key);
  if (!keyUsable(k)) throw new HttpError(404, 'This key is invalid, expired or already used');
  const owner = getUser(k.user_id);
  if (!owner || owner.status === 'disabled') throw new HttpError(404, 'This key is invalid, expired or already used');

  return tx(() => {
    const now = Date.now();
    if (k.kind === 'activation') {
      run("UPDATE users SET password = ?, status = 'active', activated_at = COALESCE(activated_at, ?) WHERE id = ?", hashPassword(password), now, owner.id);
      run('UPDATE keys SET used_at = ?, used_by = ? WHERE id = ?', now, owner.id, k.id);
      return getUser(owner.id)!;
    }
    // referral: the inviter must still be allowed to invite
    if (owner.status !== 'active') throw new HttpError(404, 'This key is invalid, expired or already used');
    const name = validateName(nameInput);
    ensureNameFree(name);
    const preset = defaultPreset();
    const limits = clampToParent(preset.limits, owner.limits);
    // Invited users get no referrals of their own.
    const { id } = run(
      "INSERT INTO users (name, password, status, limits, preset_id, referral_quota, invited_by, created_at, activated_at) VALUES (?, ?, 'active', ?, ?, 0, ?, ?, ?)",
      name,
      hashPassword(password),
      JSON.stringify(limits),
      preset.id,
      owner.id,
      now,
      now,
    );
    run('UPDATE keys SET used_at = ?, used_by = ? WHERE id = ?', now, id, k.id);
    return getUser(id)!;
  });
}

/** Returns the user when name + password are right and the account is active. */
export function authenticate(name: unknown, password: unknown): User | null {
  const row = typeof name === 'string' ? get<UserRow>('SELECT * FROM users WHERE name = ?', name.trim()) : undefined;
  const ok = verifyStoredPassword(typeof password === 'string' ? password : '', row?.password);
  if (!row || !ok || row.status !== 'active') return null;
  run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), row.id);
  return toUser(row);
}

export function changeOwnPassword(userId: number, current: unknown, next: unknown): void {
  const row = get<UserRow>('SELECT * FROM users WHERE id = ?', userId);
  if (!row || !verifyStoredPassword(typeof current === 'string' ? current : '', row.password)) {
    throw new HttpError(403, 'Current password is wrong');
  }
  setPassword(userId, next);
}

// ---------------------------------------------------------------- referrals

export interface ReferralInfo {
  id: number;
  hint: string;
  status: 'unused' | 'used' | 'expired' | 'revoked';
  createdAt: number;
  expiresAt: number;
  usedBy: string | null;
}

export function listReferrals(userId: number): ReferralInfo[] {
  const rows = all<KeyRow & { used_by_name: string | null }>(
    `SELECT k.*, g.name AS used_by_name FROM keys k LEFT JOIN users g ON g.id = k.used_by
     WHERE k.kind = 'referral' AND k.user_id = ? ORDER BY k.created_at DESC`,
    userId,
  );
  return rows.map((k) => ({
    id: k.id,
    hint: k.hint,
    status: k.revoked ? 'revoked' : k.used_at ? 'used' : k.expires_at <= Date.now() ? 'expired' : 'unused',
    createdAt: k.created_at,
    expiresAt: k.expires_at,
    usedBy: k.used_by_name,
  }));
}

/** Slots in use: keys that were redeemed or are still waiting to be. Revoked and expired keys free their slot. */
export function referralsUsed(userId: number): number {
  return get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM keys WHERE kind = 'referral' AND user_id = ? AND revoked = 0 AND (used_at IS NOT NULL OR expires_at > ?)",
    userId,
    Date.now(),
  )!.n;
}

export function createReferral(userId: number): { key: string; expiresAt: number } {
  const user = getUser(userId);
  if (!user || user.status !== 'active') throw new HttpError(403, 'Not allowed');
  return tx(() => {
    if (referralsUsed(userId) >= user.referralQuota) throw new HttpError(403, 'You have no referrals left');
    return insertKey('referral', userId, REFERRAL_TTL);
  });
}

export function revokeReferral(userId: number, keyId: number): void {
  const r = run("UPDATE keys SET revoked = 1 WHERE id = ? AND user_id = ? AND kind = 'referral' AND used_at IS NULL", keyId, userId);
  if (!r.changes) throw new HttpError(404, 'Key not found or already used');
}

// ---------------------------------------------------------------- usage

export function monthlyBytes(userId: number): number {
  return get<{ bytes: number }>('SELECT bytes FROM usage WHERE user_id = ? AND month = ?', userId, currentMonth())?.bytes ?? 0;
}

export function addUsage(userId: number, bytes: number): void {
  run(
    'INSERT INTO usage (user_id, month, bytes) VALUES (?, ?, ?) ON CONFLICT(user_id, month) DO UPDATE SET bytes = bytes + excluded.bytes',
    userId,
    currentMonth(),
    Math.round(bytes),
  );
}
