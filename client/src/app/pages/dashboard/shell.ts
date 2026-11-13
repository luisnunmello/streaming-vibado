import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Account } from './account';
import { AuthService } from '../../core/auth.service';
import { StreamerService } from '../../core/streamer.service';

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, Account],
  template: `
    <header>
      <a routerLink="/" class="brand">Streaming</a>
      <nav>
        <a routerLink="/dashboard/rooms" routerLinkActive="on">Rooms</a>
        @if (auth.isUser() && (auth.me()?.referrals?.quota ?? 0) > 0) {
          <a routerLink="/dashboard/referrals" routerLinkActive="on">Referrals</a>
        }
        @if (auth.isAdmin()) {
          <a routerLink="/dashboard/users" routerLinkActive="on">Users</a>
          <a routerLink="/dashboard/presets" routerLinkActive="on">Presets</a>
          <a routerLink="/dashboard/bandwidth" routerLinkActive="on">Bandwidth</a>
        }
        <a routerLink="/dashboard/account" routerLinkActive="on">Account</a>
      </nav>
      <span class="spacer"></span>
      @if (streamer.state() === 'live' && streamer.room(); as room) {
        <a [routerLink]="['/dashboard/rooms', room.slug]" class="livechip" title="You are streaming. Click to go back to the studio.">
          <i></i> LIVE · {{ room.name }}
        </a>
      }
      <a routerLink="/lobbies" class="link">Public rooms</a>
      <span class="who">{{ auth.me()?.name }} <span class="badge">{{ auth.me()?.role }}</span></span>
      <button type="button" class="btn small" (click)="logout()">Sign out</button>
    </header>
    <main class="page">
      @if (auth.me()?.restricted) {
        <div class="restricted" role="alert">
          <b>Your account is restricted.</b> You cannot use this website right now.
          <p>Reason: {{ auth.me()?.restrictedReason || 'No reason was given.' }}</p>
          <p class="small">Contact the administrator if you think this is a mistake. You can still change your name and password and sign out.</p>
        </div>
        <app-account />
      } @else {
        <router-outlet />
      }
    </main>
  `,
  styles: `
    .restricted {
      margin-bottom: 1rem;
      padding: 1rem 1.2rem;
      border-radius: 10px;
      border: 1px solid #d92d20;
      background: rgba(217, 45, 32, 0.15);
      color: #ffb4ad;
      font-size: 1.05rem;
      p {
        margin: 0.5rem 0 0;
        color: #ffd5d1;
      }
      .small {
        font-size: 0.85rem;
        opacity: 0.85;
      }
    }
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
    .livechip {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.3rem 0.7rem;
      border-radius: 999px;
      border: 1px solid #d92d20;
      background: rgba(217, 45, 32, 0.15);
      color: #ff8b82;
      font-size: 0.82rem;
      font-weight: 600;
      text-decoration: none;
      i {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #ff5b4d;
        animation: blink 1.6s ease-in-out infinite;
      }
    }
    @keyframes blink {
      50% {
        opacity: 0.3;
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
export class Shell implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly streamer = inject(StreamerService);
  private readonly router = inject(Router);
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    // Keeps limits and referral counts current on every page, and notices a session the server ended
    // (account disabled, password changed elsewhere). The studio gets limit changes instantly over its socket.
    this.timer = setInterval(async () => {
      await this.auth.refresh();
      if (!this.auth.me()) await this.router.navigate(['/login']);
    }, 15_000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected async logout(): Promise<void> {
    await this.streamer.leave(); // signing out ends any running stream
    await this.auth.logout();
    await this.router.navigateByUrl('/');
  }
}
