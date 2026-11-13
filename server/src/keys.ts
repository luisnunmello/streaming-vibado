import crypto from 'node:crypto';

// No 0/O/1/I/L so keys survive being read out loud or retyped.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Random key like K7QM-2XWD-9PFA-R4TN (about 79 bits). */
export function newKey(): string {
  let raw = '';
  for (let i = 0; i < 16; i++) raw += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return raw.replace(/(.{4})(?=.)/g, '$1-');
}

export function normalizeKey(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Keys are random and long, so a plain SHA-256 is enough to store them safely. */
export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(normalizeKey(key)).digest('hex');
}

export function keyHint(key: string): string {
  return normalizeKey(key).slice(-4);
}

export function randomToken(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
