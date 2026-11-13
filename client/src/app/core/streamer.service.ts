import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Device, type types } from 'mediasoup-client';
import { ApiService } from './api.service';
import type { Limits } from './models';
import { SignalingService } from './signaling.service';
import {
  DEFAULT_SETTINGS,
  clampSettings,
  distinctPresets,
  isPresetActive,
  loadSettings,
  saveSettings,
  type Preset,
  type StreamSettings,
  type StreamStats,
} from './stream-settings';

export type StreamerState = 'idle' | 'starting' | 'live';
type Codec = 'h264' | 'vp8' | 'vp9' | 'av1';
type Layout = 'single' | 'simulcast' | 'svc';

interface AudioMixer {
  ctx: AudioContext;
  master: GainNode;
  screenGain?: GainNode;
  screenSource?: MediaStreamAudioSourceNode;
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
  readonly changingSource = signal(false);
  /** The stream settings. The ones that can change live reach the running encoder as they change. */
  readonly settings = signal<StreamSettings>({ ...DEFAULT_SETTINGS });
  /** Another tab asked to change the screen. Only this tab can open the picker, so it shows a button for it. */
  readonly changeRequested = signal(false);
  readonly presetChoices = computed(() => distinctPresets(this.limits()));
  private settingsReady = false;
  private applyTimer?: ReturnType<typeof setTimeout>;
  private channel?: BroadcastChannel;

  /** Settings the running stream was last given. */
  private current?: StreamSettings;
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
  private appliedHeight = 0;
  private nudges = 0;
  private lastNudgeAt = 0;
  private lastBytes = 0;
  private lastStatsAt = 0;
  private unsubs: Array<() => void> = [];

  constructor() {
    // When the limits change (live, from the admin), pull the current settings inside them. If that changes
    // anything, the effect below sends it on to the running encoder.
    effect(() => {
      const limits = this.limits();
      if (!untracked(() => this.settingsReady)) return;
      untracked(() =>
        this.settings.update((cur) => {
          const next = clampSettings(cur, limits);
          return JSON.stringify(next) === JSON.stringify(cur) ? cur : next;
        }),
      );
    });
    // Remember the settings and push the live-adjustable ones to the running encoder.
    effect(() => {
      const cur = this.settings();
      if (!untracked(() => this.settingsReady)) return;
      saveSettings(cur);
      untracked(() => {
        clearTimeout(this.applyTimer);
        this.applyTimer = setTimeout(() => void this.applyLive(cur), 150);
      });
    });
    this.startControlHost();
  }

  patch(values: Partial<StreamSettings>): void {
    this.settings.update((cur) => ({ ...cur, ...values }));
  }

  applyPreset(p: Preset): void {
    this.settings.update((cur) => clampSettings({ ...cur, ...p.values }, this.limits()));
  }

  toggleMute(): void {
    this.patch({ muted: !this.settings().muted });
  }

  // ---------------------------------------------------------------- control from other tabs

  /** Status other tabs of this site (e.g. the viewer page of the room) use to show streamer controls. */
  /** Snapshot of the state other tabs and control bars show. */
  readonly status = computed(() => ({
    t: 'status' as const,
    slug: this.room()?.slug ?? null,
    live: this.state() === 'live',
    muted: this.settings().muted,
    changing: this.changingSource(),
    requested: this.changeRequested(),
    hasAudio: this.hasAudio(),
    presets: this.presetChoices().map((p) => ({ label: p.label, active: isPresetActive(p, this.settings(), this.limits()) })),
  }));

  private startControlHost(): void {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('streamer-control');
    this.channel = channel;
    channel.onmessage = (ev) => this.onRemoteCommand(ev.data);
    effect(() => {
      const st = this.status();
      if (st.slug) channel.postMessage(st);
    });
    // A heartbeat, so other tabs notice when this one goes away.
    setInterval(() => {
      const st = untracked(this.status);
      if (st.live) channel.postMessage(st);
    }, 2000);
  }

