import { addUsage, getGuest, monthlyBytes } from './accounts.js';
import { getGlobals } from './globals.js';
import type { LiveService, RoomRuntime } from './live.js';

const TICK_MS = 3000;
const FLUSH_MS = 30_000;
const MAX_LAYER = 2;

export interface BandwidthView {
  /** Measured, in Mbps. */
  egress: { guest: number; admin: number; total: number };
  ingress: { guest: number; admin: number; total: number };
  budget: { egressMbps: number; guestEgressMbps: number; ingressMbps: number };
  /** Highest quality layer guest viewers currently get (2 = best). Lower means the server is under pressure. */
  layerCap: number;
  guestStreamsPaused: boolean;
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
  /** Spatial layer ceiling for guest viewers (0..2). */
  layerCap = MAX_LAYER;
  private calmTicks = 0;
  private egressGuest = 0;
  private egressAdmin = 0;
  private ingressGuest = 0;
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
        guestEgressMbps: Math.round(g.egressBudgetMbps * (1 - g.adminReservePct / 100)),
        ingressMbps: g.ingressBudgetMbps,
      },
      guestStreamsPaused: g.guestStreamsPaused,
    };
  }

  // ------------------------------------------------------------------ admission control

  /** Would one more viewer of this room fit in the budget? */
  admitViewer(rt: RoomRuntime): boolean {
    const g = getGlobals();
    const cost = rt.perViewerBps || this.defaultCost(rt);
    const total = this.egressGuest + this.egressAdmin + this.pendingEgress;
    const budget = g.egressBudgetMbps * 1e6;
    if (total + cost > budget) return false;
    if (rt.room.ownerId !== null) {
      const guestBudget = budget * (1 - g.adminReservePct / 100);
      if (this.egressGuest + this.pendingEgress + cost > guestBudget) return false;
    }
    this.pendingEgress += cost;
    return true;
  }

  /** Is there ingress room for a new stream of up to `maxBps`? */
  admitStream(maxBps: number): boolean {
    const budget = getGlobals().ingressBudgetMbps * 1e6;
    if (this.ingressGuest + this.ingressAdmin + this.pendingIngress + maxBps > budget) return false;
    this.pendingIngress += maxBps;
    return true;
  }

  private defaultCost(rt: RoomRuntime): number {
    const guest = rt.room.ownerId === null ? null : getGuest(rt.room.ownerId);
    return guest ? guest.limits.maxBitrateMbps * 1e6 : 8e6;
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

      this.egressGuest = egG;
      this.egressAdmin = egA;
      this.ingressGuest = inG;
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
    const guest = getGuest(rt.room.ownerId);
    if (guest && guest.limits.monthlyGb > 0) {
      const used = monthlyBytes(guest.id) + (this.pendingUsage.get(guest.id) ?? 0);
      if (used >= guest.limits.monthlyGb * 1e9) this.live.endStream(rt, 'Your monthly traffic quota is used up');
    }
  }

  /**
   * Under pressure, guest viewers are moved to lower quality layers (streams with layers only);
   * when things calm down they go back up one step at a time.
   */
  private adjustLayers(budgetBps: number, reservePct: number): void {
    const guestBudget = budgetBps * (1 - reservePct / 100);
    const total = this.egressGuest + this.egressAdmin;
    const hot = this.egressGuest > guestBudget * 0.95 || total > budgetBps * 0.95;
    const cool = this.egressGuest < guestBudget * 0.7 && total < budgetBps * 0.8;
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
    for (const [guestId, bytes] of this.pendingUsage) {
      try {
        addUsage(guestId, bytes);
      } catch {
        /* guest deleted meanwhile */
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
      egress: { guest: mbps(this.egressGuest), admin: mbps(this.egressAdmin), total: mbps(this.egressGuest + this.egressAdmin) },
      ingress: { guest: mbps(this.ingressGuest), admin: mbps(this.ingressAdmin), total: mbps(this.ingressGuest + this.ingressAdmin) },
      budget: {
        egressMbps: g.egressBudgetMbps,
        guestEgressMbps: Math.round(g.egressBudgetMbps * (1 - g.adminReservePct / 100)),
        ingressMbps: g.ingressBudgetMbps,
      },
      layerCap: this.layerCap,
      guestStreamsPaused: g.guestStreamsPaused,
      rooms: [...this.live.runtimes.values()]
        .filter((rt) => this.live.isLive(rt) || rt.viewerIds.size > 0)
        .map((rt) => ({
          id: rt.room.id,
          name: rt.room.name,
          slug: rt.room.slug,
          owner: rt.room.ownerId === null ? 'Admin' : (getGuest(rt.room.ownerId)?.name ?? '?'),
          live: this.live.isLive(rt),
          viewers: rt.viewerIds.size,
          egressMbps: mbps(rt.egressBps),
          ingressMbps: mbps(rt.ingressBps),
        })),
    };
  }
}
