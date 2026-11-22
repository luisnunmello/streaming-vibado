import { Injectable, inject, signal } from '@angular/core';
import { Device, type types } from 'mediasoup-client';
import { ApiService } from './api.service';
import { SignalingService } from './signaling.service';

export interface ViewerStats {
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  /** Time frames wait in the receive buffer. */
  bufferMs: number;
  lossPct: number;
}

export type Quality = 'auto' | 'high' | 'medium' | 'low';
export type ViewerProblem = 'notfound' | 'kicked' | 'busy' | 'other';

/** Receives a room's live stream from the SFU. Anonymous: no login needed. */
@Injectable({ providedIn: 'root' })
export class ViewerService {
  /** Its own connection: a streamer watching their own room in the same tab keeps their stream connection. */
  private readonly sig = new SignalingService();
  private readonly api = inject(ApiService);

  readonly live = signal(false);
  readonly connecting = signal(true);
  readonly roomName = signal<string | null>(null);
  readonly ownerName = signal<string | null>(null);
  readonly autoName = signal(false);
  readonly error = signal<string | null>(null);
  readonly problem = signal<ViewerProblem | null>(null);
  readonly hasAudio = signal(false);
  readonly stats = signal<ViewerStats | null>(null);
  /** Quality levels the stream offers (1 = only one). */
  readonly layers = signal(1);
  readonly quality = signal<Quality>('auto');
  /** The element's srcObject; stays the same object for the whole session. */
  readonly stream = new MediaStream();
  /** Counts tracks added to the stream, so the page can make sure the element plays them. */
  readonly trackCount = signal(0);

  /** Everyone watching (names are nicknames for anonymous viewers). */
  readonly viewers = signal<{ count: number; names: string[] }>({ count: 0, names: [] });
  /** The name this viewer has in the list, as the server settled it. */
  readonly myName = signal<string | null>(null);

  /** True from start() to stop(): the player page is open (bug reports then carry the player's state). */
  readonly watching = signal(false);

  private slug = '';
  private key: string | undefined;
  private video?: HTMLVideoElement;
  private readonly events: { at: number; msg: string }[] = [];
  private startedAt = 0;
  private nickname: string | undefined;
  private device?: Device;
  private transport?: types.Transport;
  private consumers = new Map<string, types.Consumer>();
  private unsubs: Array<() => void> = [];
  private statsTimer?: ReturnType<typeof setInterval>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private hideTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private blocked = false;
  /** When the connection to the server was lost (the room may need a moment to come back after a restart). */
  private lostAt: number | null = null;
  private pausedSent = false;
  /** Producers being consumed or already consumed (a producer can be announced and listed at once). */
  private consuming = new Set<string>();
  /** Seconds the video has had no decoded frame. */
  private stalled = 0;
  private last = { bytes: 0, at: 0, lost: 0, received: 0 };

  private readonly onVisibility = () => {
    clearTimeout(this.hideTimer);
    if (document.hidden) {
      // A tab nobody looks at should not keep receiving video: saves server bandwidth.
      this.hideTimer = setTimeout(() => this.setPaused(true), 10_000);
    } else {
      this.setPaused(false);
    }
  };

  /** The page hands over its <video> so bug reports can describe what the element is doing. */
  registerVideo(el: HTMLVideoElement | null): void {
    this.video = el ?? undefined;
  }

  /** Short log of what the player did lately (kept small; sent with bug reports). */
  note(msg: string): void {
    this.events.push({ at: Date.now(), msg: msg.slice(0, 160) });
    if (this.events.length > 40) this.events.shift();
  }

