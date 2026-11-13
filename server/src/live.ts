import crypto from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { types } from 'mediasoup';
import { getUser, monthlyBytes } from './accounts.js';
import type { BudgetManager } from './budget.js';
import { config } from './config.js';
import { getSession, onRevoke, type Principal } from './auth.js';
import { getGlobals } from './globals.js';
import type { Limits } from './limits.js';
import { deleteRoom, getRoomById, getRoomBySlug, type Room } from './rooms.js';
import type { Sfu } from './sfu.js';

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; error: string }) => void;

/** Errors safe to show to the client (as opposed to unexpected internal errors). */
class ClientError extends Error {}

interface TrackedTransport {
  transport: types.WebRtcTransport;
  lastBytes: number;
}

export interface ConsumerInfo {
  consumer: types.Consumer;
  /** Spatial layers available (1 = single quality). */
  spatialLayers: number;
  /** Viewer's choice: -1 = auto (best the server allows), otherwise a layer index. */
  pref: number;
}

export interface Peer {
  socket: Socket;
  principal: Principal | null;
  roomId: string | null;
  isOwner: boolean;
  ip: string;
  /** True once this viewer has passed the bandwidth admission check for the current stream. */
  admitted: boolean;
  hidden: boolean;
  transports: Map<string, types.WebRtcTransport>;
  producers: Map<string, types.Producer>;
  consumers: Map<string, ConsumerInfo>;
}

export interface RoomRuntime {
  room: Room;
  router: types.Router;
  producers: Map<string, types.Producer>;
  viewerIds: Set<string>;
  ownerSocketId: string | null;
  startedAt: number | null;
  idleSince: number | null;
  endTimer?: ReturnType<typeof setTimeout>;
  /** Bits per second one more viewer would cost (measured from the incoming stream). */
  perViewerBps: number;
  egressBps: number;
  ingressBps: number;
  viewerTransports: Map<string, TrackedTransport>;
  ownerTransports: Map<string, TrackedTransport>;
}

const spatialLayersOf = (c: types.Consumer): number => {
  const mode = c.rtpParameters.encodings?.[0]?.scalabilityMode;
  const m = typeof mode === 'string' ? /^[LS](\d)/.exec(mode) : null;
  return m ? Number(m[1]) : 1;
};

const OWNER_GRACE_MS = Number(process.env['OWNER_GRACE_MS']) || 15_000;

export class LiveService {
  readonly runtimes = new Map<string, RoomRuntime>();
  readonly peers = new Map<string, Peer>();
  private readonly ipConnections = new Map<string, Set<string>>();
  budget!: BudgetManager;

  constructor(
    readonly io: Server,
    private readonly sfu: Sfu,
  ) {}

  // ------------------------------------------------------------------ public helpers

  isLive(rt?: RoomRuntime): boolean {
    return !!rt && [...rt.producers.values()].some((p) => p.kind === 'video');
  }

  info(roomId: string): { live: boolean; viewers: number } {
    const rt = this.runtimes.get(roomId);
    return { live: this.isLive(rt), viewers: rt?.viewerIds.size ?? 0 };
  }

  /** Spatial layer cap the viewers of this room currently get (budget pressure lowers it for users). */
  layerCapFor(rt: RoomRuntime): number {
    return rt.room.ownerId === null ? 2 : this.budget.layerCap;
  }

  updateRoomSnapshot(room: Room): void {
    const rt = this.runtimes.get(room.id);
    if (rt) rt.room = room;
  }

  endStream(rt: RoomRuntime, reason: string): void {
    this.io.to(`o:${rt.room.id}`).emit('streamEnded', { reason });
    for (const t of [...rt.ownerTransports.values()]) t.transport.close();
  }

  kickViewers(roomId: string, reason: string): void {
    const rt = this.runtimes.get(roomId);
    if (!rt) return;
    for (const id of [...rt.viewerIds]) {
      const peer = this.peers.get(id);
      if (!peer) continue;
      peer.socket.emit('kicked', { reason });
      this.leaveRoom(peer);
    }
  }

  /** Ends the room's stream and removes its viewers (room deleted or made private). */
  closeRoom(roomId: string, reason: string): void {
    const rt = this.runtimes.get(roomId);
    if (!rt) return;
    this.endStream(rt, reason);
    this.kickViewers(roomId, reason);
    this.maybeDestroy(rt);
  }

