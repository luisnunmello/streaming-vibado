import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { StreamerPanel } from '../../admin/streamer-panel';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { RoomView } from '../../core/models';
import { StreamerService } from '../../core/streamer.service';
import { absoluteUrl, copyText } from '../../core/util';

@Component({
  selector: 'app-studio',
  imports: [StreamerPanel, RouterLink],
  template: `
    <div class="row head">
      <a routerLink="/dashboard/rooms" class="btn small">← Rooms</a>
      @if (room(); as r) {
        <h1>{{ r.name }}</h1>
        <span class="badge" [class.good]="r.visibility === 'public'">{{ r.visibility }}</span>
        <span class="spacer"></span>
        <button type="button" class="btn small" (click)="copy(r)">{{ copied() ? 'Copied!' : 'Copy viewer link' }}</button>
        <a class="btn small" [href]="r.link" target="_blank" rel="noopener">Open viewer page ↗</a>
      }
    </div>

    @if (loading()) {
      <p class="muted">Joining room…</p>
    } @else if (error()) {
      <div class="card">
        <p class="error">{{ error() }}</p>
        <a routerLink="/dashboard/rooms" class="btn">Back to rooms</a>
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

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly room = signal<RoomView | null>(null);
  protected readonly copied = signal(false);

  async ngOnInit(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    try {
      const { rooms } = await this.api.get<{ rooms: RoomView[] }>('/api/rooms');
      this.room.set(rooms.find((r) => r.slug === slug) ?? null);
      await this.streamer.enter(slug, () => {
        this.auth.clear();
        void this.router.navigate(['/login']);
      });
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    void this.streamer.leave();
  }

  protected async copy(r: RoomView): Promise<void> {
    if (await copyText(absoluteUrl(r.link))) {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    }
  }
}
