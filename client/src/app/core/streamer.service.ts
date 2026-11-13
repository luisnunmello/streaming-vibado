import { Injectable, inject, signal } from '@angular/core';
import { Device, type types } from 'mediasoup-client';
import { ApiService } from './api.service';
import type { Limits } from './models';
import { SignalingService } from './signaling.service';
import { clampSettings, type StreamSettings, type StreamStats } from './stream-settings';

export type StreamerState = 'idle' | 'starting' | 'live';
type Codec = 'h264' | 'vp8' | 'vp9' | 'av1';
type Layout = 'single' | 'simulcast' | 'svc';

interface AudioMixer {
  ctx: AudioContext;
  master: GainNode;
  screenGain?: GainNode;
  deviceGain?: GainNode;
  track: MediaStreamTrack;
}

export interface RoomInfo {
  slug: string;
  name: string;
  visibility: 'public' | 'private';
  ownerName: string;
}

/** Capture + publish the screen into a room the signed-in user owns. */
@Injectable({ providedIn: 'root' })
export class StreamerService {
  private readonly sig = inject(SignalingService);
  private readonly api = inject(ApiService);

  readonly state = signal<StreamerState>('idle');
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly viewers = signal(0);
  readonly preview = signal<MediaStream | null>(null);
  readonly stats = signal<StreamStats | null>(null);
  /** Native size of the captured surface. */
  readonly source = signal<{ width: number; height: number; fps: number } | null>(null);
  readonly hasAudio = signal(false);
  readonly room = signal<RoomInfo | null>(null);
  /** The account's limits; null for the admin. */
  readonly limits = signal<Limits | null>(null);

  private rtpCapabilities?: types.RtpCapabilities;
  private device?: Device;
  private transport?: types.Transport;
  private videoProducer?: types.Producer;
  private audioProducer?: types.Producer;
  private displayStream?: MediaStream;
  private micStream?: MediaStream;
  private mixer?: AudioMixer;
  private layout: Layout = 'single';
  private activeCodec: Codec = 'h264';
  private statsTimer?: ReturnType<typeof setInterval>;
  private appliedFps = 0;
  private lastBytes = 0;
  private lastStatsAt = 0;
  private unsubs: Array<() => void> = [];

  // ---------------------------------------------------------------- room connection