  /** Ends the stream when `maxMinutes` have passed since it started (0 = no limit). */
  private scheduleTimeLimit(rt: RoomRuntime, maxMinutes: number): void {
    clearTimeout(rt.endTimer);
    rt.endTimer = undefined;
    if (maxMinutes <= 0 || !rt.startedAt) return;
    const left = maxMinutes * 60_000 - (Date.now() - rt.startedAt);
    if (left <= 0) {
      this.endStream(rt, `Time limit of ${maxMinutes} minutes reached`);
      return;
    }
    rt.endTimer = setTimeout(() => this.endStream(rt, `Time limit of ${maxMinutes} minutes reached`), left);
  }

  /**
   * Called when a user's limits changed (preset edited, preset switched, limits edited, inviter changed):
   * tells every page that user has open, and applies the new limits to what is live right now.
   */
  refreshLimits(userId: number): void {
    const user = getUser(userId);
    if (!user) return;
    const limits = user.limits;
    this.io.to(`u:${userId}`).emit('limits', { limits });

    const rooms = [...this.runtimes.values()].filter((rt) => rt.room.ownerId === userId);
    for (const rt of rooms) {
      // ceiling on what the connection may carry, as when it was created
      const cap = Math.round(limits.maxBitrateMbps * 1.7e6 + 0.3e6);
      for (const t of rt.ownerTransports.values()) t.transport.setMaxIncomingBitrate(cap).catch(() => undefined);
      if (!limits.allowAudio) {
        for (const p of [...rt.producers.values()]) {
          if (p.kind !== 'audio') continue;
          p.close();
          this.io.to(`o:${rt.room.id}`).emit('limitsEnforced', { kind: 'audio', message: 'Audio was turned off: your account no longer allows it.' });
        }
      }
      if (this.isLive(rt)) this.scheduleTimeLimit(rt, limits.maxStreamMinutes);
    }
    // fewer simultaneous streams allowed than are running: the most recently started ones end
    const running = rooms.filter((rt) => this.isLive(rt)).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    while (running.length > limits.maxStreams) {
      this.endStream(running.shift()!, `Your limit was lowered to ${limits.maxStreams} simultaneous stream(s)`);
    }
  }

  stopUserStreams(reason: string, userId?: number): void {
    for (const rt of [...this.runtimes.values()]) {
      if (rt.room.ownerId === null) continue;
      if (userId !== undefined && rt.room.ownerId !== userId) continue;
      if (this.isLive(rt)) this.endStream(rt, reason);
    }
  }

  applyAllLayers(): void {
    for (const peer of this.peers.values()) for (const ci of peer.consumers.values()) this.applyLayers(peer, ci);
  }

  // ------------------------------------------------------------------ wiring

