import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <header>
      <a routerLink="/" class="brand">Streaming</a>
      <nav>
        <a routerLink="/dashboard/rooms" routerLinkActive="on">Rooms</a>
        @if (auth.isGuest() && (auth.me()?.referrals?.quota ?? 0) > 0) {
          <a routerLink="/dashboard/referrals" routerLinkActive="on">Referrals</a>
        }
        @if (auth.isAdmin()) {
          <a routerLink="/dashboard/guests" routerLinkActive="on">Guests</a>
          <a routerLink="/dashboard/bandwidth" routerLinkActive="on">Bandwidth</a>
        }
        <a routerLink="/dashboard/account" routerLinkActive="on">Account</a>
      </nav>
      <span class="spacer"></span>
      <a routerLink="/lobbies" class="link">Public rooms</a>
      <span class="who">{{ auth.me()?.name }} <span class="badge">{{ auth.me()?.role }}</span></span>
      <button type="button" class="btn small" (click)="logout()">Sign out</button>
    </header>
    <main class="page">
      <router-outlet />
    </main>
  `,
  styles: `
    header {
      display: flex;
      align-items: center;
      gap: 1.2rem;
      flex-wrap: wrap;
      padding: 0.7rem 1.2rem;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    .brand {
      font-weight: 700;
      color: var(--text);
      text-decoration: none;
    }
    nav {
      display: flex;
      gap: 0.3rem;
      flex-wrap: wrap;
      a {
        color: var(--muted);
        text-decoration: none;
        padding: 0.35rem 0.7rem;
        border-radius: 8px;
        font-size: 0.93rem;
        &:hover {
          color: var(--text);
        }
        &.on {
          color: var(--text);
          background: var(--panel-2);
          box-shadow: inset 0 0 0 1px var(--line);
        }
      }
    }
    .link {
      color: var(--muted);
      text-decoration: none;
      font-size: 0.9rem;
      &:hover {
        color: var(--text);
      }
    }
    .who {
      font-size: 0.9rem;
    }
    .page {
      max-width: 1300px;
    }
  `,
})
export class Shell {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/');
  }
}
