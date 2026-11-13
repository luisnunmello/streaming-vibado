import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  activate,
  authenticate,
  changeOwnPassword,
  createGuest,
  createReferral,
  deleteGuest,
  getGuest,
  inspectKey,
  invitedBy,
  listGuests,
  listReferrals,
  monthlyBytes,
  reissueActivationKey,
  referralsUsed,
  revokeReferral,
  updateGuest,
  type Guest,
} from './accounts.js';
import {
  createSession,
  destroySession,
  getSession,
  lockedFor,
  recordAttempt,
  revokeAdminSessions,
  revokeGuestSessions,
  type Principal,
} from './auth.js';
import type { BudgetManager } from './budget.js';
import { HttpError } from './errors.js';
import { getGlobals, updateGlobals } from './globals.js';
import type { LiveService } from './live.js';
import { checkNewPassword } from './password.js';
import { countRooms, createRoom, deleteRoom, getRoomById, getRoomBySlug, listPublicRooms, listRooms, updateRoom, type Room } from './rooms.js';
import { setPassword as setMasterPassword, verifyPassword as verifyMasterPassword } from './settings.js';

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;

const wrap =
  (fn: Handler) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) res.status(e.status).json({ error: e.message });
      else {
        console.error('[api]', e);
        res.status(500).json({ error: 'Internal error' });
      }
    }
  };

const bearer = (req: Request): string | undefined => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
};

const principalOf = (res: Response): Principal => res.locals['principal'];
const tokenOf = (res: Response): string => res.locals['token'];

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = bearer(req);
  const principal = getSession(token);
  if (!principal) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.locals['principal'] = principal;
  res.locals['token'] = token;
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (principalOf(res).role !== 'admin') {
      res.status(403).json({ error: 'Admin only' });
      return;
    }
    next();
  });
}

