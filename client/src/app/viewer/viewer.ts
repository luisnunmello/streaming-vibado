import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, combineLatest } from 'rxjs';
import { ApiService } from '../core/api.service';
import { localControls, StreamerRemote } from '../core/stream-controls';
import { StreamerService } from '../core/streamer.service';
import { ViewerService, type Quality } from '../core/viewer.service';
import { ControlBar } from '../shared/control-bar';

@Component({
  selector: 'app-viewer',
  imports: [RouterLink, ControlBar],
  templateUrl: './viewer.html',
  styleUrl: './viewer.scss',
  host: { '(document:fullscreenchange)': 'onFullscreenChange()' },
})
export class Viewer implements OnInit, OnDestroy {
  protected readonly v = inject(ViewerService);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly streamer = inject(StreamerService);
  private readonly remote = inject(StreamerRemote);
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  protected readonly muted = signal(true);
  protected readonly volume = signal(1);
  protected readonly showStats = signal(false);
  protected readonly fullscreen = signal(false);
  protected readonly controlsVisible = signal(true);
  protected readonly needsUnmute = computed(() => this.muted() && this.v.hasAudio());

  // ---- streamer controls, for the owner of the room (the admin owns the main room)
  protected readonly slug = signal('');
  /** The signed-in visitor owns this room. */
  protected readonly mine = signal(false);
  protected readonly showControls = signal(false);
  /** The stream is running in this very tab (the studio was left without stopping it). */
  protected readonly localActive = computed(() => this.streamer.state() !== 'idle' && this.streamer.room()?.slug === this.slug());
  private readonly localCtl = localControls(this.streamer);
  private readonly remoteCtl = this.remote.forRoom(() => this.slug());
  /** Controls to show: this tab's stream, or the studio tab's. */
  protected readonly ctl = computed(() => (this.localActive() ? this.localCtl : this.remoteCtl));
  protected readonly canControl = computed(() => this.mine() && (this.localActive() || this.remoteCtl.live()));
  private pingTimer?: ReturnType<typeof setInterval>;
  protected readonly qualities: { value: Quality; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ];
  private hideTimer?: ReturnType<typeof setTimeout>;
  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(([params, query]) => {
      const slug = params.get('slug') ?? '';
      const key = query.get('key') ?? undefined;
      this.slug.set(slug);
      this.v.start(slug, key);
      void this.checkOwnership(slug, key);
    });
    this.pingTimer = setInterval(() => this.mine() && this.remote.ping(), 3000);
    queueMicrotask(() => {
      const el = this.video().nativeElement;
      el.srcObject = this.v.stream;
      el.play().catch(() => undefined);
    });
  }

  /** Asks the server whether the signed-in visitor owns this room (anonymous visitors never do). */
  private async checkOwnership(slug: string, key?: string): Promise<void> {
    this.mine.set(false);
    if (!this.api.token()) return;
    try {
      const info = await this.api.get<{ mine: boolean }>(`/api/rooms/${encodeURIComponent(slug)}/info${key ? '?key=' + encodeURIComponent(key) : ''}`);
      this.mine.set(!!info.mine);
      if (info.mine) this.remote.ping();
    } catch {
      /* not signed in, or the room is not visible: no controls */
    }
  }

  ngOnDestroy(): void {
    clearInterval(this.pingTimer);
    clearTimeout(this.hideTimer);
    this.sub?.unsubscribe();
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