  /** Connects and joins the room as its owner. Rejects when the room is not yours. */
  async enter(slug: string, onSessionEnded: () => void): Promise<void> {
    await this.leave();
    const token = this.api.token();
    if (!token) throw new Error('Not signed in');
    this.sig.open(token);
    this.unsubs.push(
      this.sig.on<number>('viewerCount', (n) => this.viewers.set(n)),
      this.sig.on('sessionRevoked', () => {
        void this.stop(false);
        onSessionEnded();
      }),
      this.sig.on<{ reason: string }>('streamEnded', ({ reason }) => {
        this.notice.set(reason);
        void this.stop(false);
      }),
      this.sig.on('disconnect', () => {
        if (this.state() !== 'idle') {
          this.error.set('Lost connection to the server. The stream was stopped.');
          void this.stop(false);
        }
      }),
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('Could not connect to the server'));
      }, 10_000);
      const off = this.sig.on('connect', () => {
        clearTimeout(timer);
        off();
        resolve();
      });
    });
    const res = await this.sig.request<{ role: string; room: RoomInfo; limits: Limits | null; rtpCapabilities: types.RtpCapabilities }>('joinRoom', { slug });
    if (res.role !== 'owner') throw new Error('This is not your room');
    this.room.set(res.room);
    this.limits.set(res.limits ?? null);
    this.rtpCapabilities = res.rtpCapabilities;
  }

  async leave(): Promise<void> {
    await this.stop();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.sig.close();
    this.viewers.set(0);
    this.room.set(null);
    this.limits.set(null);
    this.error.set(null);
    this.notice.set(null);
  }

  // ---------------------------------------------------------------- start / stop

  async start(requested: StreamSettings): Promise<void> {
    if (this.state() !== 'idle' || !this.room()) return;
    const s = clampSettings(requested, this.limits());
    this.error.set(null);
    this.notice.set(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.error.set('Screen capture is not available. Use HTTPS (or localhost) and a desktop Chromium-based browser.');
      return;
    }
    this.state.set('starting');
    try {
      await this.capture(s);
      await this.publish(s);
      this.state.set('live');
      this.startStats();
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') this.error.set('Screen sharing was cancelled.');
      else this.error.set(e?.message ?? String(e));
      await this.stop(false);
    }
  }

  async stop(notifyServer = true): Promise<void> {
    clearInterval(this.statsTimer);
    this.statsTimer = undefined;
    const producerIds = [this.videoProducer?.id, this.audioProducer?.id].filter((x): x is string => !!x);
    const transportId = this.transport?.id;
    this.videoProducer?.close();
    this.audioProducer?.close();
    this.transport?.close();
    this.videoProducer = this.audioProducer = this.transport = undefined;
    if (notifyServer && this.sig.connected() && transportId) {
      try {
        for (const producerId of producerIds) await this.sig.request('closeProducer', { producerId });
        await this.sig.request('closeTransport', { transportId });
      } catch {
        /* the server cleans up on disconnect anyway */
      }
    }
    this.displayStream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.mixer?.track.stop();
    void this.mixer?.ctx.close().catch(() => undefined);
    this.displayStream = this.micStream = this.mixer = undefined;
    this.preview.set(null);
    this.stats.set(null);
    this.source.set(null);
    this.hasAudio.set(false);
    this.state.set('idle');
  }

  // ---------------------------------------------------------------- capture

  /** Capture at the screen's native size (up to 4K); the encoder downscales to the chosen output. */
  private captureConstraints(fps: number): MediaTrackConstraints {
    return { frameRate: { ideal: fps, max: fps }, width: { max: 3840 }, height: { max: 2160 } };
  }

  private async capture(s: StreamSettings): Promise<void> {
    const wantScreenAudio = s.audioMode !== 'none';
    this.appliedFps = s.fps;
    // Chromium-only options (ignored elsewhere), hence the loose typing.
    const options: any = {
      video: { cursor: 'always', ...this.captureConstraints(s.fps) },
      audio: wantScreenAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } : false,
      systemAudio: wantScreenAudio ? 'include' : 'exclude',
      windowAudio: s.audioMode === 'window' ? 'window' : 'system',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    };
    const display = await navigator.mediaDevices.getDisplayMedia(options);
    this.displayStream = display;

    const video = display.getVideoTracks()[0];
    video.contentHint = this.hintFor(s);
    video.onended = () => void this.stop();
    this.updateSource(video);

    if (wantScreenAudio && display.getAudioTracks().length === 0) {
      this.notice.set('No screen audio was captured. In the picker, tick "Share system audio" (screen) or "Share tab audio" (tab).');
    }

    const screenAudio = display.getAudioTracks()[0];
    if (screenAudio || s.audioDeviceId) {
      let deviceAudio: MediaStreamTrack | undefined;
      if (s.audioDeviceId) {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: s.audioDeviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
        });
        deviceAudio = this.micStream.getAudioTracks()[0];
      }
      this.mixer = this.createMixer(screenAudio, deviceAudio, s);
    }
    this.preview.set(new MediaStream([video]));
  }

  private hintFor(s: StreamSettings): string {
    return s.priority === 'motion' ? 'motion' : s.priority === 'detail' ? 'detail' : '';
  }

  private createMixer(screen: MediaStreamTrack | undefined, device: MediaStreamTrack | undefined, s: StreamSettings): AudioMixer {
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = s.muted ? 0 : 1;
    const dest = ctx.createMediaStreamDestination();
    master.connect(dest);
    const connect = (track: MediaStreamTrack | undefined, gain: number) => {
      if (!track) return undefined;
      const g = ctx.createGain();
      g.gain.value = gain;
      ctx.createMediaStreamSource(new MediaStream([track])).connect(g).connect(master);
      return g;
    };
    const screenGain = connect(screen, s.screenAudioGain);
    const deviceGain = connect(device, s.deviceGain);
    return { ctx, master, screenGain, deviceGain, track: dest.stream.getAudioTracks()[0] };
  }

  private updateSource(track: MediaStreamTrack) {
    const st = track.getSettings();
    this.source.set({ width: st.width ?? 0, height: st.height ?? 0, fps: Math.round(st.frameRate ?? 0) });
  }

  // ---------------------------------------------------------------- publish

  private async publish(s: StreamSettings): Promise<void> {
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: this.rtpCapabilities! });

    const params = await this.sig.request<any>('createTransport', { direction: 'send' });
    const transport = this.device.createSendTransport({
      id: params.id,
      iceParameters: params.iceParameters,
      iceCandidates: params.iceCandidates,
      dtlsParameters: params.dtlsParameters,
    });
    this.transport = transport;
    transport.on('connect', ({ dtlsParameters }, ok, fail) => {
      this.sig.request('connectTransport', { transportId: transport.id, dtlsParameters }).then(ok, fail);
    });
    transport.on('produce', ({ kind, rtpParameters, appData }, ok, fail) => {
      this.sig
        .request<{ id: string }>('produce', { transportId: transport.id, kind, rtpParameters, appData })
        .then(({ id }) => ok({ id }), fail);
    });
    transport.on('connectionstatechange', (state) => {
      if (state === 'failed' && this.state() !== 'idle') {
        this.error.set('The connection to the server failed (check that the WebRTC port is reachable).');
        void this.stop();
      }
    });

    const video = this.displayStream!.getVideoTracks()[0];
    const codec = this.pickCodec(s);
    this.activeCodec = codec.mimeType.split('/')[1].toLowerCase() as Codec;
    this.layout = !s.adaptive ? 'single' : this.activeCodec === 'vp9' || this.activeCodec === 'av1' ? 'svc' : 'simulcast';
    const maxBitrate = Math.round(s.bitrateMbps * 1_000_000);
    this.videoProducer = await transport.produce({
      track: video,
      codec,
      encodings: this.encodings(s),
      codecOptions: {
        // Start near the target instead of ramping up from a few hundred kbps.
        videoGoogleStartBitrate: Math.round((maxBitrate * 0.6) / 1000),
        videoGoogleMinBitrate: Math.round((maxBitrate * 0.25) / 1000),
        videoGoogleMaxBitrate: Math.round(maxBitrate / 1000),
      },
      appData: { source: 'screen' },
    });

    if (this.mixer) {
      this.audioProducer = await transport.produce({
        track: this.mixer.track,
        codecOptions: { opusStereo: true, opusFec: true, opusDtx: false, opusMaxPlaybackRate: 48000, opusMaxAverageBitrate: 128000, opusPtime: 20 },
        encodings: [{ maxBitrate: 128_000, priority: 'high' }],
        appData: { source: 'audio' },
      });
      this.hasAudio.set(true);
    }
  }

  private pickCodec(s: StreamSettings): types.RtpCodecCapability {
    const all = this.device!.rtpCapabilities.codecs ?? [];
    const matches = all.filter((c) => c.mimeType.toLowerCase() === `video/${s.codec}`);
    if (matches.length === 0) {
      const fallback = all.find((c) => c.kind === 'video' && /video\/(vp8|h264)/i.test(c.mimeType));
      if (!fallback) throw new Error(`Your browser cannot encode ${s.codec.toUpperCase()}.`);
      this.notice.set(`${s.codec.toUpperCase()} is not available in this browser; using ${fallback.mimeType.split('/')[1]}.`);
      return fallback;
    }
    if (s.codec === 'h264') {
      // Prefer Constrained Baseline (42e0..): every browser decodes it, Firefox decodes nothing higher.
      // A High/Main stream would be refused for those viewers, since the server does not transcode.
      const rank = (c: types.RtpCodecCapability) => {
        const p = String(c.parameters?.['profile-level-id'] ?? '').toLowerCase();
        return p.startsWith('42e') ? 3 : p.startsWith('42') ? 2 : 1;
      };
      return [...matches].sort((a, b) => rank(b) - rank(a))[0];
    }
    return matches[0];
  }

  private scaleFor(s: StreamSettings): number {
    const native = this.source()?.height ?? 0;
    if (!s.height || !native) return 1;
    return Math.max(1, native / s.height);
  }

  /**
   * One encoding normally. With "adaptive quality" there are three levels (about 100%, 40% and 15% of
   * the bitrate, at full, 1/2 and 1/4 size) so the server can pick a lower one for a viewer or when it is busy.
   */
  private encodings(s: StreamSettings): RTCRtpEncodingParameters[] {
    const maxBitrate = Math.round(s.bitrateMbps * 1_000_000);
    const scale = this.scaleFor(s);
    const common = { maxFramerate: s.fps };
    if (this.layout === 'simulcast') {
      // Chrome rejects `priority`/`networkPriority` when there is more than one encoding.
      return [
        { rid: 'r0', ...common, maxBitrate: Math.round(maxBitrate * 0.15), scaleResolutionDownBy: scale * 4 },
        { rid: 'r1', ...common, maxBitrate: Math.round(maxBitrate * 0.4), scaleResolutionDownBy: scale * 2 },
        { rid: 'r2', ...common, maxBitrate, scaleResolutionDownBy: scale },
      ];
    }
    const single: RTCRtpEncodingParameters & { scalabilityMode?: string } = {
      ...common,
      maxBitrate,
      scaleResolutionDownBy: scale,
      priority: 'high',
      networkPriority: 'high',
    };
    if (this.layout === 'svc') single.scalabilityMode = 'L3T3';
    return [single];
  }

  // ---------------------------------------------------------------- live adjustments

  async applyLive(requested: StreamSettings): Promise<void> {
    if (this.state() !== 'live') return;
    const s = clampSettings(requested, this.limits());
    const video = this.displayStream?.getVideoTracks()[0];
    if (video) {
      video.contentHint = this.hintFor(s);
      if (s.fps !== this.appliedFps) {
        this.appliedFps = s.fps;
        // applyConstraints replaces the whole set, so the size caps must be sent again,
        // and we must wait for it before reading the (possibly changed) source size.
        await video.applyConstraints(this.captureConstraints(s.fps)).catch(() => undefined);
      }
      this.updateSource(video);
    }
    // Update every layer through the sender: the library helper would give all layers the same values.
    try {
      const sender = this.videoProducer?.rtpSender;
      if (sender) {
        const params = sender.getParameters();
        const desired = this.encodings(s);
        params.encodings.forEach((e, i) => {
          const d = desired[i];
          if (!d) return;
          e.maxBitrate = d.maxBitrate;
          e.maxFramerate = d.maxFramerate;
          e.scaleResolutionDownBy = d.scaleResolutionDownBy;
        });
        await sender.setParameters(params);
      }
    } catch (e) {
      console.warn('Could not update encoder parameters', e);
    }
    const m = this.mixer;
    if (m) {
      const t = m.ctx.currentTime;
      m.master.gain.setTargetAtTime(s.muted ? 0 : 1, t, 0.02);
      m.screenGain?.gain.setTargetAtTime(s.screenAudioGain, t, 0.02);
      m.deviceGain?.gain.setTargetAtTime(s.deviceGain, t, 0.02);
    }
  }

  // ---------------------------------------------------------------- stats

  private startStats() {
    this.lastBytes = 0;
    this.lastStatsAt = 0;
    this.statsTimer = setInterval(() => void this.collectStats(), 1000);
  }

  private async collectStats() {
    const producer = this.videoProducer;
    if (!producer || !this.transport) return;
    try {
      const [report, transportReport] = await Promise.all([producer.getStats(), this.transport.getStats()]);
      const outs: any[] = [];
      let remote: any;
      report.forEach((r: any) => {
        if (r.type === 'outbound-rtp' && r.kind === 'video') outs.push(r);
        if (r.type === 'remote-inbound-rtp' && r.kind === 'video') remote = r;
      });
      let available: number | null = null;
      transportReport.forEach((r: any) => {
        if (r.type === 'candidate-pair' && r.nominated && r.availableOutgoingBitrate) available = r.availableOutgoingBitrate / 1000;
      });
      if (outs.length === 0) return;
      // With several quality levels the biggest one describes the output; bytes are summed over all.
      const top = outs.reduce((a, b) => ((b.frameWidth ?? 0) > (a.frameWidth ?? 0) ? b : a));
      const bytes = outs.reduce((sum, o) => sum + (o.bytesSent ?? 0), 0);
      const now = performance.now();
      const bitrateKbps = this.lastStatsAt ? ((bytes - this.lastBytes) * 8) / (now - this.lastStatsAt) : 0;
      this.lastBytes = bytes;
      this.lastStatsAt = now;
      const reason = top.qualityLimitationReason as string | undefined;
      this.stats.set({
        bitrateKbps: Math.max(0, Math.round(bitrateKbps)),
        fps: Math.round(top.framesPerSecond ?? 0),
        width: top.frameWidth ?? 0,
        height: top.frameHeight ?? 0,
        limitation: reason === 'cpu' ? 'cpu' : reason === 'bandwidth' ? 'bandwidth' : reason && reason !== 'none' ? 'other' : 'none',
        encodeMs: top.framesEncoded ? Math.round((top.totalEncodeTime / top.framesEncoded) * 1000 * 10) / 10 : 0,
        rttMs: remote?.roundTripTime != null ? Math.round(remote.roundTripTime * 1000) : null,
        lossPct: remote?.fractionLost != null ? Math.round(remote.fractionLost * 1000) / 10 : 0,
        availableKbps: available != null ? Math.round(available) : null,
        layers: outs.length,
      });
    } catch {
      /* transport closing */
    }
  }

  // ---------------------------------------------------------------- input devices

  async listAudioInputs(requestPermission: boolean): Promise<MediaDeviceInfo[]> {
    if (requestPermission) {
      try {
        // Labels are only exposed after the user granted microphone permission once.
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
      } catch {
        /* denied: we still list what we can */
      }
    }
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
  }
}
