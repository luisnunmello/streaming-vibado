import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

interface Stored {
  salt: string;
  hash: string;
}

const file = path.join(config.dataDir, 'settings.json');

function derive(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, 64);
}

function write(password: string): void {
  const salt = crypto.randomBytes(16);
  const data: Stored = { salt: salt.toString('hex'), hash: derive(password, salt).toString('hex') };
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
}

/** Creates the master password on first run. Returns the generated password if one was created. */
export function initSettings(): string | null {
  if (fs.existsSync(file)) {
    if (process.env.ADMIN_PASSWORD) {
      console.log(
        '[auth] ADMIN_PASSWORD is ignored: a master password is already stored. ' +
          'Change it on /admin, or reset it (see README, "Forgot the password?").',
      );
    }
    return null;
  }
  // `||` on purpose: an empty ADMIN_PASSWORD (e.g. from an unset compose variable) must not become the password.
  const fromEnv = process.env.ADMIN_PASSWORD || undefined;
  const password = fromEnv ?? crypto.randomBytes(12).toString('base64url');
  write(password);
  return fromEnv ? null : password;
}

export function verifyPassword(password: string): boolean {
  const stored: Stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  const expected = Buffer.from(stored.hash, 'hex');
  const actual = derive(password, Buffer.from(stored.salt, 'hex'));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function setPassword(password: string): void {
  write(password);
}
