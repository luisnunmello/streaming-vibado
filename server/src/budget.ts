import { addUsage, getUser, monthlyBytes } from './accounts.js';
import { getGlobals } from './globals.js';
import type { LiveService, RoomRuntime } from './live.js';

const TICK_MS = 3000;
const FLUSH_MS = 30_000;
const MAX_LAYER = 2;

export interface BandwidthView {
  /** Measured, in Mbps. */
  egress: { user: number; admin: number; total: number };
  ingress: { user: number; admin: number; total: number };
  budget: { egressMbps: number; userEgressMbps: number; ingressMbps: number };
  /** Highest quality layer user viewers currently get (2 = best). Lower means the server is under pressure. */
  layerCap: number;
  userStreamsPaused: boolean;
  rooms: {
    id: string;
    name: string;
    slug: string;
    owner: string;
    live: boolean;
    viewers: number;
    egressMbps: number;
    ingressMbps: number;
  }[];
}

/**
 * Measures real traffic and applies the protection rules:
 * admission control, quality-layer degradation, idle/quota stops, usage accounting.
 */
export class BudgetManager {
  /** Spatial layer ceiling for user viewers (0..2). */
  layerCap = MAX_LAYER;
  private calmTicks = 0;
  private egressUser = 0;
  private egressAdmin = 0;
  private ingressUser = 0;
  private ingressAdmin = 0;
  /** Bits/s promised to viewers/streams admitted since the last measurement. */
  private pendingEgress = 0;
  private pendingIngress = 0;
  private pendingUsage = new Map<number, number>();
  private lastTick = Date.now();
  private lastFlush = Date.now();
  private running = false;
  private timer?: ReturnType<typeof setInterval>;
  private cached: BandwidthView;

  constructor(private readonly live: LiveService) {
    this.cached = this.buildView();
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    this.flushUsage();
  }

  /** Measurements are refreshed every few seconds; settings are always current. */
  view(): BandwidthView {
    const g = getGlobals();
    return {
      ...this.cached,
      budget: {
        egressMbps: g.egressBudgetMbps,
        userEgressMbps: Math.round(g.egressBudgetMbps * (1 - g.adminReservePct / 100)),
        ingressMbps: g.ingressBudgetMbps,
      },
      userStreamsPaused: g.userStreamsPaused,
    };
  }

  // ------------------------------------------------------------------ admission control

  /** Would one more viewer of this room fit in the budget? */
  admitViewer(rt: RoomRuntime): boolean {
    const g = getGlobals();
    const cost = rt.perViewerBps || this.defaultCost(rt);
    const total = this.egressUser + this.egressAdmin + this.pendingEgress;
    const budget = g.egressBudgetMbps * 1e6;
    if (total + cost > budget) return false;
    if (rt.room.ownerId !== null) {
      const userBudget = budget * (1 - g.adminReservePct / 100);
      if (this.egressUser + this.pendingEgress + cost > userBudget) return false;
    }
    this.pendingEgress += cost;
    return true;
  }

  /** Is there ingress room for a new stream of up to `maxBps`? */
  admitStream(maxBps: number): boolean {
    const budget = getGlobals().ingressBudgetMbps * 1e6;
    if (this.ingressUser + this.ingressAdmin + this.pendingIngress + maxBps > budget) return false;
    this.pendingIngress += maxBps;
    return true;
  }

  private defaultCost(rt: RoomRuntime): number {
    const user = rt.room.ownerId === null ? null : getUser(rt.room.ownerId);
    return user ? user.limits.maxBitrateMbps * 1e6 : 8e6;
  }

  // ------------------------------------------------------------------ measuring

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      const dt = Math.max(0.5, (now - this.lastTick) / 1000);
      this.lastTick = now;
      const g = getGlobals();
      let egG = 0;
      let egA = 0;
      let inG = 0;
      let inA = 0;

      for (const rt of [...this.live.runtimes.values()]) {
        const owner = rt.room.ownerId;
        const sentBytes = await this.sample(rt.viewerTransports, 'bytesSent');
        const recvBytes = await this.sample(rt.ownerTransports, 'bytesReceived');
        rt.egressBps = (sentBytes * 8) / dt;
        rt.ingressBps = (recvBytes * 8) / dt;
        if (owner === null) {
          egA += rt.egressBps;
          inA += rt.ingressBps;
        } else {
          egG += rt.egressBps;
          inG += rt.ingressBps;
          if (sentBytes > 0) this.pendingUsage.set(owner, (this.pendingUsage.get(owner) ?? 0) + sentBytes);
        }
        await this.estimateCost(rt);
        this.enforceStops(rt, now, g.idleStopMinutes);
      }

      this.egressUser = egG;
      this.egressAdmin = egA;
      this.ingressUser = inG;
      this.ingressAdmin = inA;
      this.pendingEgress = 0;
      this.pendingIngress = 0;

      this.adjustLayers(g.egressBudgetMbps * 1e6, g.adminReservePct);
      if (now - this.lastFlush >= FLUSH_MS) this.flushUsage();

