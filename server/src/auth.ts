import crypto from 'node:crypto';
import { get, run } from './db.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

run('DELETE FROM sessions WHERE expires_at < ?', Date.now());

export interface Principal {
  /** 'guest' = someone using a temporary invite: no account, only the invited room. */
  role: 'admin' | 'user' | 'guest';
  /** Set for users. */
  userId?: number;
  /** Set for guests. */
  inviteId?: number;
}

interface Session {
  principal: Principal;
  expires: number;
}

const sessions = new Map<string, Session>();
const revokeListeners: Array<(tokens: string[]) => void> = [];

/** Called with the tokens of every session that is ended by the server (not by logout). */
export function onRevoke(cb: (tokens: string[]) => void): void {
  revokeListeners.push(cb);
}

/** `remember` keeps the session for 30 days and across server restarts (e.g. a redeploy). */
export function createSession(principal: Principal, remember = false, ttlMs?: number): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + (ttlMs ?? (remember ? REMEMBER_TTL_MS : SESSION_TTL_MS));
  sessions.set(token, { principal, expires });
  if (remember) {
    run('INSERT INTO sessions (token_hash, role, user_id, expires_at) VALUES (?, ?, ?, ?)', hashToken(token), principal.role, principal.userId ?? principal.inviteId ?? null, expires);
  }
  return token;
}

export function getSession(token: unknown): Principal | null {
  if (typeof token !== 'string') return null;
  let s = sessions.get(token);
  if (!s) {
    // a remembered session from before a restart
    const row = get<{ role: 'admin' | 'user' | 'guest'; user_id: number | null; expires_at: number }>(
      'SELECT role, user_id, expires_at FROM sessions WHERE token_hash = ?',
      hashToken(token),
    );
    if (!row) return null;
    const principal: Principal =
      row.role === 'admin' ? { role: 'admin' } : row.role === 'guest' ? { role: 'guest', inviteId: row.user_id ?? undefined } : { role: 'user', userId: row.user_id ?? undefined };
    s = { principal, expires: row.expires_at };
    sessions.set(token, s);
  }
  if (s.expires < Date.now()) {
    sessions.delete(token);
    run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
    return null;
  }
  return s.principal;
}

export function destroySession(token: string): void {
  run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
  if (sessions.delete(token)) revokeListeners.forEach((cb) => cb([token]));
}

function revokeWhere(pred: (p: Principal, token: string) => boolean): string[] {
  const revoked: string[] = [];
  for (const [token, s] of sessions) {
    if (pred(s.principal, token)) {
      sessions.delete(token);
      revoked.push(token);
    }
  }
  if (revoked.length) revokeListeners.forEach((cb) => cb(revoked));
  return revoked;
}

/** Ends the sessions of whoever redeemed an invite (the invite was revoked or ran out). */
export const revokeGuestSessions = (inviteId: number) => {
  run("DELETE FROM sessions WHERE role = 'guest' AND user_id = ?", inviteId);
  return revokeWhere((p) => p.role === 'guest' && p.inviteId === inviteId);
};

/** Ends every admin session except `keep` (used when the master password changes). */
export const revokeAdminSessions = (keep?: string) => {
  run("DELETE FROM sessions WHERE role = 'admin' AND token_hash <> ?", keep ? hashToken(keep) : '');
  return revokeWhere((p, t) => p.role === 'admin' && t !== keep);
};

/** Ends every session of a user, optionally keeping one. */
export const revokeUserSessions = (userId: number, keep?: string) => {
  run("DELETE FROM sessions WHERE role = 'user' AND user_id = ? AND token_hash <> ?", userId, keep ? hashToken(keep) : '');
  return revokeWhere((p, t) => p.role === 'user' && p.userId === userId && t !== keep);
};

// --- throttling: 5 failures per key (IP) -> locked for 1 minute, doubling on repeats (max 15 min) ---
const failures = new Map<string, { count: number; lockedUntil: number; lockMs: number }>();

export function lockedFor(key: string): number {
  const f = failures.get(key);
  return f && f.lockedUntil > Date.now() ? f.lockedUntil - Date.now() : 0;
}

export function recordAttempt(key: string, ok: boolean): void {
  if (ok) {
    failures.delete(key);
    return;
  }
  const f = failures.get(key) ?? { count: 0, lockedUntil: 0, lockMs: 60_000 };
  f.count++;
  if (f.count >= 5) {
    f.lockedUntil = Date.now() + f.lockMs;
    f.lockMs = Math.min(f.lockMs * 2, 15 * 60_000);
    f.count = 0;
  }
  failures.set(key, f);
}
