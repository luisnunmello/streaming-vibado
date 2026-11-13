import crypto from 'node:crypto';
import { all, get, run } from './db.js';
import { HttpError } from './errors.js';
import { randomToken } from './keys.js';

export type Visibility = 'public' | 'private';

export interface Room {
  id: string;
  slug: string;
  name: string;
  /** null = the admin. */
  ownerId: number | null;
  visibility: Visibility;
  /** Part of the link for private rooms. */
  secret: string;
  createdAt: number;
}

interface RoomRow {
  id: string;
  slug: string;
  name: string;
  owner_id: number | null;
  visibility: Visibility;
  secret: string;
  created_at: number;
}

const toRoom = (r: RoomRow): Room => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  ownerId: r.owner_id,
  visibility: r.visibility,
  secret: r.secret,
  createdAt: r.created_at,
});

export function validateRoomName(name: unknown): string {
  if (typeof name !== 'string') throw new HttpError(400, 'A room name is required');
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 40) throw new HttpError(400, 'The room name must have 2 to 40 characters');
  return n;
}

export function validateVisibility(v: unknown): Visibility {
  if (v !== 'public' && v !== 'private') throw new HttpError(400, 'visibility must be "public" or "private"');
  return v;
}

function makeSlug(name: string): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'room';
  for (;;) {
    const slug = `${base}-${crypto.randomBytes(2).toString('hex')}`;
    if (!get('SELECT 1 FROM rooms WHERE slug = ?', slug)) return slug;
  }
}

export const getRoomBySlug = (slug: string): Room | undefined => {
  const r = get<RoomRow>('SELECT * FROM rooms WHERE slug = ?', slug);
  return r && toRoom(r);
};

export const getRoomById = (id: string): Room | undefined => {
  const r = get<RoomRow>('SELECT * FROM rooms WHERE id = ?', id);
  return r && toRoom(r);
};

/** `ownerId` undefined = every room. */
export function listRooms(ownerId?: number | null): Room[] {
  const rows =
    ownerId === undefined
      ? all<RoomRow>('SELECT * FROM rooms ORDER BY created_at')
      : ownerId === null
        ? all<RoomRow>('SELECT * FROM rooms WHERE owner_id IS NULL ORDER BY created_at')
        : all<RoomRow>('SELECT * FROM rooms WHERE owner_id = ? ORDER BY created_at', ownerId);
  return rows.map(toRoom);
}

export const countRooms = (ownerId: number | null): number =>
  ownerId === null
    ? get<{ n: number }>('SELECT COUNT(*) AS n FROM rooms WHERE owner_id IS NULL')!.n
    : get<{ n: number }>('SELECT COUNT(*) AS n FROM rooms WHERE owner_id = ?', ownerId)!.n;

/** Public rooms whose owner is the admin or an active guest. */
export function listPublicRooms(): (Room & { ownerName: string })[] {
  const rows = all<RoomRow & { owner_name: string | null; owner_status: string | null }>(
    `SELECT r.*, g.name AS owner_name, g.status AS owner_status
     FROM rooms r LEFT JOIN guests g ON g.id = r.owner_id
     WHERE r.visibility = 'public' AND (r.owner_id IS NULL OR g.status = 'active')
     ORDER BY r.created_at`,
  );
  return rows.map((r) => ({ ...toRoom(r), ownerName: r.owner_name ?? 'Admin' }));
}

export function createRoom(ownerId: number | null, nameInput: unknown, visibilityInput: unknown): Room {
  const name = validateRoomName(nameInput);
  const visibility = validateVisibility(visibilityInput);
  const id = crypto.randomUUID();
  run(
    'INSERT INTO rooms (id, slug, name, owner_id, visibility, secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    makeSlug(name),
    name,
    ownerId,
    visibility,
    randomToken(16),
    Date.now(),
  );
  return getRoomById(id)!;
}

export function updateRoom(id: string, patch: { name?: unknown; visibility?: unknown; regenerateSecret?: unknown }): Room {
  const room = getRoomById(id);
  if (!room) throw new HttpError(404, 'Room not found');
  const name = patch.name !== undefined ? validateRoomName(patch.name) : room.name;
  const visibility = patch.visibility !== undefined ? validateVisibility(patch.visibility) : room.visibility;
  const secret = patch.regenerateSecret === true ? randomToken(16) : room.secret;
  run('UPDATE rooms SET name = ?, visibility = ?, secret = ? WHERE id = ?', name, visibility, secret, id);
  return getRoomById(id)!;
}

export function deleteRoom(id: string): void {
  run('DELETE FROM rooms WHERE id = ?', id);
}

/** The admin's permanent room, served at /r/main. */
export function ensureMainRoom(): Room {
  const existing = getRoomBySlug('main');
  if (existing) return existing;
  const id = crypto.randomUUID();
  run(
    "INSERT INTO rooms (id, slug, name, owner_id, visibility, secret, created_at) VALUES (?, 'main', 'Main stream', NULL, 'public', ?, ?)",
    id,
    randomToken(16),
    Date.now(),
  );
  return getRoomById(id)!;
}
