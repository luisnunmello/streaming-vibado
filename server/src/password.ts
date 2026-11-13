import crypto from 'node:crypto';
import { HttpError } from './errors.js';

const DUMMY_SALT = Buffer.alloc(16);

/** Returns "salt:hash" (hex). */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

/** Always does the scrypt work, even without a stored password, so timing doesn't reveal valid names. */
export function verifyStoredPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) {
    crypto.scryptSync(password, DUMMY_SALT, 64);
    return false;
  }
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function checkNewPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) {
    throw new HttpError(400, 'The password must have 8 to 256 characters');
  }
  return password;
}
