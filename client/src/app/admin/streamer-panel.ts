import { Component, ElementRef, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { TPipe } from '../core/i18n.service';
import { localControls } from '../core/stream-controls';
import { StreamerService } from '../core/streamer.service';
import { CODECS, type AudioMode, type Preset, type StreamSettings, fpsOptions, isPresetActive, resolutionOptions } from '../core/stream-settings';
import { BrowserWarning } from '../shared/browser-warning';
import { ControlBar } from '../shared/control-bar';

@Component({
  selector: 'app-streamer-panel',
  imports: [BrowserWarning, ControlBar, TPipe],
  templateUrl: './streamer-panel.html',
  styleUrl: './streamer-panel.scss',
  host: { '(document:fullscreenchange)': 'onFullscreenChange()' },
})
export class StreamerPanel implements OnInit {
  protected readonly s = inject(StreamerService);
  /** The settings live in the service, so the preview controls and other tabs change the same thing. */
  protected readonly settings = this.s.settings;
  protected readonly local = localControls(this.s);
  protected readonly devices = signal<MediaDeviceInfo[]>([]);
  // Everything below follows the account's limits, which the admin can change while this page is open.
  protected readonly presets = this.s.presetChoices;
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
  protected readonly fullscreen = signal(false);
  protected readonly codecHint = computed(() => CODECS.find((c) => c.value === this.settings().codec)?.hint ?? '');
  protected readonly audioHint = computed(() => this.audioModes.find((m) => m.value === this.settings().audioMode)?.hint ?? '');
  protected readonly egressMbps = computed(() => Math.round(this.s.viewers() * this.settings().bitrateMbps * 10) / 10);

  private readonly previewEl = viewChild<ElementRef<HTMLVideoElement>>('preview');
  private readonly screenEl = viewChild<ElementRef<HTMLElement>>('screen');

  constructor() {
    effect(() => {
      const el = this.previewEl()?.nativeElement;
      const stream = this.s.preview();
      if (el) el.srcObject = stream;
    });
  }

  ngOnInit(): void {
    void this.refreshDevices(false);
  }

  protected patch(values: Partial<StreamSettings>): void {
    this.s.patch(values);
  }

  protected applyPreset(p: Preset): void {
    this.s.applyPreset(p);
  }

  protected isPreset(p: Preset): boolean {
    return isPresetActive(p, this.settings(), this.s.limits());
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

  protected onFullscreenChange(): void {
    this.fullscreen.set(document.fullscreenElement === this.screenEl()?.nativeElement);
  }

  /** The control bar is inside the element that goes fullscreen, so it stays usable. */
  protected async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await this.screenEl()?.nativeElement.requestFullscreen().catch(() => undefined);
  }
}
