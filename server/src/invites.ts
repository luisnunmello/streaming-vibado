import crypto from 'node:crypto';
import { all, get, run } from './db.js';
import { HttpError } from './errors.js';
import { randomToken } from './keys.js';

/** How long an unused invite link stays valid. */
const LINK_TTL_MS = 24 * 60 * 60 * 1000;
/** Longest temporary invite the admin may create (users are bound by their limit). */
export const ADMIN_MAX_INVITE_MINUTES = 7 * 24 * 60;
const MAX_OPEN_PER_CREATOR = 10;

export type InviteStatus = 'waiting' | 'active' | 'ended' | 'revoked' | 'expired';

export interface Invite {
  id: number;
  /** null = created by the admin. */
  creatorId: number | null;
  roomId: string;
  minutes: number;
  createdAt: number;
  linkExpiresAt: number;
  redeemedAt: number | null;
  endsAt: number | null;
  revokedAt: number | null;
  revokedBy: string;
}

interface Row {
  id: number;
  token_hash: string;
  creator_id: number | null;
  room_id: string;
  minutes: number;
  created_at: number;
  link_expires_at: number;
  redeemed_at: number | null;
  ends_at: number | null;
  revoked_at: number | null;
  revoked_by: string;
}

const hash = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

const toInvite = (r: Row): Invite => ({
  id: r.id,
  creatorId: r.creator_id,
  roomId: r.room_id,
  minutes: r.minutes,
  createdAt: r.created_at,
  linkExpiresAt: r.link_expires_at,
  redeemedAt: r.redeemed_at,
  endsAt: r.ends_at,
  revokedAt: r.revoked_at,
  revokedBy: r.revoked_by,
});

export function statusOf(i: Invite, now = Date.now()): InviteStatus {
  if (i.revokedAt) return 'revoked';
  if (i.redeemedAt) return i.endsAt && i.endsAt > now ? 'active' : 'ended';
  return i.linkExpiresAt > now ? 'waiting' : 'expired';
}

export const getInvite = (id: number): Invite | undefined => {
  const r = get<Row>('SELECT * FROM invites WHERE id = ?', id);
  return r && toInvite(r);
};

export const listInvites = (creatorId: number | null): Invite[] =>
  (creatorId === null
    ? all<Row>('SELECT * FROM invites WHERE creator_id IS NULL ORDER BY created_at DESC LIMIT 100')
    : all<Row>('SELECT * FROM invites WHERE creator_id = ? ORDER BY created_at DESC LIMIT 100', creatorId)
  ).map(toInvite);

/** Creates an invite; the returned token is the only time the link can be seen. */
export function createInvite(creatorId: number | null, roomId: string, minutes: number): { invite: Invite; token: string } {
  const now = Date.now();
  const open = (creatorId === null
    ? all<Row>('SELECT * FROM invites WHERE creator_id IS NULL AND revoked_at IS NULL')
    : all<Row>('SELECT * FROM invites WHERE creator_id = ? AND revoked_at IS NULL', creatorId)
  )
    .map(toInvite)
    .filter((i) => statusOf(i, now) === 'waiting' || statusOf(i, now) === 'active').length;
  if (open >= MAX_OPEN_PER_CREATOR) throw new HttpError(429, 'Too many open temporary invites. Revoke one first.');
  const token = randomToken(18);
  const { id } = run(
    'INSERT INTO invites (token_hash, creator_id, room_id, minutes, created_at, link_expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    hash(token),
    creatorId,
    roomId,
    minutes,
    now,
    now + LINK_TTL_MS,
  );
  return { invite: getInvite(id)!, token };
}

/** The invite behind a link that nobody has used yet. */
export function peekInvite(token: unknown): Invite | undefined {
  if (typeof token !== 'string' || token.length < 10 || token.length > 200) return undefined;
  const r = get<Row>('SELECT * FROM invites WHERE token_hash = ?', hash(token));
  const i = r && toInvite(r);
  return i && statusOf(i) === 'waiting' ? i : undefined;
}

/** Marks the link as used: the guest's time starts now. */
export function redeemInvite(token: unknown): Invite {
  const i = peekInvite(token);
  if (!i) throw new HttpError(404, 'This invite is invalid, expired or already used');
  const now = Date.now();
  run('UPDATE invites SET redeemed_at = ?, ends_at = ? WHERE id = ?', now, now + i.minutes * 60_000, i.id);
  return getInvite(i.id)!;
}

export function revokeInvite(id: number, by: 'creator' | 'guest' | 'admin' | 'system'): void {
  run("UPDATE invites SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL", Date.now(), by, id);
}

/** An invite a guest may still act on right now, or undefined. */
export function activeInvite(id: number | undefined): Invite | undefined {
  if (id === undefined) return undefined;
  const i = getInvite(id);
  return i && statusOf(i) === 'active' ? i : undefined;
}

/** Invites whose time ran out and that nobody has ended yet. */
export function dueInvites(): Invite[] {
  const now = Date.now();
  return all<Row>('SELECT * FROM invites WHERE redeemed_at IS NOT NULL AND revoked_at IS NULL AND ends_at <= ? AND revoked_by = \'\'', now).map(toInvite);
}

export function markEnded(id: number): void {
  run("UPDATE invites SET revoked_by = 'time' WHERE id = ? AND revoked_by = ''", id);
}