const throttle = (req: Request, scope: string) => {
  const key = `${scope}:${req.ip ?? 'unknown'}`;
  const wait = lockedFor(key);
  if (wait > 0) throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.`);
  return (ok: boolean) => recordAttempt(key, ok);
};

const idParam = (req: Request): number => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid id');
  return id;
};

export function buildApi(live: LiveService, budget: BudgetManager): Router {
  const api = Router();

  const guestName = (id: number | null): string => (id === null ? 'Admin' : (getGuest(id)?.name ?? '?'));

  const roomView = (r: Room) => {
    const info = live.info(r.id);
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      visibility: r.visibility,
      ownerId: r.ownerId,
      ownerName: guestName(r.ownerId),
      createdAt: r.createdAt,
      live: info.live,
      viewers: info.viewers,
      // The path viewers need; private rooms carry their secret in the link.
      link: r.visibility === 'private' ? `/r/${r.slug}?key=${r.secret}` : `/r/${r.slug}`,
    };
  };

  const guestView = (g: Guest) => ({
    id: g.id,
    name: g.name,
    status: g.status,
    limits: g.limits,
    referralQuota: g.referralQuota,
    referralsUsed: referralsUsed(g.id),
    invitedById: g.invitedBy,
    invitedByName: g.invitedBy ? guestName(g.invitedBy) : null,
    createdAt: g.createdAt,
    activatedAt: g.activatedAt,
    lastSeen: g.lastSeen,
    rooms: countRooms(g.id),
    liveRooms: listRooms(g.id).filter((r) => live.info(r.id).live).length,
    monthBytes: monthlyBytes(g.id),
  });

  /** The room, if the caller may manage it (owner, or the admin for any room). */
  const manageable = (res: Response, id: string): Room => {
    const room = getRoomById(id);
    const p = principalOf(res);
    if (!room || (p.role !== 'admin' && room.ownerId !== p.guestId)) throw new HttpError(404, 'Room not found');
    return room;
  };

  // ---------------------------------------------------------------- public

  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  api.get(
    '/lobbies',
    wrap((_req, res) => {
      const rooms = listPublicRooms().map((r) => ({
        slug: r.slug,
        name: r.name,
        ownerName: r.ownerName,
        ...live.info(r.id),
      }));
      rooms.sort((a, b) => Number(b.live) - Number(a.live) || b.viewers - a.viewers || a.name.localeCompare(b.name));
      res.json({ rooms });
    }),
  );

  api.get(
    '/rooms/:slug/info',
    wrap((req, res) => {
      const room = getRoomBySlug(String(req.params['slug']));
      const owner = room?.ownerId != null ? getGuest(room.ownerId) : undefined;
      const key = typeof req.query['key'] === 'string' ? req.query['key'] : '';
      const visible = !!room && (room.ownerId === null || owner?.status === 'active') && (room.visibility === 'public' || key === room.secret);
      if (!room || !visible) throw new HttpError(404, 'Room not found');
      res.json({ name: room.name, slug: room.slug, ownerName: owner?.name ?? 'Admin', visibility: room.visibility, ...live.info(room.id) });
    }),
  );

  // ---------------------------------------------------------------- sign in / activation

  api.post(
    '/login',
    wrap((req, res) => {
      const done = throttle(req, 'login');
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!name || !password || password.length > 256) {
        done(false);
        throw new HttpError(401, 'Wrong name or password');
      }
      let principal: Principal | null = null;
      if (name.toLowerCase() === 'admin') {
        if (verifyMasterPassword(password)) principal = { role: 'admin' };
      } else {
        const guest = authenticate(name, password);
        if (guest) principal = { role: 'guest', guestId: guest.id };
      }
      done(!!principal);
      if (!principal) throw new HttpError(401, 'Wrong name or password');
      res.json({ token: createSession(principal), role: principal.role });
    }),
  );

  api.get(
    '/activate/check',
    wrap((req, res) => {
      const done = throttle(req, 'activate');
      try {
        const info = inspectKey(req.query['key']);
        done(true);
        res.json(info);
      } catch (e) {
        done(false);
        throw e;
      }
    }),
  );

  api.post(
    '/activate',
    wrap((req, res) => {
      const done = throttle(req, 'activate');
      let guest: Guest;
      try {
        guest = activate(req.body?.key, req.body?.password, req.body?.name);
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) done(false);
        throw e;
      }
      done(true);
      res.json({ token: createSession({ role: 'guest', guestId: guest.id }), role: 'guest' });
    }),
  );

  // ---------------------------------------------------------------- me

  api.post(
    '/logout',
    requireAuth,
    wrap((_req, res) => {
      destroySession(tokenOf(res));
      res.json({ ok: true });
    }),
  );

  api.get(
    '/me',
    requireAuth,
    wrap((_req, res) => {
      const p = principalOf(res);
      if (p.role === 'admin') {
        res.json({ role: 'admin', name: 'admin', limits: null });
        return;
      }
      const g = getGuest(p.guestId!);
      if (!g || g.status !== 'active') throw new HttpError(401, 'Unauthorized');
      res.json({
        role: 'guest',
        guestId: g.id,
        name: g.name,
        limits: g.limits,
        referrals: { quota: g.referralQuota, used: referralsUsed(g.id) },
        monthBytes: monthlyBytes(g.id),
        invitedByName: g.invitedBy ? guestName(g.invitedBy) : null,
      });
    }),
  );

  api.put(
    '/me/password',
    requireAuth,
    wrap((req, res) => {
      const p = principalOf(res);
      const { currentPassword, newPassword } = req.body ?? {};
      if (p.role === 'admin') {
        if (typeof currentPassword !== 'string' || !verifyMasterPassword(currentPassword)) throw new HttpError(403, 'Current password is wrong');
        setMasterPassword(checkNewPassword(newPassword));
        revokeAdminSessions(tokenOf(res));
      } else {
        changeOwnPassword(p.guestId!, currentPassword, newPassword);
        revokeGuestSessions(p.guestId!, tokenOf(res));
      }
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- referrals (guests)

  const guestOnly = (res: Response): number => {
    const p = principalOf(res);
    if (p.role !== 'guest') throw new HttpError(403, 'Only guests have referrals');
    return p.guestId!;
  };

  api.get(
    '/me/referrals',
    requireAuth,
    wrap((_req, res) => {
      const id = guestOnly(res);
      res.json({ quota: getGuest(id)!.referralQuota, used: referralsUsed(id), keys: listReferrals(id) });
    }),
  );

  api.post(
    '/me/referrals',
    requireAuth,
    wrap((_req, res) => {
      const { key, expiresAt } = createReferral(guestOnly(res));
      res.json({ key, expiresAt, link: `/activate?key=${key}` });
    }),
  );

  api.delete(
    '/me/referrals/:id',
    requireAuth,
    wrap((req, res) => {
      revokeReferral(guestOnly(res), idParam(req));
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- rooms (owner or admin)

  api.get(
    '/rooms',
    requireAuth,
    wrap((_req, res) => {
      const p = principalOf(res);
      res.json({ rooms: (p.role === 'admin' ? listRooms() : listRooms(p.guestId!)).map(roomView) });
    }),
  );

  api.post(
    '/rooms',
    requireAuth,
    wrap((req, res) => {
      const p = principalOf(res);
      const ownerId = p.role === 'admin' ? null : p.guestId!;
      if (ownerId !== null) {
        const limits = getGuest(ownerId)!.limits;
        if (countRooms(ownerId) >= limits.maxRooms) throw new HttpError(403, `You can have at most ${limits.maxRooms} room(s)`);
        if (req.body?.visibility === 'public' && !limits.allowPublicRooms) throw new HttpError(403, 'Public rooms are not allowed for your account');
      }
      res.status(201).json({ room: roomView(createRoom(ownerId, req.body?.name, req.body?.visibility)) });
    }),
  );

  api.patch(
    '/rooms/:id',
    requireAuth,
    wrap((req, res) => {
      const room = manageable(res, String(req.params['id']));
      const p = principalOf(res);
      const body = req.body ?? {};
      if (room.slug === 'main' && body.visibility === 'private') throw new HttpError(400, 'The main room is always public');
      if (p.role === 'guest' && body.visibility === 'public' && !getGuest(p.guestId!)!.limits.allowPublicRooms) {
        throw new HttpError(403, 'Public rooms are not allowed for your account');
      }
      const updated = updateRoom(room.id, { name: body.name, visibility: body.visibility, regenerateSecret: body.regenerateSecret });
      live.updateRoomSnapshot(updated);
      // A new link or a switch to private removes whoever is watching with the old access.
      if (body.regenerateSecret === true || (room.visibility === 'public' && updated.visibility === 'private')) {
        live.kickViewers(room.id, 'The room link was changed by its owner');
      }
      res.json({ room: roomView(updated) });
    }),
  );

  api.delete(
    '/rooms/:id',
    requireAuth,
    wrap((req, res) => {
      const room = manageable(res, String(req.params['id']));
      if (room.slug === 'main') throw new HttpError(400, 'The main room cannot be deleted');
      live.closeRoom(room.id, 'This room was deleted');
      deleteRoom(room.id);
      res.json({ ok: true });
    }),
  );

  api.post(
    '/rooms/:id/stop',
    requireAuth,
    wrap((req, res) => {
      const room = manageable(res, String(req.params['id']));
      const rt = live.runtimes.get(room.id);
      if (rt && live.isLive(rt)) live.endStream(rt, principalOf(res).role === 'admin' && room.ownerId !== null ? 'The admin stopped this stream' : 'Stream stopped');
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- admin: guests

  api.get(
    '/admin/guests',
    requireAdmin,
    wrap((_req, res) => {
      res.json({ guests: listGuests().map(guestView) });
    }),
  );

  api.post(
    '/admin/guests',
    requireAdmin,
    wrap((req, res) => {
      const { guest, key, expiresAt } = createGuest(req.body?.name, req.body?.referralQuota, req.body?.limits);
      res.status(201).json({ guest: guestView(guest), key, expiresAt, link: `/activate?key=${key}` });
    }),
  );

  /** `id` plus everyone invited by them, directly or not. */
  const subtree = (id: number): number[] => [id, ...invitedBy(id).flatMap(subtree)];

  api.patch(
    '/admin/guests/:id',
    requireAdmin,
    wrap((req, res) => {
      const id = idParam(req);
      const guest = updateGuest(id, req.body ?? {});
      if (req.body?.status === 'disabled') {
        const ids = req.body.cascade === true ? subtree(id) : [id];
        for (const gid of ids) {
          if (gid !== id) updateGuest(gid, { status: 'disabled' });
          revokeGuestSessions(gid);
          live.stopGuestStreams('This account was disabled', gid);
        }
      }
      res.json({ guest: guestView(getGuest(guest.id)!) });
    }),
  );

  api.post(
    '/admin/guests/:id/key',
    requireAdmin,
    wrap((req, res) => {
      const { key, expiresAt } = reissueActivationKey(idParam(req));
      res.json({ key, expiresAt, link: `/activate?key=${key}` });
    }),
  );

  api.delete(
    '/admin/guests/:id',
    requireAdmin,
    wrap((req, res) => {
      const id = idParam(req);
      if (!getGuest(id)) throw new HttpError(404, 'Guest not found');
      for (const r of listRooms(id)) live.closeRoom(r.id, 'This account was removed');
      revokeGuestSessions(id);
      deleteGuest(id);
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- admin: settings and bandwidth

  api.get(
    '/admin/settings',
    requireAdmin,
    wrap((_req, res) => {
      res.json({ settings: getGlobals() });
    }),
  );

  api.put(
    '/admin/settings',
    requireAdmin,
    wrap((req, res) => {
      const settings = updateGlobals(req.body ?? {});
      if (settings.guestStreamsPaused) live.stopGuestStreams('Guest streaming was paused by the admin');
      res.json({ settings });
    }),
  );

  api.get(
    '/admin/bandwidth',
    requireAdmin,
    wrap((_req, res) => {
      res.json(budget.view());
    }),
  );

  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return api;
}

