import { Component, ElementRef, OnInit, OnDestroy, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { StreamerService } from '../core/streamer.service';
import {
  CODECS,
  PRESETS,
  type AudioMode,
  type Preset,
  type StreamSettings,
  clampSettings,
  fpsOptions,
  loadSettings,
  resolutionOptions,
  saveSettings,
} from '../core/stream-settings';

@Component({
  selector: 'app-streamer-panel',
  templateUrl: './streamer-panel.html',
  styleUrl: './streamer-panel.scss',
})
export class StreamerPanel implements OnInit, OnDestroy {
  protected readonly s = inject(StreamerService);
  protected readonly settings = signal<StreamSettings>(clampSettings(loadSettings({ adaptive: !!this.s.limits(), codec: this.s.limits() ? 'vp8' : 'h264' }), this.s.limits()));
  protected readonly devices = signal<MediaDeviceInfo[]>([]);
  // Everything below follows the account's limits, which the admin can change while this page is open.
  protected readonly presets = computed(() => this.distinctPresets());
  protected readonly resolutions = computed(() => resolutionOptions(this.s.limits()));
  protected readonly maxBitrate = computed(() => this.s.limits()?.maxBitrateMbps ?? 40);
  protected readonly codecs = CODECS;
  protected readonly fpsChoices = computed(() => fpsOptions(this.s.limits()));
  protected readonly audioModes: { value: AudioMode; label: string; hint: string }[] = [
    { value: 'none', label: 'No screen audio', hint: 'Nothing from the screen is sent.' },
    { value: 'system', label: 'Everything', hint: 'All sound from the shared screen (or tab).' },
    { value: 'window', label: 'Shared window only', hint: 'Only sound from the window you pick; other apps are excluded. Chrome/Edge on Windows.' },
  ];

  protected readonly secure = window.isSecureContext && !!navigator.mediaDevices?.getDisplayMedia;
  protected readonly live = computed(() => this.s.state() === 'live');
  protected readonly busy = computed(() => this.s.state() !== 'idle');
  protected readonly codecHint = computed(() => CODECS.find((c) => c.value === this.settings().codec)?.hint ?? '');
  protected readonly audioHint = computed(() => this.audioModes.find((m) => m.value === this.settings().audioMode)?.hint ?? '');
  protected readonly egressMbps = computed(() => Math.round(this.s.viewers() * this.settings().bitrateMbps * 10) / 10);

  private readonly previewEl = viewChild<ElementRef<HTMLVideoElement>>('preview');
  private applyTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const el = this.previewEl()?.nativeElement;
      const stream = this.s.preview();
      if (el) el.srcObject = stream;
    });
    // When the limits change (live, from the admin), pull the current settings inside them. If that changes
    // anything, the effect below sends it to the running encoder.
    effect(() => {
      const limits = this.s.limits();
      untracked(() =>
        this.settings.update((cur) => {
          const next = clampSettings(cur, limits);
          return JSON.stringify(next) === JSON.stringify(cur) ? cur : next;
        }),
      );
    });
    // Persist settings and push live-adjustable ones to the running encoder.
    effect(() => {
      const cur = this.settings();
      saveSettings(cur);
      untracked(() => {
        clearTimeout(this.applyTimer);
        this.applyTimer = setTimeout(() => void this.s.applyLive(cur), 150);
      });
    });
  }

  ngOnInit(): void {
    void this.refreshDevices(false);
  }

  ngOnDestroy(): void {
    clearTimeout(this.applyTimer);
  }

  protected patch(values: Partial<StreamSettings>): void {
    this.settings.update((cur) => ({ ...cur, ...values }));
  }

  protected applyPreset(p: Preset): void {
    this.settings.update((cur) => clampSettings({ ...cur, ...p.values }, this.s.limits()));
  }

  protected isPreset(p: Preset): boolean {
    const cur = this.settings() as unknown as Record<string, unknown>;
    const want = clampSettings({ ...this.settings(), ...p.values }, this.s.limits()) as unknown as Record<string, unknown>;
    return Object.keys(p.values).every((k) => cur[k] === want[k]);
  }

  /** Within an account's limits several presets collapse into the same thing: show each result once. */
  private distinctPresets(): Preset[] {
    const limits = this.s.limits();
    if (!limits) return PRESETS;
    const seen = new Set<string>();
    return PRESETS.filter((p) => {
      const c = clampSettings({ ...loadSettings(), ...p.values }, limits);
      const id = [c.height, c.fps, c.bitrateMbps, c.priority].join();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  protected async refreshDevices(askPermission: boolean): Promise<void> {
    try {
      this.devices.set(await this.s.listAudioInputs(askPermission));
    } catch {
      this.devices.set([]);
    }
  }

  protected toggle(): void {
    if (this.s.state() === 'idle') void this.s.start(this.settings());
    else void this.s.stop();
  }

  protected deviceLabel(d: MediaDeviceInfo, i: number): string {
    return d.label || `Audio input ${i + 1}`;
  }
}
