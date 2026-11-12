import { Injectable, inject, signal } from '@angular/core';
import { Device, type types } from 'mediasoup-client';
import { AuthService } from './auth.service';
import { SignalingService } from './signaling.service';
import { type StreamSettings, type StreamStats } from './stream-settings';

export type StreamerState = 'idle' | 'starting' | 'live';

interface AudioMixer {
  ctx: AudioContext;
  master: GainNode;
  screenGain?: GainNode;
  deviceGain?: GainNode;
  track: MediaStreamTrack;
  sources: MediaStream[];
}

/** Capture + publish the screen to the SFU. Only usable from an authenticated admin session. */
@Injectable({ providedIn: 'root' })
export class StreamerService {
  private readonly sig = inject(SignalingService);
  private readonly auth = inject(AuthService);

  readonly state = signal<StreamerState>('idle');
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly viewers = signal(0);
  readonly preview = signal<MediaStream | null>(null);
  readonly stats = signal<StreamStats | null>(null);
  /** Native size of the captured surface. */
  readonly source = signal<{ width: number; height: number; fps: number } | null>(null);
  readonly hasAudio = signal(false);

  private device?: Device;
  private transport?: types.Transport;
  private videoProducer?: types.Producer;
  private audioProducer?: types.Producer;
  private displayStream?: MediaStream;
  private micStream?: MediaStream;
  private mixer?: AudioMixer;
  private statsTimer?: ReturnType<typeof setInterval>;
  private lastBytes = 0;
  private lastStatsAt = 0;
  private unsubs: Array<() => void> = [];

  // ---- connection used by the admin page (viewer count, revocation) ----
  connectAdmin(onRevoked: () => void): void {
    const token = this.auth.token();
    if (!token) return;
    this.sig.open(token);
    this.unsubs.push(
      this.sig.on<number>('viewerCount', (n) => this.viewers.set(n)),
      this.sig.on('sessionRevoked', () => {
        void this.stop();
        onRevoked();
      }),
      this.sig.on('disconnect', () => {
        if (this.state() !== 'idle') {
          this.error.set('Lost connection to the server. The stream was stopped.');
          void this.stop(false);
        }
      }),
    );
  }

  disconnectAdmin(): void {
    void this.stop();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.sig.close();
    this.viewers.set(0);
  }