  /** `nickname` is used by anonymous viewers; empty means a random one. */
  start(slug: string, key?: string, nickname?: string): void {
    this.stop();
    this.watching.set(true);
    this.startedAt = Date.now();
    this.events.length = 0;
    this.note(`start ${slug}`);
    this.slug = slug;
    this.key = key;
    this.nickname = nickname;
    this.viewers.set({ count: 0, names: [] });
    this.blocked = false;
    this.lostAt = null;
    this.problem.set(null);
    this.error.set(null);
    this.roomName.set(null);
    this.connecting.set(true);
    this.sig.open();
    this.unsubs.push(
      this.sig.on('connect', () => {
        this.note('socket connected');
        void this.setup();
      }),
      this.sig.on<string>('disconnect', (reason) => {
        this.note(`socket disconnected (${reason})`);
        this.lostAt ??= Date.now();
        this.teardown();
        this.connecting.set(true);
      }),
      this.sig.on<{ live: boolean }>('streamState', (s) => {
        this.note(`stream live=${s.live}`);
        this.live.set(s.live);
      }),
      this.sig.on<{ count: number; names: string[] }>('viewers', (v) => this.viewers.set(v)),
      this.sig.on<{ producerId: string }>('newProducer', ({ producerId }) => {
        this.note('newProducer');
        void this.consume(producerId, this.generation);
      }),
      this.sig.on<{ producerId: string }>('producerClosed', ({ producerId }) => this.removeByProducer(producerId)),
      this.sig.on<{ reason: string }>('kicked', ({ reason }) => {
        this.note(`kicked: ${reason}`);
        this.blocked = true;
        clearTimeout(this.retryTimer);
        this.teardown();
        this.live.set(false);
        this.connecting.set(false);
        this.problem.set('kicked');
        this.error.set(reason);
      }),
    );
    document.addEventListener('visibilitychange', this.onVisibility);
    this.statsTimer = setInterval(() => void this.collectStats(), 1000);
  }

