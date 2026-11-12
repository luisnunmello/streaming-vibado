import crypto from 'node:crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map<string, number>(); // token -> expiry

export function createSession(): string {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function isValidSession(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

/** Invalidates every session except `keep`. Returns the tokens that were revoked. */
export function revokeAllExcept(keep: string): string[] {
  const revoked: string[] = [];
  for (const t of sessions.keys()) {
    if (t !== keep) {
      sessions.delete(t);
      revoked.push(t);
    }
  }
  return revoked;
}

// --- login throttling: 5 failures per IP -> locked for 1 minute (doubles on repeat) ---
const failures = new Map<string, { count: number; lockedUntil: number; lockMs: number }>();

export function loginLockedFor(ip: string): number {
  const f = failures.get(ip);
  return f && f.lockedUntil > Date.now() ? f.lockedUntil - Date.now() : 0;
}

export function recordLogin(ip: string, ok: boolean): void {
  if (ok) {
    failures.delete(ip);
    return;
  }
  const f = failures.get(ip) ?? { count: 0, lockedUntil: 0, lockMs: 60_000 };
  f.count++;
  if (f.count >= 5) {
    f.lockedUntil = Date.now() + f.lockMs;
    f.lockMs = Math.min(f.lockMs * 2, 15 * 60_000);
    f.count = 0;
  }
  failures.set(ip, f);
}