  // ---- start / stop ----
  async start(s: StreamSettings): Promise<void> {
    if (this.state() !== 'idle') return;
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
        /* server cleans up on disconnect anyway */
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

  // ---- capture ----
  private async capture(s: StreamSettings): Promise<void> {
    const wantScreenAudio = s.audioMode !== 'none';
    // Chromium-only options (ignored elsewhere), hence the loose typing.
    const options: any = {
      video: {
        cursor: 'always',
        frameRate: { ideal: s.fps, max: s.fps },
        width: { max: 3840 },
        height: { max: 2160 },
      },
      audio: wantScreenAudio
        ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 }
        : false,
      systemAudio: wantScreenAudio ? 'include' : 'exclude',
      windowAudio: s.audioMode === 'window' ? 'window' : 'system',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    };
    const display = await navigator.mediaDevices.getDisplayMedia(options);
    this.displayStream = display;

    const video = display.getVideoTracks()[0];
    video.contentHint = s.priority === 'motion' ? 'motion' : s.priority === 'detail' ? 'detail' : '';
    video.onended = () => void this.stop();
    this.updateSource(video);

    if (wantScreenAudio && display.getAudioTracks().length === 0) {
      this.notice.set(
        'No screen audio was captured. In the picker, tick "Share system audio" (screen) or "Share tab audio" (tab).',
      );
    }

    const screenAudio = display.getAudioTracks()[0];
    if (screenAudio || s.audioDeviceId) {
      let deviceAudio: MediaStreamTrack | undefined;
      if (s.audioDeviceId) {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: s.audioDeviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
          },
        });
        deviceAudio = this.micStream.getAudioTracks()[0];
      }
      this.mixer = this.createMixer(screenAudio, deviceAudio, s);
    }
    this.preview.set(new MediaStream([video]));
  }

  private createMixer(screen: MediaStreamTrack | undefined, device: MediaStreamTrack | undefined, s: StreamSettings): AudioMixer {
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = s.muted ? 0 : 1;
    const dest = ctx.createMediaStreamDestination();
    master.connect(dest);
    const sources: MediaStream[] = [];
    const connect = (track: MediaStreamTrack | undefined, gain: number) => {
      if (!track) return undefined;
      const stream = new MediaStream([track]);
      sources.push(stream);
      const g = ctx.createGain();
      g.gain.value = gain;
      ctx.createMediaStreamSource(stream).connect(g).connect(master);
      return g;
    };
    const screenGain = connect(screen, s.screenAudioGain);
    const deviceGain = connect(device, s.deviceGain);
    return { ctx, master, screenGain, deviceGain, track: dest.stream.getAudioTracks()[0], sources };
  }

  private updateSource(track: MediaStreamTrack) {
    const st = track.getSettings();
    this.source.set({ width: st.width ?? 0, height: st.height ?? 0, fps: Math.round(st.frameRate ?? 0) });
  }

  // ---- publish ----
  private async publish(s: StreamSettings): Promise<void> {
    const { rtpCapabilities } = await this.sig.request<{ rtpCapabilities: types.RtpCapabilities }>('rtpCapabilities');
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: rtpCapabilities });

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
    const maxBitrate = Math.round(s.bitrateMbps * 1_000_000);
    this.videoProducer = await transport.produce({
      track: video,
      codec,
      encodings: [this.encoding(s)],
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
      // Prefer High > Main > Baseline when several H.264 profiles are offered.
      const rank = (c: types.RtpCodecCapability) => {
        const p = String(c.parameters?.['profile-level-id'] ?? '').toLowerCase();
        return p.startsWith('64') ? 3 : p.startsWith('4d') ? 2 : 1;
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

  private encoding(s: StreamSettings): RTCRtpEncodingParameters {
    return {
      maxBitrate: Math.round(s.bitrateMbps * 1_000_000),
      maxFramerate: s.fps,
      scaleResolutionDownBy: this.scaleFor(s),
      priority: 'high',
      networkPriority: 'high',
    };
  }

  // ---- live adjustments ----
  async applyLive(s: StreamSettings): Promise<void> {
    if (this.state() !== 'live') return;
    const video = this.displayStream?.getVideoTracks()[0];
    if (video) {
      video.contentHint = s.priority === 'motion' ? 'motion' : s.priority === 'detail' ? 'detail' : '';
      video.applyConstraints({ frameRate: { ideal: s.fps, max: s.fps } }).catch(() => undefined);
      this.updateSource(video);
    }
    try {
      await this.videoProducer?.setRtpEncodingParameters(this.encoding(s));
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

  // ---- stats ----
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
      let out: any;
      let remote: any;
      report.forEach((r: any) => {
        if (r.type === 'outbound-rtp' && r.kind === 'video') out = r;
        if (r.type === 'remote-inbound-rtp' && r.kind === 'video') remote = r;
      });
      let available: number | null = null;
      transportReport.forEach((r: any) => {
        if (r.type === 'candidate-pair' && r.nominated && r.availableOutgoingBitrate) available = r.availableOutgoingBitrate / 1000;
      });
      if (!out) return;
      const now = performance.now();
      const bitrateKbps = this.lastStatsAt ? ((out.bytesSent - this.lastBytes) * 8) / (now - this.lastStatsAt) : 0;
      this.lastBytes = out.bytesSent;
      this.lastStatsAt = now;
      const reason = out.qualityLimitationReason as string | undefined;
      this.stats.set({
        bitrateKbps: Math.max(0, Math.round(bitrateKbps)),
        fps: Math.round(out.framesPerSecond ?? 0),
        width: out.frameWidth ?? 0,
        height: out.frameHeight ?? 0,
        limitation: reason === 'cpu' ? 'cpu' : reason === 'bandwidth' ? 'bandwidth' : reason && reason !== 'none' ? 'other' : 'none',
        encodeMs: out.framesEncoded ? Math.round((out.totalEncodeTime / out.framesEncoded) * 1000 * 10) / 10 : 0,
        rttMs: remote?.roundTripTime != null ? Math.round(remote.roundTripTime * 1000) : null,
        lossPct: remote?.fractionLost != null ? Math.round(remote.fractionLost * 1000) / 10 : 0,
        availableKbps: available != null ? Math.round(available) : null,
      });
    } catch {
      /* transport closing */
    }
  }

  // ---- input devices ----
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
