import { Injectable, inject, signal } from '@angular/core';
import { Device, type types } from 'mediasoup-client';
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

/** Receives the live stream from the SFU. Anonymous: no login needed. */
@Injectable({ providedIn: 'root' })
export class ViewerService {
  private readonly sig = inject(SignalingService);

  readonly live = signal(false);
  readonly connecting = signal(true);
  readonly error = signal<string | null>(null);
  readonly hasAudio = signal(false);
  readonly stats = signal<ViewerStats | null>(null);
  /** The element's srcObject; stays the same object for the whole session. */
  readonly stream = new MediaStream();

  private device?: Device;
  private transport?: types.Transport;
  private consumers = new Map<string, types.Consumer>();
  private unsubs: Array<() => void> = [];
  private statsTimer?: ReturnType<typeof setInterval>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private last = { bytes: 0, at: 0, lost: 0, received: 0 };

  start(): void {
    this.stop();
    this.sig.open();
    this.unsubs.push(
      this.sig.on('connect', () => void this.setup()),
      this.sig.on('disconnect', () => {
        this.teardown();
        this.connecting.set(true);
      }),
      this.sig.on<{ live: boolean }>('streamState', (s) => this.live.set(s.live)),
      this.sig.on<{ producerId: string }>('newProducer', ({ producerId }) => void this.consume(producerId, this.generation)),
      this.sig.on<{ producerId: string }>('producerClosed', ({ producerId }) => this.removeByProducer(producerId)),
    );
    this.statsTimer = setInterval(() => void this.collectStats(), 1000);
  }

  stop(): void {
    clearInterval(this.statsTimer);
    clearTimeout(this.retryTimer);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.teardown();
    this.sig.close();
    this.live.set(false);
  }

  private teardown(): void {
    this.generation++;
    this.consumers.forEach((c) => c.close());
    this.consumers.clear();
    this.transport?.close();
    this.transport = undefined;
    for (const t of this.stream.getTracks()) this.stream.removeTrack(t);
    this.hasAudio.set(false);
    this.stats.set(null);
  }

  private async setup(): Promise<void> {
    const gen = ++this.generation;
    try {
      const { rtpCapabilities } = await this.sig.request<{ rtpCapabilities: types.RtpCapabilities }>('rtpCapabilities');
      const device = new Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
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
        if (state === 'failed' && gen === this.generation) this.scheduleRetry();
      });
      this.device = device;
      this.transport = transport;
      this.error.set(null);
      this.connecting.set(false);

      const { producers } = await this.sig.request<{ producers: { id: string }[] }>('getProducers');
      for (const p of producers) await this.consume(p.id, gen);
    } catch (e: any) {
      if (gen !== this.generation) return;
      this.error.set(e?.message ?? 'Could not connect');
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.teardown();
      if (this.sig.connected()) void this.setup();
    }, 2000);
  }

  private async consume(producerId: string, gen: number): Promise<void> {
    const transport = this.transport;
    const device = this.device;
    if (!transport || !device || gen !== this.generation) return;
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
      this.consumers.set(consumer.id, consumer);
      this.stream.addTrack(consumer.track);
      if (consumer.kind === 'audio') this.hasAudio.set(true);
      await this.sig.request('resumeConsumer', { consumerId: consumer.id });
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not play the stream');
    }
  }

  private removeByProducer(producerId: string): void {
    for (const [id, c] of this.consumers) {
      if (c.producerId === producerId) {
        this.stream.removeTrack(c.track);
        c.close();
        this.consumers.delete(id);
        if (c.kind === 'audio') this.hasAudio.set(false);
      }
    }
    if (this.consumers.size === 0) this.stats.set(null);
  }

  private async collectStats(): Promise<void> {
    const video = [...this.consumers.values()].find((c) => c.kind === 'video');
    if (!video) return;
    try {
      const report = await video.getStats();
      let inbound: any;
      report.forEach((r: any) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') inbound = r;
      });
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
        bufferMs: inbound.jitterBufferEmittedCount
          ? Math.round((inbound.jitterBufferDelay / inbound.jitterBufferEmittedCount) * 1000)
          : 0,
        lossPct: dLost + dRecv > 0 ? Math.round((Math.max(0, dLost) / (dLost + dRecv)) * 1000) / 10 : 0,
      });
    } catch {
      /* consumer closing */
    }
  }
}
