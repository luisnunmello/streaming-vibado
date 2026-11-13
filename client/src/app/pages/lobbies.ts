import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { I18nService, TPipe } from '../core/i18n.service';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import type { LobbyRoom } from '../core/models';
import { Topbar } from '../shared/topbar';

@Component({
  selector: 'app-lobbies',
  imports: [RouterLink, Topbar, TPipe],
  template: `
    <app-topbar />
    <main class="page">
      <h1 class="page-title">{{ 'Public rooms' | t }}</h1>
      @if (error()) {
        <p class="error">{{ error() | t }}</p>
      }
      @if (loaded() && rooms().length === 0) {
        <p class="muted">{{ 'There are no public rooms yet.' | t }}</p>
      }
      <div class="grid">
        @for (r of rooms(); track r.slug) {
          <a class="room" [routerLink]="['/r', r.slug]">
            <div class="row">
              <h2>{{ i18n.roomName(r) }}</h2>
              <span class="spacer"></span>
              @if (r.live) {
                <span class="badge live">{{ 'LIVE' | t }}</span>
              }
            </div>
            <p class="muted">{{ 'by {name}' | t: { name: r.ownerName } }}</p>
            <p class="meta">
              @if (r.live) {
                {{ '{n} watching' | t: { n: r.viewers } }}
              } @else {
                {{ 'Offline' | t }}
              }
            </p>
          </a>
        }
      </div>
    </main>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 1rem;
    }
    .room {
      display: block;
      padding: 1rem 1.1rem;
      border-radius: var(--radius);
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      transition: border-color 0.15s;
      &:hover {
        border-color: var(--accent);
      }
      h2 {
        margin: 0;
        font-size: 1.05rem;
      }
      p {
        margin: 0.35rem 0 0;
        font-size: 0.9rem;
      }
      .meta {
        color: var(--text);
      }
    }
  `,
})
export class Lobbies implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  protected readonly i18n = inject(I18nService);
  protected readonly rooms = signal<LobbyRoom[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    void this.load();
    this.timer = setInterval(() => void this.load(), 5000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  private async load(): Promise<void> {
    try {
      this.rooms.set((await this.api.get<{ rooms: LobbyRoom[] }>('/api/lobbies')).rooms);
      this.error.set(null);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.loaded.set(true);
    }
  }
}
