import crypto from 'node:crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface Principal {
  role: 'admin' | 'guest';
  /** Set for guests. */
  guestId?: number;
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

export function createSession(principal: Principal): string {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { principal, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

export function getSession(token: unknown): Principal | null {
  if (typeof token !== 'string') return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s.principal;
}

export function destroySession(token: string): void {
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

/** Ends every admin session except `keep` (used when the master password changes). */
export const revokeAdminSessions = (keep?: string) => revokeWhere((p, t) => p.role === 'admin' && t !== keep);

/** Ends every session of a guest, optionally keeping one. */
export const revokeGuestSessions = (guestId: number, keep?: string) =>
  revokeWhere((p, t) => p.role === 'guest' && p.guestId === guestId && t !== keep);

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
