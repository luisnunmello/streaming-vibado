import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  activate,
  authenticate,
  changeOwnPassword,
  renameUser,
  submitAppeal,
  denyAppeal,
  countPendingAppeals,
  setRestriction,
  createUser,
  createReferral,
  deleteUser,
  getUser,
  inspectKey,
  invitedBy,
  listUsers,
  listReferrals,
  monthlyBytes,
  reissueActivationKey,
  referralsUsed,
  revokeReferral,
  updateUser,
  withInvitees,
  type User,
} from './accounts.js';
import {
  createSession,
  destroySession,
  getSession,
  lockedFor,
  recordAttempt,
  revokeAdminSessions,
  revokeUserSessions,
  type Principal,
} from './auth.js';
import type { BudgetManager } from './budget.js';
import { HttpError } from './errors.js';
import { getGlobals, updateGlobals } from './globals.js';
import { createPreset, deletePreset, listPresets, updatePreset } from './presets.js';
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

/** What a restricted user may still do: see who they are (and why), change their login, sign out. */
const RESTRICTED_OK = new Set(['/me', '/me/name', '/me/password', '/me/appeal', '/logout']);

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = bearer(req);
  const principal = getSession(token);
  if (!principal) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (principal.role === 'user' && !RESTRICTED_OK.has(req.path)) {
    const u = getUser(principal.userId!);
    if (u?.restricted) {
      res.status(403).json({ error: u.restrictedReason || 'Your account is restricted', restricted: true });
      return;
    }
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

  const userName = (id: number | null): string => (id === null ? 'Admin' : (getUser(id)?.name ?? '?'));

  const roomView = (r: Room) => {
    const info = live.info(r.id);
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      visibility: r.visibility,
      ownerId: r.ownerId,
      ownerName: userName(r.ownerId),
      createdAt: r.createdAt,
      live: info.live,
      viewers: info.viewers,
      // The path viewers need; private rooms carry their secret in the link.
      link: r.visibility === 'private' ? `/r/${r.slug}?key=${r.secret}` : `/r/${r.slug}`,
    };
  };

  const userView = (g: User) => ({
    id: g.id,
    name: g.name,
    status: g.status,
    restricted: g.restricted,
    restrictedReason: g.restrictedReason,
    restrictedById: g.restrictedBy,
    appealStatus: g.appealStatus,
    appealText: g.appealText,
    appealAt: g.appealAt,
    limits: g.limits,
    presetId: g.presetId,
    presetName: g.presetName,
    referralQuota: g.referralQuota,
    referralsUsed: referralsUsed(g.id),
    invitedById: g.invitedBy,
    invitedByName: g.invitedBy ? userName(g.invitedBy) : null,
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
    if (!room || (p.role !== 'admin' && room.ownerId !== p.userId)) throw new HttpError(404, 'Room not found');
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
      const owner = room?.ownerId != null ? getUser(room.ownerId) : undefined;
      const key = typeof req.query['key'] === 'string' ? req.query['key'] : '';
      const visible = !!room && (room.ownerId === null || (owner?.status === 'active' && !owner.restricted)) && (room.visibility === 'public' || key === room.secret);
      if (!room || !visible) throw new HttpError(404, 'Room not found');
      // `mine`: the caller is signed in and owns this room (the admin owns the main room), so the viewer page can offer streamer controls.
      const caller = getSession(bearer(req));
      const mine = !!caller && ((caller.role === 'admin' && room.ownerId === null) || (caller.role === 'user' && caller.userId === room.ownerId));
      res.json({ name: room.name, slug: room.slug, ownerName: owner?.name ?? 'Admin', visibility: room.visibility, mine, ...live.info(room.id) });
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
        const user = authenticate(name, password);
        if (user) principal = { role: 'user', userId: user.id };
      }
      done(!!principal);
      if (!principal) throw new HttpError(401, 'Wrong name or password');
      res.json({ token: createSession(principal, req.body?.remember === true), role: principal.role });
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
      let user: User;
      try {
        user = activate(req.body?.key, req.body?.password, req.body?.name);
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) done(false);
        throw e;
      }
      done(true);
      res.json({ token: createSession({ role: 'user', userId: user.id }), role: 'user' });
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
        res.json({ role: 'admin', name: 'admin', limits: null, pendingAppeals: countPendingAppeals() });
        return;
      }
      const g = getUser(p.userId!);
      if (!g || g.status !== 'active') throw new HttpError(401, 'Unauthorized');
      res.json({
        role: 'user',
        userId: g.id,
        name: g.name,
        restricted: g.restricted,
        restrictedReason: g.restrictedReason,
        appealStatus: g.appealStatus,
        appealText: g.appealText,
        appealReply: g.appealReply,
        limits: g.limits,
        referrals: { quota: g.referralQuota, used: referralsUsed(g.id) },
        monthBytes: monthlyBytes(g.id),
        invitedByName: g.invitedBy ? userName(g.invitedBy) : null,
      });
    }),
  );

  api.post(
    '/me/appeal',
    requireAuth,
    wrap((req, res) => {
      const p = principalOf(res);
      if (p.role !== 'user') throw new HttpError(403, 'Only users can appeal');
      submitAppeal(p.userId!, req.body?.text);
      res.json({ ok: true });
    }),
  );

  api.put(
    '/me/name',
    requireAuth,
    wrap((req, res) => {
      const p = principalOf(res);
      if (p.role !== 'user') throw new HttpError(403, 'The administrator name cannot be changed');
      const user = renameUser(p.userId!, req.body?.name);
      res.json({ name: user.name });
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
        changeOwnPassword(p.userId!, currentPassword, newPassword);
        revokeUserSessions(p.userId!, tokenOf(res));
      }
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- referrals (users)

  const userOnly = (res: Response): number => {
    const p = principalOf(res);
    if (p.role !== 'user') throw new HttpError(403, 'Only users have referrals');
    return p.userId!;
  };

  api.get(
    '/me/referrals',
    requireAuth,
    wrap((_req, res) => {
      const id = userOnly(res);
      res.json({ quota: getUser(id)!.referralQuota, used: referralsUsed(id), keys: listReferrals(id) });
    }),
  );

  api.post(
    '/me/referrals',
    requireAuth,
    wrap((_req, res) => {
      const { key, expiresAt } = createReferral(userOnly(res));
      res.json({ key, expiresAt, link: `/activate?key=${key}` });
    }),
  );

  api.delete(
    '/me/referrals/:id',
    requireAuth,
    wrap((req, res) => {
      revokeReferral(userOnly(res), idParam(req));
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- rooms (owner or admin)

  api.get(
    '/rooms',
    requireAuth,
    wrap((_req, res) => {
      const p = principalOf(res);
      res.json({ rooms: (p.role === 'admin' ? listRooms() : listRooms(p.userId!)).map(roomView) });
    }),
  );

  api.post(
    '/rooms',
    requireAuth,
    wrap((req, res) => {
      const p = principalOf(res);
      const ownerId = p.role === 'admin' ? null : p.userId!;
      if (ownerId !== null) {
        const limits = getUser(ownerId)!.limits;
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
      if (p.role === 'user' && body.visibility === 'public' && !getUser(p.userId!)!.limits.allowPublicRooms) {
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

  // ---------------------------------------------------------------- admin: users

  api.get(
    '/admin/users',
    requireAdmin,
    wrap((_req, res) => {
      res.json({ users: listUsers().map(userView) });
    }),
  );

  api.post(
    '/admin/users',
    requireAdmin,
    wrap((req, res) => {
      const { user, key, expiresAt } = createUser(req.body?.name, req.body?.referralQuota, { presetId: req.body?.presetId, limits: req.body?.limits });
      res.status(201).json({ user: userView(user), key, expiresAt, link: `/activate?key=${key}` });
    }),
  );

  /** `id` plus everyone invited by them, directly or not. */
  const subtree = (id: number): number[] => [id, ...invitedBy(id).flatMap(subtree)];

  api.patch(
    '/admin/users/:id',
    requireAdmin,
    wrap((req, res) => {
      const id = idParam(req);
      const user = updateUser(id, req.body ?? {});
      // New limits reach the user's open pages and their running streams at once (and those of anyone they invited).
      if (req.body?.limits !== undefined || req.body?.presetId !== undefined) {
        for (const uid of withInvitees([id])) live.refreshLimits(uid);
      }
      if (req.body?.status === 'disabled') {
        const ids = req.body.cascade === true ? subtree(id) : [id];
        for (const gid of ids) {
          if (gid !== id) updateUser(gid, { status: 'disabled' });
          revokeUserSessions(gid);
          live.stopUserStreams('This account was disabled', gid);
        }
      }
      res.json({ user: userView(getUser(user.id)!) });
    }),
  );

  // "Use temporarily": a short session as that user, for debugging. The admin keeps their own token on the client.
  api.post(
    '/admin/users/:id/impersonate',
    requireAdmin,
    wrap((req, res) => {
      const user = getUser(idParam(req));
      if (!user) throw new HttpError(404, 'User not found');
      if (user.status !== 'active') throw new HttpError(400, 'Only active users can be used (pending and disabled accounts cannot sign in)');
      console.log(`[admin] using the account of "${user.name}" (${req.ip})`);
      res.json({ token: createSession({ role: 'user', userId: user.id }, false, 2 * 60 * 60 * 1000), name: user.name });
    }),
  );

  /** The user who invited `id` (only the direct referrer, not the people above them). */
  const referrerOf = (id: number): number[] => {
    const by = getUser(id)?.invitedBy;
    return by ? [by] : [];
  };

  api.post(
    '/admin/users/:id/appeal/deny',
    requireAdmin,
    wrap((req, res) => {
      denyAppeal(idParam(req), req.body?.reply);
      res.json({ users: listUsers().map(userView) });
    }),
  );

  api.post(
    '/admin/users/:id/restrict',
    requireAdmin,
    wrap((req, res) => {
      const id = idParam(req);
      const user = getUser(id);
      if (!user) throw new HttpError(404, 'User not found');
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
      const withChildren = req.body?.children !== false; // on unless explicitly turned off
      const withParents = req.body?.parents === true;
      const targets = new Map<number, string>([[id, reason || 'The administrator restricted your account.']]);
      if (withChildren) {
        for (const c of subtree(id).slice(1)) {
          targets.set(c, `Your referrer ${user.name} was restricted${reason ? ': ' + reason : '.'}`);
        }
      }
      if (withParents) {
        for (const p of referrerOf(id)) {
          targets.set(p, `${user.name}, someone you referred, was restricted${reason ? ': ' + reason : '.'}`);
        }
      }
      for (const [uid, why] of targets) {
        // someone already restricted for their own reasons keeps that restriction (and its explanation)
        if (uid !== id && getUser(uid)?.restricted) continue;
        setRestriction(uid, true, why, uid === id ? null : id);
        for (const r of listRooms(uid)) live.closeRoom(r.id, 'This account is restricted');
        live.refreshLimits(uid);
      }
      res.json({ restricted: [...targets.keys()], users: listUsers().map(userView) });
    }),
  );

  api.post(
    '/admin/users/:id/unrestrict',
    requireAdmin,
    wrap((req, res) => {
      const id = idParam(req);
      if (!getUser(id)) throw new HttpError(404, 'User not found');
      const ids = new Set<number>([id]);
      // only those whose restriction was caused by this user
      const causedHere = (uid: number): boolean => getUser(uid)?.restrictedBy === id;
      if (req.body?.children !== false) for (const c of subtree(id).slice(1)) if (causedHere(c)) ids.add(c);
      if (req.body?.parents === true) for (const p of referrerOf(id)) if (causedHere(p)) ids.add(p);
      for (const uid of ids) setRestriction(uid, false);
      res.json({ lifted: [...ids], users: listUsers().map(userView) });
    }),
  );

  api.post(
    '/admin/users/:id/key',
    requireAdmin,
    wrap((req, res) => {
      const { key, expiresAt } = reissueActivationKey(idParam(req));
      res.json({ key, expiresAt, link: `/activate?key=${key}` });
    }),
  );

  api.delete(
    '/admin/users/:id',
    requireAdmin,
    wrap((req, res) => {
      const id = idParam(req);
      if (!getUser(id)) throw new HttpError(404, 'User not found');
      for (const r of listRooms(id)) live.closeRoom(r.id, 'This account was removed');
      revokeUserSessions(id);
      deleteUser(id);
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- admin: limit presets

  api.get(
    '/admin/presets',
    requireAdmin,
    wrap((_req, res) => {
      res.json({ presets: listPresets() });
    }),
  );

  api.post(
    '/admin/presets',
    requireAdmin,
    wrap((req, res) => {
      res.status(201).json({ preset: createPreset(req.body?.name, req.body?.limits, req.body?.isDefault) });
    }),
  );

  api.patch(
    '/admin/presets/:id',
    requireAdmin,
    wrap((req, res) => {
      const { preset, userIds } = updatePreset(idParam(req), req.body ?? {});
      // Everyone following the preset (and the people they invited) gets the new limits immediately.
      if (req.body?.limits !== undefined) for (const uid of withInvitees(userIds)) live.refreshLimits(uid);
      res.json({ preset });
    }),
  );

  api.delete(
    '/admin/presets/:id',
    requireAdmin,
    wrap((req, res) => {
      deletePreset(idParam(req));
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
      if (settings.userStreamsPaused) live.stopUserStreams('User streaming was paused by the admin');
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