      this.cached = this.buildView();
      this.live.io.to("admin").emit("bandwidth", this.view());
    } catch (e) {
      console.error('[budget] tick failed:', e);
    } finally {
      this.running = false;
    }
  }

  /** Bytes moved since the previous sample, summed over a room's transports. */
  private async sample(transports: RoomRuntime['viewerTransports'], field: 'bytesSent' | 'bytesReceived'): Promise<number> {
    let delta = 0;
    for (const t of transports.values()) {
      try {
        const [stat] = await t.transport.getStats();
        const bytes = stat[field];
        delta += Math.max(0, bytes - t.lastBytes);
        t.lastBytes = bytes;
      } catch {
        /* transport closing */
      }
    }
    return delta;
  }

  /** What one more viewer costs: the biggest single layer of the incoming stream, plus audio. */
  private async estimateCost(rt: RoomRuntime): Promise<void> {
    let video = 0;
    let audio = 0;
    for (const p of rt.producers.values()) {
      try {
        const stats = await p.getStats();
        const rates = stats.map((s) => s.bitrate ?? 0);
        if (p.kind === 'video') video = Math.max(video, ...rates, 0);
        else audio = Math.max(audio, ...rates, 0);
      } catch {
        /* producer closing */
      }
    }
    rt.perViewerBps = video + audio;
  }

  private enforceStops(rt: RoomRuntime, now: number, idleMinutes: number): void {
    if (rt.room.ownerId === null || !this.live.isLive(rt)) return;
    // idle: nobody is watching
    if (rt.viewerIds.size === 0) {
      rt.idleSince ??= now;
      if (idleMinutes > 0 && now - rt.idleSince > idleMinutes * 60_000) {
        this.live.endStream(rt, `Stopped: no viewers for ${idleMinutes} minutes`);
        return;
      }
    } else {
      rt.idleSince = null;
    }
    // monthly quota
    const user = getUser(rt.room.ownerId);
    if (user && user.limits.monthlyGb > 0) {
      const used = monthlyBytes(user.id) + (this.pendingUsage.get(user.id) ?? 0);
      if (used >= user.limits.monthlyGb * 1e9) this.live.endStream(rt, 'Your monthly traffic quota is used up');
    }
  }

  /**
   * Under pressure, user viewers are moved to lower quality layers (streams with layers only);
   * when things calm down they go back up one step at a time.
   */
  private adjustLayers(budgetBps: number, reservePct: number): void {
    const userBudget = budgetBps * (1 - reservePct / 100);
    const total = this.egressUser + this.egressAdmin;
    const hot = this.egressUser > userBudget * 0.95 || total > budgetBps * 0.95;
    const cool = this.egressUser < userBudget * 0.7 && total < budgetBps * 0.8;
    if (hot && this.layerCap > 0) {
      this.layerCap--;
      this.calmTicks = 0;
      this.live.applyAllLayers();
    } else if (cool && this.layerCap < MAX_LAYER) {
      if (++this.calmTicks >= 3) {
        this.layerCap++;
        this.calmTicks = 0;
        this.live.applyAllLayers();
      }
    } else if (!cool) {
      this.calmTicks = 0;
    }
  }

  private flushUsage(): void {
    for (const [userId, bytes] of this.pendingUsage) {
      try {
        addUsage(userId, bytes);
      } catch {
        /* user deleted meanwhile */
      }
    }
    this.pendingUsage.clear();
    this.lastFlush = Date.now();
  }

  // ------------------------------------------------------------------ reporting

  private buildView(): BandwidthView {
    const g = getGlobals();
    const mbps = (bps: number) => Math.round(bps / 1e4) / 100;
    return {
      egress: { user: mbps(this.egressUser), admin: mbps(this.egressAdmin), total: mbps(this.egressUser + this.egressAdmin) },
      ingress: { user: mbps(this.ingressUser), admin: mbps(this.ingressAdmin), total: mbps(this.ingressUser + this.ingressAdmin) },
      budget: {
        egressMbps: g.egressBudgetMbps,
        userEgressMbps: Math.round(g.egressBudgetMbps * (1 - g.adminReservePct / 100)),
        ingressMbps: g.ingressBudgetMbps,
      },
      layerCap: this.layerCap,
      userStreamsPaused: g.userStreamsPaused,
      rooms: [...this.live.runtimes.values()]
        .filter((rt) => this.live.isLive(rt) || rt.viewerIds.size > 0)
        .map((rt) => ({
          id: rt.room.id,
          name: rt.room.name,
          slug: rt.room.slug,
          owner: rt.room.ownerId === null ? 'Admin' : (getUser(rt.room.ownerId)?.name ?? '?'),
          live: this.live.isLive(rt),
          viewers: rt.viewerIds.size,
          egressMbps: mbps(rt.egressBps),
          ingressMbps: mbps(rt.ingressBps),
        })),
    };
  }
}
