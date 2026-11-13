import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { I18nService, TPipe } from '../core/i18n.service';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import type { LobbyRoom } from '../core/models';

@Component({
  selector: 'app-public-rooms',
  imports: [RouterLink, TPipe],
  template: `
      @if (error()) {
        <p class="error">{{ error() | t }}</p>
      }
      @if (loaded() && rooms().length === 0) {
        <p class="muted">{{ 'There are no public rooms yet.' | t }}</p>
      }
      @if (rooms().length > 0) {
        <div class="card">
          <div class="table-wrap">
            <table class="list stack">
              <thead>
                <tr>
                  <th>{{ 'Room' | t }}</th>
                  <th>{{ 'Owner' | t }}</th>
                  <th>{{ 'Status' | t }}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (r of rooms(); track r.slug) {
                  <tr>
                    <td>
                      <b>{{ i18n.roomName(r) }}</b>
                      <div class="muted slug">/r/{{ r.slug }}</div>
                    </td>
                    <td [attr.data-label]="'Owner' | t">{{ r.ownerName }}</td>
                    <td [attr.data-label]="'Status' | t">
                      @if (r.live) {
                        <span class="badge live">{{ 'LIVE' | t }}</span> <span class="muted">{{ '{n} watching' | t: { n: r.viewers } }}</span>
                      } @else {
                        <span class="muted">{{ 'offline' | t }}</span>
                      }
                    </td>
                    <td class="right">
                      <a class="btn small primary" [routerLink]="['/r', r.slug]">{{ 'Watch' | t }}</a>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
  `,
  styles: `
    .slug {
      font-size: 0.8rem;
    }
    .right {
      text-align: right;
    }
    a.btn {
      text-decoration: none;
    }
  `,
})
export class PublicRooms implements OnInit, OnDestroy {
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