  attach(): void {
    this.io.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      const principal = getSession(token);
      socket.data.principal = principal;
      socket.data.token = principal ? token : undefined;
      next();
    });
    onRevoke((tokens) => {
      const set = new Set(tokens);
      for (const s of this.io.sockets.sockets.values()) {
        if (s.data.token && set.has(s.data.token)) {
          s.emit('sessionRevoked');
          s.disconnect(true);
        }
      }
    });
    this.io.on('connection', (socket) => this.onConnection(socket));
  }

  private clientIp(socket: Socket): string {
    if (config.trustProxy) {
      const xff = socket.handshake.headers['x-forwarded-for'];
      const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return socket.handshake.address;
  }

  private onConnection(socket: Socket): void {
    const principal: Principal | null = socket.data.principal;
    const peer: Peer = {
      socket,
      principal,
      roomId: null,
      isOwner: false,
      ip: this.clientIp(socket),
      admitted: false,
      hidden: false,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    this.peers.set(socket.id, peer);
    if (principal?.role === 'admin') {
      socket.join('admin');
      socket.emit('bandwidth', this.budget.view());
    }
    // Every page a user has open hears about changes to their limits.
    if (principal?.role === 'user') socket.join(`u:${principal.userId}`);

    const on = (event: string, fn: (data: any) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void) => {
      socket.on(event, async (data: any, ack?: Ack) => {
        if (typeof data === 'function') {
          ack = data;
          data = {};
        }
        try {
          const res = (await fn(data ?? {})) ?? {};
          ack?.({ ok: true, ...res });
        } catch (err) {
          if (!(err instanceof ClientError)) console.error(`[live] ${event}:`, err);
          ack?.({ ok: false, error: err instanceof ClientError ? err.message : 'Internal error' });
        }
      });
    };

    const joined = () => {
      const rt = peer.roomId ? this.runtimes.get(peer.roomId) : undefined;
      if (!rt) throw new ClientError('Join a room first');
      return rt;
    };
    const needOwner = () => {
      if (!peer.isOwner) throw new ClientError('Not authorized');
      return joined();
    };
    const transportOf = (id: string) => {
      const t = peer.transports.get(id);
      if (!t) throw new ClientError('Unknown transport');
      return t;
    };

    on('joinRoom', (d) => this.joinRoom(peer, d));

    on('createTransport', async ({ direction }: { direction: 'send' | 'recv' }) => {
      const rt = direction === 'send' ? needOwner() : joined();
      const user = rt.room.ownerId === null ? null : getUser(rt.room.ownerId);
      const t = await rt.router.createWebRtcTransport({
        webRtcServer: this.sfu.webRtcServer,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: config.rtc.initialOutgoingBitrate,
      });
      if (direction === 'send') {
        // Hard cap on what this streamer can push, whatever their browser claims. The allowance covers
        // the extra simulcast layers and audio on top of the main stream.
        const cap = user ? Math.round(user.limits.maxBitrateMbps * 1.7e6 + 0.3e6) : config.rtc.maxIncomingBitrate;
        await t.setMaxIncomingBitrate(cap);
      }
      peer.transports.set(t.id, t);
      const tracked = { transport: t, lastBytes: 0 };
      (direction === 'send' ? rt.ownerTransports : rt.viewerTransports).set(t.id, tracked);
      t.on('@close', () => {
        peer.transports.delete(t.id);
        rt.ownerTransports.delete(t.id);
        rt.viewerTransports.delete(t.id);
      });
      return { id: t.id, iceParameters: t.iceParameters, iceCandidates: t.iceCandidates, dtlsParameters: t.dtlsParameters };
    });

    on('connectTransport', async ({ transportId, dtlsParameters }) => {
      await transportOf(transportId).connect({ dtlsParameters });
    });

    on('closeTransport', ({ transportId }) => {
      peer.transports.get(transportId)?.close();
    });

    on('produce', async ({ transportId, kind, rtpParameters, appData }) => {
      const rt = needOwner();
      if (kind !== 'video' && kind !== 'audio') throw new ClientError('Invalid kind');
      if ([...rt.producers.values()].some((p) => p.kind === kind)) throw new ClientError(`This room already has a ${kind} stream`);
      const user = rt.room.ownerId === null ? null : getUser(rt.room.ownerId);
      if (rt.room.ownerId !== null && user?.status !== 'active') throw new ClientError('Account disabled');
      if (rt.room.ownerId !== null && user?.restricted) throw new ClientError('Your account is restricted');
      if (kind === 'audio' && user && !user.limits.allowAudio) throw new ClientError('Audio is not allowed for your account');
      if (kind === 'video') this.checkCanStart(rt, user?.limits ?? null, user?.id ?? null);

      const producer = await transportOf(transportId).produce({
        kind,
        rtpParameters,
        appData: { source: typeof appData?.source === 'string' ? appData.source.slice(0, 20) : kind },
      });
      peer.producers.set(producer.id, producer);
      rt.producers.set(producer.id, producer);
      const gone = () => {
        peer.producers.delete(producer.id);
        if (!rt.producers.delete(producer.id)) return;
        this.io.to(`v:${rt.room.id}`).emit('producerClosed', { producerId: producer.id });
        if (!this.isLive(rt)) this.onStreamStopped(rt);
        this.broadcastState(rt);
        this.maybeDestroy(rt);
      };
      producer.on('transportclose', gone);
      producer.on('@close', gone);

      if (kind === 'video') {
        rt.startedAt = Date.now();
        rt.idleSince = rt.viewerIds.size === 0 ? Date.now() : null;
        this.scheduleTimeLimit(rt, user?.limits.maxStreamMinutes ?? 0);
      }
      this.io.to(`v:${rt.room.id}`).emit('newProducer', { producerId: producer.id, kind });
      this.broadcastState(rt);
      return { id: producer.id };
    });

    on('closeProducer', ({ producerId }) => {
      needOwner();
      peer.producers.get(producerId)?.close();
    });

    on('getProducers', () => {
      const rt = joined();
      return { producers: [...rt.producers.values()].map((p) => ({ id: p.id, kind: p.kind })) };
    });

    on('consume', async ({ transportId, producerId, rtpCapabilities }) => {
      const rt = joined();
      const producer = rt.producers.get(producerId);
      if (!producer) throw new ClientError('Producer not found');
      if (!rt.router.canConsume({ producerId, rtpCapabilities })) throw new ClientError('Your browser cannot play this video format. The streamer can switch to VP8, which every browser plays.');
      if (!peer.isOwner && !peer.admitted) {
        if (!this.budget.admitViewer(rt)) throw new ClientError('The server is at full capacity right now. Please try again in a moment.');
        peer.admitted = true;
      }
      const consumer = await transportOf(transportId).consume({ producerId, rtpCapabilities, paused: true });
      const ci: ConsumerInfo = { consumer, spatialLayers: spatialLayersOf(consumer), pref: -1 };
      peer.consumers.set(consumer.id, ci);
      consumer.on('producerclose', () => {
        if (peer.consumers.delete(consumer.id)) {
          socket.emit('consumerClosed', { consumerId: consumer.id });
          if (peer.consumers.size === 0) peer.admitted = false;
        }
      });
      consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
      return {
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        spatialLayers: ci.spatialLayers,
      };
    });

    on('resumeConsumer', async ({ consumerId }) => {
      const ci = peer.consumers.get(consumerId);
      if (!ci) throw new ClientError('Unknown consumer');
      this.applyLayers(peer, ci);
      if (!peer.hidden) await ci.consumer.resume();
    });

    on('setQuality', ({ consumerId, quality }) => {
      const ci = peer.consumers.get(consumerId);
      if (!ci) throw new ClientError('Unknown consumer');
      const map: Record<string, number> = { auto: -1, high: 2, medium: 1, low: 0 };
      if (!(quality in map)) throw new ClientError('Invalid quality');
      ci.pref = map[quality];
      this.applyLayers(peer, ci);
    });

    /** Hidden tabs stop receiving video, which saves server bandwidth. */
    on('setPaused', async ({ paused }) => {
      peer.hidden = !!paused;
      for (const ci of peer.consumers.values()) {
        if (ci.consumer.kind !== 'video') continue;
        if (peer.hidden) await ci.consumer.pause();
        else await ci.consumer.resume();
      }
    });

    socket.on('disconnect', () => {
      this.leaveRoom(peer);
      this.peers.delete(socket.id);
    });
  }

  // ------------------------------------------------------------------ rooms

  private async joinRoom(peer: Peer, d: { slug?: unknown; key?: unknown }) {
    if (typeof d.slug !== 'string') throw new ClientError('Room not found');
    const room = getRoomBySlug(d.slug);
    const p = peer.principal;
    const owner = !!room && !!p && ((p.role === 'admin' && room.ownerId === null) || (p.role === 'user' && p.userId === room.ownerId));
    const ownerUser = room?.ownerId != null ? getUser(room.ownerId) : undefined;

    let allowed = !!room && (room.ownerId === null || ownerUser?.status === 'active' && !ownerUser.restricted);
    if (room && allowed && !owner && room.visibility === 'private') {
      const given = Buffer.from(typeof d.key === 'string' ? d.key : '');
      const real = Buffer.from(room.secret);
      allowed = given.length === real.length && crypto.timingSafeEqual(given, real);
    }
    // Private rooms and disabled owners look exactly like rooms that don't exist.
    if (!room || !allowed) throw new ClientError('Room not found');

    this.leaveRoom(peer);

    let rt = this.runtimes.get(room.id);
    if (!rt) {
      rt = {
        room,
        router: await this.sfu.createRouter(),
        producers: new Map(),
        viewerIds: new Set(),
        ownerSocketId: null,
        startedAt: null,
        idleSince: null,
        perViewerBps: 0,
        egressBps: 0,
        ingressBps: 0,
        viewerTransports: new Map(),
        ownerTransports: new Map(),
      };
      this.runtimes.set(room.id, rt);
    }
    rt.room = room;

    if (owner) {
      if (rt.ownerSocketId && rt.ownerSocketId !== peer.socket.id) {
        this.maybeDestroy(rt);
        throw new ClientError('This room is already open in another window');
      }
      rt.ownerSocketId = peer.socket.id;
      peer.socket.join(`o:${room.id}`);
    } else {
      const maxViewers = ownerUser ? ownerUser.limits.maxViewersPerRoom : Infinity;
      if (rt.viewerIds.size >= maxViewers) {
        this.maybeDestroy(rt);
        throw new ClientError('This room is full');
      }
      const maxPerIp = getGlobals().maxConnectionsPerIp;
      const set = this.ipConnections.get(peer.ip) ?? new Set<string>();
      if (maxPerIp > 0 && set.size >= maxPerIp) {
        this.maybeDestroy(rt);
        throw new ClientError('Too many connections from your network');
      }
      set.add(peer.socket.id);
      this.ipConnections.set(peer.ip, set);
      rt.viewerIds.add(peer.socket.id);
      peer.socket.join(`v:${room.id}`);
    }
    peer.roomId = room.id;
    peer.isOwner = owner;
    peer.admitted = false;
    this.emitViewerCount(rt);

    return {
      room: { slug: room.slug, name: room.name, visibility: room.visibility, ownerName: ownerUser?.name ?? 'Admin' },
      role: owner ? 'owner' : 'viewer',
      live: this.isLive(rt),
      rtpCapabilities: rt.router.rtpCapabilities,
      limits: owner ? (ownerUser?.limits ?? null) : undefined,
    };
  }

  private leaveRoom(peer: Peer): void {
    const rt = peer.roomId ? this.runtimes.get(peer.roomId) : undefined;
    for (const t of [...peer.transports.values()]) t.close(); // also closes its producers and consumers
    peer.consumers.clear();
    const set = this.ipConnections.get(peer.ip);
    if (set) {
      set.delete(peer.socket.id);
      if (set.size === 0) this.ipConnections.delete(peer.ip);
    }
    if (rt) {
      peer.socket.leave(`v:${rt.room.id}`);
      peer.socket.leave(`o:${rt.room.id}`);
      if (peer.isOwner && rt.ownerSocketId === peer.socket.id) {
        rt.ownerSocketId = null;
        this.scheduleOwnerGone(rt.room.id);
      }
      rt.viewerIds.delete(peer.socket.id);
      this.emitViewerCount(rt);
      this.maybeDestroy(rt);
    }
    peer.roomId = null;
    peer.isOwner = false;
    peer.admitted = false;
  }

  /**
   * Public rooms exist only while their owner is online. A short grace period lets a page reload or a
   * reconnect keep the room; the permanent main room is never removed.
   */
  private scheduleOwnerGone(roomId: string): void {
    setTimeout(() => {
      const room = getRoomById(roomId);
      if (!room || room.visibility !== 'public' || room.slug === 'main') return;
      if (this.runtimes.get(roomId)?.ownerSocketId) return; // the owner came back
      this.closeRoom(roomId, 'The owner went offline, so this public room was removed');
      deleteRoom(roomId);
    }, OWNER_GRACE_MS).unref();
  }

  private onStreamStopped(rt: RoomRuntime): void {
    clearTimeout(rt.endTimer);
    rt.endTimer = undefined;
    rt.startedAt = null;
    rt.idleSince = null;
    rt.perViewerBps = 0;
    rt.egressBps = 0;
    rt.ingressBps = 0;
  }

  private maybeDestroy(rt: RoomRuntime): void {
    if (this.runtimes.get(rt.room.id) !== rt) return;
    if (rt.viewerIds.size > 0 || rt.ownerSocketId || this.isLive(rt)) return;
    clearTimeout(rt.endTimer);
    rt.router.close();
    this.runtimes.delete(rt.room.id);
  }

  private broadcastState(rt: RoomRuntime): void {
    this.io.to([`v:${rt.room.id}`, `o:${rt.room.id}`]).emit('streamState', { live: this.isLive(rt) });
  }

  private emitViewerCount(rt: RoomRuntime): void {
    this.io.to(`o:${rt.room.id}`).emit('viewerCount', rt.viewerIds.size);
  }

  private checkCanStart(rt: RoomRuntime, limits: Limits | null, userId: number | null): void {
    if (userId === null || !limits) return; // the admin's own streams are never refused here
    const g = getGlobals();
    if (g.userStreamsPaused) throw new ClientError('User streaming is paused by the admin right now');
    const liveRooms = [...this.runtimes.values()].filter((r) => r !== rt && r.room.ownerId === userId && this.isLive(r)).length;
    if (liveRooms >= limits.maxStreams) throw new ClientError(`You can only stream in ${limits.maxStreams} room(s) at the same time`);
    if (limits.monthlyGb > 0 && monthlyBytes(userId) >= limits.monthlyGb * 1e9) throw new ClientError('Your monthly traffic quota is used up');
    if (!this.budget.admitStream(limits.maxBitrateMbps * 1e6)) throw new ClientError('The server cannot take another stream right now. Please try again later.');
  }

  private applyLayers(peer: Peer, ci: ConsumerInfo): void {
    if (ci.consumer.kind !== 'video' || ci.spatialLayers <= 1) return;
    const rt = peer.roomId ? this.runtimes.get(peer.roomId) : undefined;
    if (!rt) return;
    const wanted = ci.pref < 0 ? ci.spatialLayers - 1 : Math.min(ci.pref, ci.spatialLayers - 1);
    const spatialLayer = Math.min(wanted, this.layerCapFor(rt));
    ci.consumer.setPreferredLayers({ spatialLayer, temporalLayer: 2 }).catch(() => undefined);
  }
}
