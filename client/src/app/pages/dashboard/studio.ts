import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { StreamerPanel } from '../../admin/streamer-panel';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { RoomView } from '../../core/models';
import { I18nService, TPipe } from '../../core/i18n.service';
import { ShareService } from '../../core/share.service';
import { StreamerService } from '../../core/streamer.service';
import { absoluteUrl, copyText } from '../../core/util';

@Component({
  selector: 'app-studio',
  imports: [StreamerPanel, RouterLink, TPipe],
  template: `
    <div class="row head">
      <a routerLink="/dashboard/rooms" class="btn small">{{ '← Rooms' | t }}</a>
      @if (room(); as r) {
        <h1>{{ i18n.roomName(r) }}</h1>
        <span class="badge" [class.good]="r.visibility === 'public'">{{ r.visibility | t }}</span>
        <span class="spacer"></span>
        <button type="button" class="btn small" (click)="copy(r)">{{ (copied() ? 'Copied!' : 'Copy viewer link') | t }}</button>
        <button type="button" class="btn small" (click)="viewHere(r)" [title]="'The stream keeps running; the page has streamer controls' | t">{{ 'View in this tab' | t }}</button>
        <a class="btn small" [href]="r.link" target="_blank" rel="noopener" [title]="'In a new tab the page controls this studio tab remotely' | t">{{ 'Open in new tab ↗' | t }}</a>
      }
    </div>

    @if (loading()) {
      <p class="muted">{{ 'Joining room…' | t }}</p>
    } @else if (error()) {
      <div class="card">
        <p class="error">{{ error() | t }}</p>
        <a routerLink="/dashboard/rooms" class="btn">{{ 'Back to rooms' | t }}</a>
      </div>
    } @else {
      <app-streamer-panel />
    }
  `,
  styles: `
    .head {
      margin-bottom: 1rem;
      h1 {
        margin: 0;
        font-size: 1.3rem;
      }
      a {
        text-decoration: none;
      }
    }
  `,
})
export class Studio implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly streamer = inject(StreamerService);
  private readonly shareSvc = inject(ShareService);
  protected readonly i18n = inject(I18nService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly room = signal<RoomView | null>(null);
  protected readonly copied = signal(false);

  async ngOnInit(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    try {
      const { rooms } = await this.api.get<{ rooms: RoomView[] }>('/api/rooms');
      this.room.set(rooms.find((r) => r.slug === slug) ?? null);
      // Coming back to a room that is already live in this tab: keep it as it is.
      if (this.streamer.room()?.slug !== slug || this.streamer.state() === 'idle') {
        await this.streamer.enter(slug, () => {
          this.auth.clear();
          void this.router.navigate(['/login']);
        });
      }
      this.shareSvc.remember(slug);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.loading.set(false);
    }
    // Arrived through a "Share screen" button: open the screen picker right away. If the browser no longer
    // counts the click as a gesture it refuses quietly and the Start button is there as usual.
    if (this.route.snapshot.queryParamMap.has('share') && !this.error() && this.streamer.state() === 'idle') {
      await this.streamer.start(this.streamer.settings());
      if (this.streamer.error() === 'Screen sharing was cancelled.') this.streamer.error.set(null);
      void this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  ngOnDestroy(): void {
    // Leaving the page does not end a stream that is running (so the room's viewer page and other dashboard
    // pages in this tab can control it); an idle studio just disconnects.
    if (this.streamer.state() === 'idle') void this.streamer.leave();
  }

  /** Open the room's page in this tab. The stream keeps running and the page offers its controls. */
  protected viewHere(r: RoomView): void {
    void this.router.navigateByUrl(r.link);
  }

  protected async copy(r: RoomView): Promise<void> {
    if (await copyText(absoluteUrl(r.link))) {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    }
  }
}
