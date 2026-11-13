import { all, currentMonth, get, run, tx } from './db.js';
import { HttpError } from './errors.js';
import { getGlobals } from './globals.js';
import { hashKey, keyHint, newKey, normalizeKey } from './keys.js';
import { clampToParent, parseStoredLimits, sanitizeLimits, type Limits } from './limits.js';
import { checkNewPassword, hashPassword, verifyStoredPassword } from './password.js';

const DAY = 24 * 60 * 60 * 1000;
const ACTIVATION_TTL = 7 * DAY;
const REFERRAL_TTL = 14 * DAY;

export type GuestStatus = 'pending' | 'active' | 'disabled';

export interface Guest {
  id: number;
  name: string;
  status: GuestStatus;
  limits: Limits;
  referralQuota: number;
  invitedBy: number | null;
  createdAt: number;
  activatedAt: number | null;
  lastSeen: number | null;
}

interface GuestRow {
  id: number;
  name: string;
  password: string | null;
  status: GuestStatus;
  limits: string;
  referral_quota: number;
  invited_by: number | null;
  created_at: number;
  activated_at: number | null;
  last_seen: number | null;
}

interface KeyRow {
  id: number;
  hash: string;
  kind: 'activation' | 'referral';
  guest_id: number;
  hint: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  used_by: number | null;
  revoked: number;
}

const toGuest = (r: GuestRow): Guest => ({
  id: r.id,
  name: r.name,
  status: r.status,
  limits: parseStoredLimits(r.limits),
  referralQuota: r.referral_quota,
  invitedBy: r.invited_by,
  createdAt: r.created_at,
  activatedAt: r.activated_at,
  lastSeen: r.last_seen,
});

export const getGuest = (id: number): Guest | undefined => {
  const r = get<GuestRow>('SELECT * FROM guests WHERE id = ?', id);
  return r && toGuest(r);
};

export const listGuests = (): Guest[] => all<GuestRow>('SELECT * FROM guests ORDER BY created_at DESC').map(toGuest);

export function validateName(name: unknown): string {
  if (typeof name !== 'string') throw new HttpError(400, 'A name is required');
  const n = name.trim();
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(n)) {
    throw new HttpError(400, 'The name must have 3 to 24 letters, digits, "_" or "-"');
  }
  if (/^admin/i.test(n)) throw new HttpError(400, 'That name is reserved');
  return n;
}

function ensureNameFree(name: string): void {
  if (get('SELECT 1 FROM guests WHERE name = ?', name)) throw new HttpError(409, 'That name is already taken');
}

function insertKey(kind: 'activation' | 'referral', guestId: number, ttl: number): { key: string; expiresAt: number } {
  const key = newKey();
  const now = Date.now();
  const expiresAt = now + ttl;
  run(
    'INSERT INTO keys (hash, kind, guest_id, hint, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    hashKey(key),
    kind,
    guestId,
    keyHint(key),
    now,
    expiresAt,
  );
  return { key, expiresAt };
}

// ---------------------------------------------------------------- admin: create / edit

export function createGuest(nameInput: unknown, referralQuota: unknown, limitsInput: unknown) {
  const name = validateName(nameInput);
  const quota = Number(referralQuota ?? 0);
  if (!Number.isInteger(quota) || quota < 0 || quota > 1000) throw new HttpError(400, 'referralQuota must be a whole number from 0 to 1000');
  const limits = sanitizeLimits(limitsInput, getGlobals().defaultLimits);
  return tx(() => {
    ensureNameFree(name);
    const { id } = run(
      "INSERT INTO guests (name, status, limits, referral_quota, created_at) VALUES (?, 'pending', ?, ?, ?)",
      name,
      JSON.stringify(limits),
      quota,
      Date.now(),
    );
    const { key, expiresAt } = insertKey('activation', id, ACTIVATION_TTL);
    return { guest: getGuest(id)!, key, expiresAt };
  });
}

/** New activation key for a guest: used for first activation and for password resets. */
export function reissueActivationKey(guestId: number) {
  const guest = getGuest(guestId);
  if (!guest) throw new HttpError(404, 'Guest not found');
  if (guest.status === 'disabled') throw new HttpError(409, 'Enable the guest first');
  return tx(() => {
    run("UPDATE keys SET revoked = 1 WHERE guest_id = ? AND kind = 'activation' AND used_at IS NULL", guestId);
    return insertKey('activation', guestId, ACTIVATION_TTL);
  });
}

export function updateGuest(id: number, patch: Record<string, unknown>): Guest {
  const guest = getGuest(id);
  if (!guest) throw new HttpError(404, 'Guest not found');
  let { limits, referralQuota, status } = guest;
  if (patch['limits'] !== undefined) limits = sanitizeLimits(patch['limits'], guest.limits);
  if (patch['referralQuota'] !== undefined) {
    const q = Number(patch['referralQuota']);
    if (!Number.isInteger(q) || q < 0 || q > 1000) throw new HttpError(400, 'referralQuota must be a whole number from 0 to 1000');
    referralQuota = q;
  }
  if (patch['status'] !== undefined) {
    if (patch['status'] !== 'active' && patch['status'] !== 'disabled') throw new HttpError(400, 'status must be "active" or "disabled"');
    if (guest.status === 'pending') throw new HttpError(409, 'The guest has not activated the account yet');
    status = patch['status'];
  }
  run('UPDATE guests SET limits = ?, referral_quota = ?, status = ? WHERE id = ?', JSON.stringify(limits), referralQuota, status, id);
  return getGuest(id)!;
}