  private onRemoteCommand(msg: { t?: string; value?: boolean; index?: number }): void {
    if (msg?.t === 'hello') {
      const st = this.status();
      if (st.slug) this.channel?.postMessage(st);
      return;
    }
    if (this.state() !== 'live') return;
    switch (msg?.t) {
      case 'mute':
        this.patch({ muted: !!msg.value });
        break;
      case 'preset': {
        const p = this.presetChoices()[msg.index ?? -1];
        if (p) this.applyPreset(p);
        break;
      }
      case 'stop':
        void this.stop();
        break;
      case 'changeSource':
        // The picker needs a click in this tab: ask for it.
        this.changeRequested.set(true);
        try {
          window.focus();
        } catch {
          /* browsers may refuse */
        }
        break;
    }
  }

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
      // The admin changed this account's limits (or its preset): the studio follows at once.
      this.sig.on<{ limits: Limits }>('limits', ({ limits }) => {
        this.limits.set(limits);
        this.flash('Your limits were updated by the administrator.');
      }),
      this.sig.on<{ kind: string; message: string }>('limitsEnforced', ({ kind, message }) => {
        if (kind === 'audio') {
          this.audioProducer?.close();
          this.audioProducer = undefined;
          this.hasAudio.set(false);
        }
        this.flash(message);
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
    this.settings.set(clampSettings(loadSettings({ adaptive: !!res.limits, codec: res.limits ? 'vp8' : 'h264' }), res.limits ?? null));
    this.settingsReady = true;
    this.rtpCapabilities = res.rtpCapabilities;
  }

  /** A message that goes away by itself. */
  private flash(message: string): void {
    this.notice.set(message);
    setTimeout(() => this.notice() === message && this.notice.set(null), 10_000);
  }

  async leave(): Promise<void> {
    await this.stop();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.sig.close();
    this.settingsReady = false;
    this.changeRequested.set(false);
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
    this.current = s;
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
    this.changingSource.set(false);
    this.preview.set(null);
    this.stats.set(null);
    this.source.set(null);
    this.hasAudio.set(false);
    this.changeRequested.set(false);
    this.state.set('idle');
  }

  // ---------------------------------------------------------------- capture

  /** Capture already at the chosen output height (never upscaled): feeding the encoder a 4K picture made Chrome start at a quarter size. */
  private captureConstraints(fps: number, height: number): MediaTrackConstraints {
    // Ask the capture for more than the target: Chrome's capture frame limiter drops frames so the result
    // lands at about 80% of an exact limit (60 became 48). The encoder's maxFramerate does the real limiting.
    return { frameRate: { ideal: Math.min(144, Math.round(fps * 1.5)), max: 144 }, width: { max: 3840 }, height: { max: height > 0 ? Math.min(height, 2160) : 2160 } };
  }

  private async capture(s: StreamSettings): Promise<void> {
    const wantScreenAudio = s.audioMode !== 'none';
    this.appliedFps = s.fps;
    this.appliedHeight = s.height;
    const display = await navigator.mediaDevices.getDisplayMedia(this.displayOptions(s));
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

  /** Chromium-only options (ignored elsewhere), hence the loose typing. */
  private displayOptions(s: StreamSettings): any {
    const wantScreenAudio = s.audioMode !== 'none';
    return {
      video: { cursor: 'always', ...this.captureConstraints(s.fps, s.height) },
      audio: wantScreenAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } : false,
      systemAudio: wantScreenAudio ? 'include' : 'exclude',
      windowAudio: s.audioMode === 'window' ? 'window' : 'system',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    };
  }

  /**
   * Switch to another screen, window or tab without stopping the stream: viewers keep watching,
   * the same connection and encoder are reused, only the picture (and screen audio) changes.
   */
  async changeSource(): Promise<void> {
    if (this.state() !== 'live' || !this.videoProducer || this.changingSource()) return;
    const s = this.current;
    if (!s) return;
    this.changingSource.set(true);
    this.changeRequested.set(false);
    this.error.set(null);
    this.notice.set(null);
    try {
      let display: MediaStream;
      try {
        display = await navigator.mediaDevices.getDisplayMedia(this.displayOptions(s));
      } catch (e: any) {
        if (e?.name === 'NotAllowedError') return; // picker cancelled: keep the current source
        throw e;
      }
      const video = display.getVideoTracks()[0];
      video.contentHint = this.hintFor(s);
      await this.videoProducer.replaceTrack({ track: video });
      video.onended = () => void this.stop();

      // screen audio follows the new source
      const newAudio = display.getAudioTracks()[0];
      const m = this.mixer;
      if (m && s.audioMode !== 'none') {
        m.screenSource?.disconnect();
        m.screenSource = undefined;
        if (newAudio) {
          if (!m.screenGain) {
            m.screenGain = m.ctx.createGain();
            m.screenGain.connect(m.master);
          }
          m.screenGain.gain.value = s.screenAudioGain;
          m.screenSource = m.ctx.createMediaStreamSource(new MediaStream([newAudio]));
          m.screenSource.connect(m.screenGain);
        } else {
          this.notice.set('The new source has no audio. Tick "Share system audio" or "Share tab audio" in the picker to include it.');
        }
      }

      const old = this.displayStream;
      this.displayStream = display;
      old?.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      this.preview.set(new MediaStream([video]));
      this.updateSource(video);
      // the new surface may have a different size: refit the output to the chosen resolution
      await this.applyLive(s);
      this.nudges = 0;
      this.lastNudgeAt = performance.now();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not change the source');
    } finally {
      this.changingSource.set(false);
    }
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
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      source.connect(g).connect(master);
      return { gain: g, source };
    };
    const screen_ = connect(screen, s.screenAudioGain);
    const device_ = connect(device, s.deviceGain);
    return { ctx, master, screenGain: screen_?.gain, screenSource: screen_?.source, deviceGain: device_?.gain, track: dest.stream.getAudioTracks()[0] };
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
    this.current = s;
    const video = this.displayStream?.getVideoTracks()[0];
    if (video) {
      video.contentHint = this.hintFor(s);
      if (s.fps !== this.appliedFps || s.height !== this.appliedHeight) {
        this.appliedHeight = s.height;
        this.appliedFps = s.fps;
        // applyConstraints replaces the whole set, so the size caps must be sent again,
        // and we must wait for it before reading the (possibly changed) source size.
        await video.applyConstraints(this.captureConstraints(s.fps, s.height)).catch(() => undefined);
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
    this.nudges = 0;
    this.startedAt = performance.now();
    this.lastNudgeAt = this.startedAt - 1500; // first check shortly after the first stats
    this.lastBytes = 0;
    this.lastStatsAt = 0;
    this.statsTimer = setInterval(() => void this.collectStats(), 1000);
  }

  private async collectStats() {
    const producer = this.videoProducer;
    if (!producer || !this.transport) return;
    // The capture size reported at the start can be provisional (the scale factor was computed from it).
    // When it settles on another value, rebuild the encoder parameters from the real size.
    const track = this.displayStream?.getVideoTracks()[0];
    const real = track?.getSettings();
    const known = this.source();
    if (real?.height && known && (real.height !== known.height || real.width !== known.width) && this.current) {
      this.updateSource(track!);
      await this.applyLive(this.current);
    }
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
      this.restoreResolutionIfStuck(top.frameHeight ?? 0, reason);
    } catch {
      /* transport closing */
    }
  }

  /** Resolution the top quality level should have: the source size divided by the scale we asked for. */
  private expectedHeight(): number {
    const s = this.current;
    const native = this.source()?.height ?? 0;
    return s && native ? Math.round(native / this.scaleFor(s)) : 0;
  }

  /**
   * Chrome starts encoding small while its bandwidth estimate is still ramping up, and does not always
   * come back to the requested size by itself (it only does after the encoder parameters are written again,
   * e.g. when the bitrate is changed). If the picture stays well below what was asked for and the CPU is not
   * the reason, write the parameters again, a few times at most.
   */
  private startedAt = 0;
  private restoreResolutionIfStuck(actualHeight: number, limitReason: string | undefined): void {
    const expected = this.expectedHeight();
    const now = performance.now();
    if (!expected || !actualHeight || this.nudges >= 10 || now - this.lastNudgeAt < 2000) return;
    // right after start Chrome may report 'cpu' while it is only ramping up, so only trust it later
    const early = now - this.startedAt < 15000;
    if (actualHeight >= expected * 0.85 || (limitReason === 'cpu' && !early)) return;
    this.nudges++;
    this.lastNudgeAt = now;
    void this.nudgeEncoder();
  }

  private async nudgeEncoder(): Promise<void> {
    const sender = this.videoProducer?.rtpSender;
    const s = this.current;
    if (!sender || !s) return;
    try {
      const desired = this.encodings(s);
      const write = async (bitrateFactor: number) => {
        const params = sender.getParameters();
        params.encodings.forEach((e, i) => {
          const d = desired[i];
          if (!d) return;
          e.maxBitrate = Math.round((d.maxBitrate ?? 0) * bitrateFactor);
          e.maxFramerate = d.maxFramerate;
          e.scaleResolutionDownBy = d.scaleResolutionDownBy;
        });
        await sender.setParameters(params);
      };
      // An identical write can be ignored, so go slightly lower first and then to the real value.
      await write(0.9);
      await new Promise((r) => setTimeout(r, 600)); // let the encoder act on the lower value first
      await write(1);
    } catch (e) {
      console.warn('Could not refresh the encoder', e);
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
