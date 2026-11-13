import { Injectable, Signal, computed, signal } from '@angular/core';
import type { StreamerService } from './streamer.service';

export interface ControlPreset {
  label: string;
  active: boolean;
}

/**
 * What a streamer can do from a control bar. Implemented directly on the streamer service
 * (same tab as the capture) and over a BroadcastChannel (another tab of the site).
 */
export interface ControlSource {
  readonly live: Signal<boolean>;
  readonly muted: Signal<boolean>;
  readonly hasAudio: Signal<boolean>;
  readonly changing: Signal<boolean>;
  /** A request to change screen is waiting for a click in the studio tab. */
  readonly requested: Signal<boolean>;
  readonly presets: Signal<ControlPreset[]>;
  changeScreen(): void;
  toggleMute(): void;
  applyPreset(index: number): void;
  stop(): void;
}

/** Controls for the stream running in this very tab. */
export function localControls(s: StreamerService): ControlSource {
  return {
    live: computed(() => s.state() === 'live'),
    muted: computed(() => s.settings().muted),
    hasAudio: s.hasAudio,
    changing: s.changingSource,
    requested: signal(false),
    presets: computed(() => s.status().presets),
    changeScreen: () => void s.changeSource(),
    toggleMute: () => s.toggleMute(),
    applyPreset: (i) => {
      const p = s.presetChoices()[i];
      if (p) s.applyPreset(p);
    },
    stop: () => void s.stop(),
  };
}

interface RemoteStatus {
  t: 'status';
  slug: string | null;
  live: boolean;
  muted: boolean;
  changing: boolean;
  requested: boolean;
  hasAudio: boolean;
  presets: ControlPreset[];
}

/** Talks to the studio tab (where the capture runs) from another tab of the site. */
@Injectable({ providedIn: 'root' })
export class StreamerRemote {
  private readonly channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('streamer-control') : undefined;
  private readonly status = signal<RemoteStatus | null>(null);
  private lastSeen = 0;

  constructor() {
    if (!this.channel) return;
    this.channel.onmessage = (ev) => {
      if (ev.data?.t === 'status') {
        this.status.set(ev.data);
        this.lastSeen = Date.now();
      }
    };
    // The studio sends a heartbeat while live; when it stops, the controls go away.
    setInterval(() => {
      if (this.status() && Date.now() - this.lastSeen > 6000) this.status.set(null);
    }, 2000);
  }

  /** Asks any studio tab to announce itself. */
  ping(): void {
    this.channel?.postMessage({ t: 'hello' });
  }

  /** Controls for the stream of `slug`, when a studio tab is streaming it. */
  forRoom(slug: () => string): ControlSource {
    const mine = () => {
      const st = this.status();
      return st && st.slug === slug() && st.live ? st : null;
    };
    return {
      live: computed(() => !!mine()),
      muted: computed(() => mine()?.muted ?? false),
      hasAudio: computed(() => mine()?.hasAudio ?? false),
      changing: computed(() => mine()?.changing ?? false),
      requested: computed(() => mine()?.requested ?? false),
      presets: computed(() => mine()?.presets ?? []),
      changeScreen: () => this.channel?.postMessage({ t: 'changeSource' }),
      toggleMute: () => this.channel?.postMessage({ t: 'mute', value: !(mine()?.muted ?? false) }),
      applyPreset: (index) => this.channel?.postMessage({ t: 'preset', index }),
      stop: () => this.channel?.postMessage({ t: 'stop' }),
    };
  }
}