/** Guests invited (directly) by `id`. */
export const invitedBy = (id: number): number[] => all<{ id: number }>('SELECT id FROM guests WHERE invited_by = ?', id).map((r) => r.id);

export function deleteGuest(id: number): void {
  if (!run('DELETE FROM guests WHERE id = ?', id).changes) throw new HttpError(404, 'Guest not found');
}

export function setPassword(guestId: number, password: unknown): void {
  run('UPDATE guests SET password = ? WHERE id = ?', hashPassword(checkNewPassword(password)), guestId);
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
  const owner = getGuest(k.guest_id);
  if (!owner || owner.status === 'disabled') throw new HttpError(404, 'This key is invalid, expired or already used');
  return k.kind === 'activation' ? { kind: 'activation', name: owner.name } : { kind: 'referral' };
}

export function activate(key: unknown, passwordInput: unknown, nameInput?: unknown): Guest {
  const password = checkNewPassword(passwordInput);
  const k = findKey(key);
  if (!keyUsable(k)) throw new HttpError(404, 'This key is invalid, expired or already used');
  const owner = getGuest(k.guest_id);
  if (!owner || owner.status === 'disabled') throw new HttpError(404, 'This key is invalid, expired or already used');

  return tx(() => {
    const now = Date.now();
    if (k.kind === 'activation') {
      run("UPDATE guests SET password = ?, status = 'active', activated_at = COALESCE(activated_at, ?) WHERE id = ?", hashPassword(password), now, owner.id);
      run('UPDATE keys SET used_at = ?, used_by = ? WHERE id = ?', now, owner.id, k.id);
      return getGuest(owner.id)!;
    }
    // referral: the inviter must still be allowed to invite
    if (owner.status !== 'active') throw new HttpError(404, 'This key is invalid, expired or already used');
    const name = validateName(nameInput);
    ensureNameFree(name);
    const limits = clampToParent(getGlobals().defaultLimits, owner.limits);
    // Invited guests get no referrals of their own.
    const { id } = run(
      "INSERT INTO guests (name, password, status, limits, referral_quota, invited_by, created_at, activated_at) VALUES (?, ?, 'active', ?, 0, ?, ?, ?)",
      name,
      hashPassword(password),
      JSON.stringify(limits),
      owner.id,
      now,
      now,
    );
    run('UPDATE keys SET used_at = ?, used_by = ? WHERE id = ?', now, id, k.id);
    return getGuest(id)!;
  });
}

/** Returns the guest when name + password are right and the account is active. */
export function authenticate(name: unknown, password: unknown): Guest | null {
  const row = typeof name === 'string' ? get<GuestRow>('SELECT * FROM guests WHERE name = ?', name.trim()) : undefined;
  const ok = verifyStoredPassword(typeof password === 'string' ? password : '', row?.password);
  if (!row || !ok || row.status !== 'active') return null;
  run('UPDATE guests SET last_seen = ? WHERE id = ?', Date.now(), row.id);
  return toGuest(row);
}

export function changeOwnPassword(guestId: number, current: unknown, next: unknown): void {
  const row = get<GuestRow>('SELECT * FROM guests WHERE id = ?', guestId);
  if (!row || !verifyStoredPassword(typeof current === 'string' ? current : '', row.password)) {
    throw new HttpError(403, 'Current password is wrong');
  }
  setPassword(guestId, next);
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

export function listReferrals(guestId: number): ReferralInfo[] {
  const rows = all<KeyRow & { used_by_name: string | null }>(
    `SELECT k.*, g.name AS used_by_name FROM keys k LEFT JOIN guests g ON g.id = k.used_by
     WHERE k.kind = 'referral' AND k.guest_id = ? ORDER BY k.created_at DESC`,
    guestId,
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
export function referralsUsed(guestId: number): number {
  return get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM keys WHERE kind = 'referral' AND guest_id = ? AND revoked = 0 AND (used_at IS NOT NULL OR expires_at > ?)",
    guestId,
    Date.now(),
  )!.n;
}

export function createReferral(guestId: number): { key: string; expiresAt: number } {
  const guest = getGuest(guestId);
  if (!guest || guest.status !== 'active') throw new HttpError(403, 'Not allowed');
  return tx(() => {
    if (referralsUsed(guestId) >= guest.referralQuota) throw new HttpError(403, 'You have no referrals left');
    return insertKey('referral', guestId, REFERRAL_TTL);
  });
}

export function revokeReferral(guestId: number, keyId: number): void {
  const r = run("UPDATE keys SET revoked = 1 WHERE id = ? AND guest_id = ? AND kind = 'referral' AND used_at IS NULL", keyId, guestId);
  if (!r.changes) throw new HttpError(404, 'Key not found or already used');
}

// ---------------------------------------------------------------- usage

export function monthlyBytes(guestId: number): number {
  return get<{ bytes: number }>('SELECT bytes FROM usage WHERE guest_id = ? AND month = ?', guestId, currentMonth())?.bytes ?? 0;
}

export function addUsage(guestId: number, bytes: number): void {
  run(
    'INSERT INTO usage (guest_id, month, bytes) VALUES (?, ?, ?) ON CONFLICT(guest_id, month) DO UPDATE SET bytes = bytes + excluded.bytes',
    guestId,
    currentMonth(),
    Math.round(bytes),
  );
}
