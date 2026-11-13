import { Component, OnInit, inject, signal } from '@angular/core';
import { TPipe } from '../core/i18n.service';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import type { LobbyRoom } from '../core/models';
import { Topbar } from '../shared/topbar';

@Component({
  selector: 'app-home',
  imports: [RouterLink, Topbar, TPipe],
  template: `
    <app-topbar />
    <main class="page">
      <section class="hero">
        <h1>{{ 'Live screen sharing' | t }}</h1>
        <p>{{ 'Watch a stream in one click, or sign in to share your own screen.' | t }}</p>
      </section>

      <div class="tiles">
        <a class="tile" routerLink="/r/main">
          <div class="row">
            <h2>{{ 'Main stream' | t }}</h2>
            @if (main()?.live) {
              <span class="badge live">{{ 'LIVE' | t }}</span>
            } @else {
              <span class="badge">{{ 'offline' | t }}</span>
            }
          </div>
          <p>{{ 'The house channel. Opens straight into the player.' | t }}</p>
        </a>

        <a class="tile" routerLink="/lobbies">
          <div class="row">
            <h2>{{ 'Public rooms' | t }}</h2>
            @if (liveCount() > 0) {
              <span class="badge live">{{ '{n} live' | t: { n: liveCount() } }}</span>
            }
          </div>
          <p>{{ 'Pick a room that anyone can watch.' | t }}</p>
        </a>

        @if (auth.me(); as me) {
          <a class="tile" routerLink="/dashboard">
            <h2>{{ 'Dashboard' | t }}</h2>
            <p>{{ 'Signed in as {name}. Manage your rooms and start streaming.' | t: { name: me.name } }}</p>
          </a>
        } @else {
          <a class="tile" routerLink="/login">
            <h2>{{ 'Sign in' | t }}</h2>
            <p>{{ 'For the admin and invited users: create rooms and share your screen.' | t }}</p>
          </a>
        }

        <a class="tile" routerLink="/activate">
          <h2>{{ 'I have an invite key' | t }}</h2>
          <p>{{ 'Activate your account with the key you received.' | t }}</p>
        </a>
      </div>
    </main>
  `,
  styles: `
    .hero {
      padding: 2.5rem 0 1.8rem;
      h1 {
        margin: 0 0 0.4rem;
        font-size: 2rem;
      }
      p {
        margin: 0;
        color: var(--muted);
        font-size: 1.05rem;
      }
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 1rem;
    }
    .tile {
      display: block;
      padding: 1.1rem 1.2rem;
      border-radius: var(--radius);
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      transition: border-color 0.15s, transform 0.15s;
      &:hover {
        border-color: var(--accent);
        transform: translateY(-2px);
      }
      h2 {
        margin: 0;
        font-size: 1.1rem;
      }
      p {
        margin: 0.5rem 0 0;
        color: var(--muted);
        font-size: 0.92rem;
      }
    }
  `,
})
export class Home implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  protected readonly main = signal<{ live: boolean } | null>(null);
  protected readonly liveCount = signal(0);

  async ngOnInit(): Promise<void> {
    try {
      const [{ rooms }, main] = await Promise.all([
        this.api.get<{ rooms: LobbyRoom[] }>('/api/lobbies'),
        this.api.get<{ live: boolean }>('/api/rooms/main/info'),
      ]);
      this.liveCount.set(rooms.filter((r) => r.live && r.slug !== 'main').length);
      this.main.set(main);
    } catch {
      /* the tiles still work without the live badges */
    }
  }
}
