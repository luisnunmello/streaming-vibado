import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ViewerService } from '../core/viewer.service';

@Component({
  selector: 'app-viewer',
  templateUrl: './viewer.html',
  styleUrl: './viewer.scss',
  host: { '(document:fullscreenchange)': 'onFullscreenChange()' },
})
export class Viewer implements OnInit, OnDestroy {
  protected readonly v = inject(ViewerService);
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  protected readonly muted = signal(true);
  protected readonly volume = signal(1);
  protected readonly showStats = signal(false);
  protected readonly fullscreen = signal(false);
  protected readonly controlsVisible = signal(true);
  protected readonly needsUnmute = computed(() => this.muted() && this.v.hasAudio());
  private hideTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.v.start();
    queueMicrotask(() => {
      const el = this.video().nativeElement;
      el.srcObject = this.v.stream;
      el.play().catch(() => undefined);
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.hideTimer);
    this.v.stop();
  }

  protected unmute(): void {
    this.setMuted(false);
  }

  protected toggleMute(): void {
    this.setMuted(!this.muted());
  }

  private setMuted(m: boolean): void {
    const el = this.video().nativeElement;
    el.muted = m;
    this.muted.set(m);
    if (!m && this.volume() === 0) this.setVolume(1);
    el.play().catch(() => undefined);
  }

  protected setVolume(value: number): void {
    const el = this.video().nativeElement;
    this.volume.set(value);
    el.volume = value;
    if (value > 0 && this.muted()) this.setMuted(false);
    else if (value === 0) this.setMuted(true);
  }

  protected onFullscreenChange(): void {
    this.fullscreen.set(!!document.fullscreenElement);
  }

  protected async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await this.stage().nativeElement.requestFullscreen().catch(() => undefined);
  }

  protected poke(): void {
    this.controlsVisible.set(true);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.controlsVisible.set(false), 3000);
  }
}
