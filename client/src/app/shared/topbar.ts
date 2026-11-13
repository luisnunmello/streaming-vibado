import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-topbar',
  imports: [RouterLink],
  template: `
    <header>
      <a routerLink="/" class="brand">Streaming</a>
      <nav>
        <a routerLink="/lobbies">Public rooms</a>
      </nav>
      <span class="spacer"></span>
      @if (auth.me(); as me) {
        <a routerLink="/dashboard" class="btn small">{{ me.name }} · Dashboard</a>
      } @else {
        <a routerLink="/activate" class="link">Have a key?</a>
        <a routerLink="/login" class="btn small primary">Sign in</a>
      }
    </header>
  `,
  styles: `
    header {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.8rem 1.2rem;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    .brand {
      font-weight: 700;
      color: var(--text);
      text-decoration: none;
      font-size: 1.05rem;
    }
    nav a,
    .link {
      color: var(--muted);
      text-decoration: none;
      font-size: 0.92rem;
      &:hover {
        color: var(--text);
      }
    }
    .spacer {
      flex: 1;
    }
    a.btn {
      text-decoration: none;
    }
  `,
})
export class Topbar {
  protected readonly auth = inject(AuthService);
  constructor() {
    void this.auth.ensureLoaded();
  }
}