  stop(): void {
    this.watching.set(false);
    clearInterval(this.statsTimer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.hideTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.teardown();
    this.sig.close();
    this.live.set(false);
  }

  /**
   * A snapshot of the player for bug reports: connection, tracks, the <video> element, receive statistics and the
   * latest events. Everything here is read-only and small (a few KB). Network addresses are left out.
   */
  async diagnostics(): Promise<Record<string, unknown>> {
    const now = Date.now();
    const v = this.video;
    const q = v?.getVideoPlaybackQuality?.();
    const trackInfo = (t: MediaStreamTrack) => ({ kind: t.kind, readyState: t.readyState, muted: t.muted, enabled: t.enabled });
    const withTimeout = <T>(p: Promise<T>): Promise<T | undefined> =>
      Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), 2000))]).catch(() => undefined);

    let inbound: Record<string, unknown> | undefined;
    let net: Record<string, unknown> | undefined;
    const video = [...this.consumers.values()].find((c) => c.kind === 'video');
    const rep = video ? await withTimeout(video.getStats()) : undefined;
    rep?.forEach((r: any) => {
      if (r.type !== 'inbound-rtp' || r.kind !== 'video') return;
      const keep = [
        'framesReceived', 'framesDecoded', 'framesDropped', 'keyFramesDecoded', 'frameWidth', 'frameHeight', 'framesPerSecond',
        'packetsReceived', 'packetsLost', 'bytesReceived', 'jitter', 'nackCount', 'pliCount', 'firCount', 'freezeCount',
        'totalFreezesDuration', 'pauseCount', 'decoderImplementation', 'powerEfficientDecoder', 'jitterBufferDelay', 'jitterBufferEmittedCount',
      ];
      inbound = Object.fromEntries(keep.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
    });
    const trep = this.transport ? await withTimeout(this.transport.getStats()) : undefined;
    if (trep) {
      const byId = new Map<string, any>();
      trep.forEach((r: any) => byId.set(r.id, r));
      const tr = [...byId.values()].find((r) => r.type === 'transport');
      const pair = tr?.selectedCandidatePairId ? byId.get(tr.selectedCandidatePairId) : [...byId.values()].find((r) => r.type === 'candidate-pair' && r.nominated);
      if (pair) {
        net = {
          pairState: pair.state,
          rttMs: pair.currentRoundTripTime !== undefined ? Math.round(pair.currentRoundTripTime * 1000) : undefined,
          availableIncomingKbps: pair.availableIncomingBitrate ? Math.round(pair.availableIncomingBitrate / 1000) : undefined,
          localType: byId.get(pair.localCandidateId)?.candidateType,
          remoteType: byId.get(pair.remoteCandidateId)?.candidateType,
          protocol: byId.get(pair.localCandidateId)?.protocol,
          dtls: tr?.dtlsState,
        };
      }
    }

    let gpu: string | null = null;
    try {
      const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).slice(0, 120);
    } catch {
      /* no WebGL */
    }
    let canDecode: string[] = [];
    try {
      canDecode = [...new Set((RTCRtpReceiver.getCapabilities('video')?.codecs ?? []).map((c) => c.mimeType.replace('video/', '')))];
    } catch {
      /* not supported */
    }

    return {
      room: this.slug,
      sessionSeconds: Math.round((now - this.startedAt) / 1000),
      state: {
        socketConnected: this.sig.connected(),
        live: this.live(),
        connecting: this.connecting(),
        problem: this.problem(),
        error: this.error(),
        blocked: this.blocked,
        lostSecondsAgo: this.lostAt ? Math.round((now - this.lostAt) / 1000) : null,
        stalledSeconds: this.stalled,
        tabHidden: document.hidden,
        pausedSent: this.pausedSent,
        quality: this.quality(),
        layers: this.layers(),
        viewers: this.viewers().count,
        shownStats: this.stats(),
      },
      transport: this.transport ? { connectionState: this.transport.connectionState, closed: this.transport.closed } : null,
      net,
      consumers: [...this.consumers.values()].map((c) => ({
        kind: c.kind,
        paused: c.paused,
        closed: c.closed,
        codec: c.rtpParameters.codecs[0]?.mimeType,
        track: trackInfo(c.track),
      })),
      streamTracks: this.stream.getTracks().map(trackInfo),
      inboundVideo: inbound,
      videoElement: v
        ? {
            readyState: v.readyState,
            networkState: v.networkState,
            paused: v.paused,
            ended: v.ended,
            muted: v.muted,
            volume: v.volume,
            currentTime: Math.round(v.currentTime * 10) / 10,
            size: [v.videoWidth, v.videoHeight],
            box: [v.clientWidth, v.clientHeight],
            hasSrcObject: !!v.srcObject,
            srcIsOurStream: v.srcObject === this.stream,
            errorCode: v.error?.code ?? null,
            frames: q ? { total: q.totalVideoFrames, dropped: q.droppedVideoFrames, corrupted: (q as any).corruptedVideoFrames } : null,
          }
        : null,
      browser: { gpu, canDecode },
      events: this.events.map((e) => `+${Math.round((e.at - this.startedAt) / 100) / 10}s ${e.msg}`),
    };
  }

  /** Tries again after "kicked" or a connection problem. */
  retry(): void {
    if (this.slug) this.start(this.slug, this.key, this.nickname);
  }

  setQuality(q: Quality): void {
    this.quality.set(q);
    const video = [...this.consumers.values()].find((c) => c.kind === 'video');
    if (video) this.sig.request('setQuality', { consumerId: video.id, quality: q }).catch(() => undefined);
  }

  private setPaused(paused: boolean): void {
    if (this.pausedSent === paused || !this.transport) return;
    this.note(`paused=${paused}`);
    this.pausedSent = paused;
    this.sig.request('setPaused', { paused }).catch(() => undefined);
  }

  private teardown(): void {
    this.generation++;
    this.consumers.forEach((c) => c.close());
    this.consumers.clear();
    this.transport?.close();
    this.transport = undefined;
    for (const t of this.stream.getTracks()) this.stream.removeTrack(t);
    this.hasAudio.set(false);
    this.layers.set(1);
    this.stats.set(null);
    this.pausedSent = false;
    this.consuming.clear();
    this.stalled = 0;
  }

  private async setup(): Promise<void> {
    if (this.blocked) return;
    const gen = ++this.generation;
    try {
      const joined = await this.sig.request<{
        room: { name: string; ownerName: string; autoName?: boolean };
        live: boolean;
        name: string;
        rtpCapabilities: types.RtpCapabilities;
      }>('joinRoom', { slug: this.slug, key: this.key, nickname: this.nickname, token: this.api.token() ?? undefined });
      if (gen !== this.generation) return;
      this.note(`joined room (live=${joined.live})`);
      this.myName.set(joined.name);
      this.lostAt = null;
      this.roomName.set(joined.room.name);
      this.ownerName.set(joined.room.ownerName);
      this.autoName.set(!!joined.room.autoName);
      this.live.set(joined.live);

      const device = new Device();
      await device.load({ routerRtpCapabilities: joined.rtpCapabilities });
      const params = await this.sig.request<any>('createTransport', { direction: 'recv' });
      if (gen !== this.generation) return;
      const transport = device.createRecvTransport({
        id: params.id,
        iceParameters: params.iceParameters,
        iceCandidates: params.iceCandidates,
        dtlsParameters: params.dtlsParameters,
      });
      transport.on('connect', ({ dtlsParameters }, ok, fail) => {
        this.sig.request('connectTransport', { transportId: transport.id, dtlsParameters }).then(ok, fail);
      });
      transport.on('connectionstatechange', (state) => {
        this.note(`transport ${state}`);
        if (state === 'failed' && gen === this.generation) this.scheduleRetry(2000);
      });
      this.device = device;
      this.transport = transport;
      this.error.set(null);
      this.problem.set(null);
      this.connecting.set(false);

      await this.syncProducers(gen);
    } catch (e: any) {
      if (gen !== this.generation) return;
      const message: string = e?.message ?? 'Could not connect';
      this.note(`setup failed: ${message}`);
      this.connecting.set(false);
      this.error.set(message);
      if (/not found/i.test(message) && this.lostAt && Date.now() - this.lostAt < 5 * 60_000) {
        // The server restarted and the room is not back yet: keep waiting for it.
        this.connecting.set(true);
        this.error.set(null);
        this.scheduleRetry(3000);
      } else if (/not found/i.test(message)) {
        this.problem.set('notfound');
        this.blocked = true; // pointless to retry
      } else if (/full|too many|capacity/i.test(message)) {
        this.problem.set('busy');
        this.scheduleRetry(10_000);
      } else {
        this.problem.set('other');
        this.scheduleRetry(4000);
      }
    }
  }

  /** Consumes every producer the room has that is not being consumed yet. */
  private async syncProducers(gen: number): Promise<void> {
    const { producers } = await this.sig.request<{ producers: { id: string }[] }>('getProducers');
    for (const p of producers) await this.consume(p.id, gen);
  }

  private scheduleRetry(ms: number): void {
    this.note(`retry in ${ms} ms`);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.teardown();
      if (this.sig.connected() && !this.blocked) void this.setup();
    }, ms);
  }

  private async consume(producerId: string, gen: number): Promise<void> {
    const transport = this.transport;
    const device = this.device;
    if (!transport || !device || gen !== this.generation) return;
    if (this.consuming.has(producerId)) return; // already on its way: two tracks of one video show black
    this.consuming.add(producerId);
    try {
      const data = await this.sig.request<any>('consume', {
        transportId: transport.id,
        producerId,
        rtpCapabilities: device.rtpCapabilities,
      });
      if (gen !== this.generation) return;
      const consumer = await transport.consume({
        id: data.id,
        producerId: data.producerId,
        kind: data.kind,
        rtpParameters: data.rtpParameters,
      });
      this.note(`consuming ${consumer.kind} (${consumer.rtpParameters.codecs[0]?.mimeType ?? '?'})`);
      this.consumers.set(consumer.id, consumer);
      this.stream.addTrack(consumer.track);
      this.trackCount.update((n) => n + 1);
      if (consumer.kind === 'audio') this.hasAudio.set(true);
      if (consumer.kind === 'video') {
        this.layers.set(data.spatialLayers ?? 1);
        if (this.quality() !== 'auto') this.sig.request('setQuality', { consumerId: consumer.id, quality: this.quality() }).catch(() => undefined);
      }
      await this.sig.request('resumeConsumer', { consumerId: consumer.id });
      this.error.set(null);
      this.problem.set(null);
    } catch (e: any) {
      if (gen === this.generation) this.consuming.delete(producerId);
      const message: string = e?.message ?? 'Could not play the stream';
      this.note(`consume failed: ${message}`);
      this.error.set(message);
      if (/full|capacity/i.test(message)) {
        this.problem.set('busy');
        this.scheduleRetry(10_000);
      }
    }
  }

  private removeByProducer(producerId: string): void {
    this.note('producerClosed');
    this.consuming.delete(producerId);
    for (const [id, c] of this.consumers) {
      if (c.producerId === producerId) {
        this.stream.removeTrack(c.track);
        c.close();
        this.consumers.delete(id);
        if (c.kind === 'audio') this.hasAudio.set(false);
        if (c.kind === 'video') this.layers.set(1);
      }
    }
    if (this.consumers.size === 0) this.stats.set(null);
  }

  private async collectStats(): Promise<void> {
    const video = [...this.consumers.values()].find((c) => c.kind === 'video');
    if (!video) {
      // Live and joined, but no video consumer (a consume failed or an announcement was missed): resync, then start over.
      if (this.live() && this.transport && !this.blocked) {
        this.stalled++;
        if (this.stalled === 3 || this.stalled === 6) {
          this.note('watchdog: live but no video consumer, resyncing');
          this.syncProducers(this.generation).catch(() => undefined);
        }
        if (this.stalled >= 10) {
          this.note('watchdog: still no video consumer, reconnecting');
          this.stalled = 0;
          this.scheduleRetry(0);
        }
      } else this.stalled = 0;
      return;
    }
    try {
      const report = await video.getStats();
      let inbound: any;
      report.forEach((r: any) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') inbound = r;
      });
      // Black screen watchdog: connected but no frame decoded (or no RTP stats at all). Ask for a keyframe, then start over.
      if (this.live() && !this.pausedSent && !inbound?.framesDecoded) {
        this.stalled++;
        if (this.stalled === 3 || this.stalled === 6) {
          this.note('watchdog: no frame decoded, requesting a keyframe');
          this.sig.request('requestKeyFrame', { consumerId: video.id }).catch(() => undefined);
        }
        if (this.stalled >= 10) {
          this.note('watchdog: no frame decoded for 10 s, reconnecting');
          this.stalled = 0;
          this.scheduleRetry(0);
        }
      } else this.stalled = 0;
      if (!inbound) return;
      const now = performance.now();
      const dt = now - this.last.at;
      const bitrateKbps = this.last.at ? ((inbound.bytesReceived - this.last.bytes) * 8) / dt : 0;
      const dLost = inbound.packetsLost - this.last.lost;
      const dRecv = inbound.packetsReceived - this.last.received;
      this.last = { bytes: inbound.bytesReceived, at: now, lost: inbound.packetsLost, received: inbound.packetsReceived };
      this.stats.set({
        width: inbound.frameWidth ?? 0,
        height: inbound.frameHeight ?? 0,
        fps: Math.round(inbound.framesPerSecond ?? 0),
        bitrateKbps: Math.max(0, Math.round(bitrateKbps)),
        bufferMs: inbound.jitterBufferEmittedCount ? Math.round((inbound.jitterBufferDelay / inbound.jitterBufferEmittedCount) * 1000) : 0,
        lossPct: dLost + dRecv > 0 ? Math.round((Math.max(0, dLost) / (dLost + dRecv)) * 1000) / 10 : 0,
      });
    } catch {
      /* consumer closing */
    }
  }
}
