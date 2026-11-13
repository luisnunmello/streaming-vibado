import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Account } from './account';
import { Appeal } from './appeal';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DialogService } from '../../core/dialog.service';
import { I18nService, TPipe } from '../../core/i18n.service';
import { ShareService } from '../../core/share.service';
import { LangSwitch } from '../../shared/lang-switch';
import { StreamerService } from '../../core/streamer.service';

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, Account, Appeal, LangSwitch, TPipe],
  template: `
    <header>
      <a routerLink="/" class="brand">{{ 'Streaming' | t }}</a>
      <nav>
        <a routerLink="/dashboard/rooms" routerLinkActive="on">{{ 'Rooms' | t }}</a>
        @if (auth.me()?.role === 'admin' || (auth.me()?.limits?.maxTempInviteMinutes ?? 0) > 0) {
          <a routerLink="/dashboard/invites" routerLinkActive="on">{{ 'Invites' | t }}</a>
        }
        @if (auth.isUser() && (auth.me()?.referrals?.quota ?? 0) > 0) {
          <a routerLink="/dashboard/referrals" routerLinkActive="on">{{ 'Referrals' | t }}</a>
        }
        @if (auth.isAdmin()) {
          <a routerLink="/dashboard/users" routerLinkActive="on">{{ 'Users' | t }}@if ((auth.me()?.pendingAppeals ?? 0) > 0) { <span class="badge warn" [title]="'Appeals waiting for an answer' | t">{{ auth.me()?.pendingAppeals }}</span> }</a>
          <a routerLink="/dashboard/presets" routerLinkActive="on">{{ 'Presets' | t }}</a>
          <a routerLink="/dashboard/bandwidth" routerLinkActive="on">{{ 'Bandwidth' | t }}</a>
        }
        @if (auth.me() && auth.me()?.role !== 'guest') {
          <a routerLink="/dashboard/account" routerLinkActive="on">{{ 'Account' | t }}</a>
        }
      </nav>
      <span class="spacer"></span>
      @if (streamer.state() === 'live' && streamer.room(); as room) {
        <a [routerLink]="['/dashboard/rooms', room.slug]" class="livechip" [title]="'You are streaming. Click to go back to the studio.' | t">
          <i></i> {{ 'LIVE' | t }} · {{ liveRoomTitle(room.name) }}
        </a>
      }
      @if (auth.me() && !auth.me()?.restricted) {
        <button type="button" class="btn small primary" [disabled]="sharing" (click)="share()" [title]="'Go straight to your studio and pick a screen to share' | t">{{ 'Share screen' | t }}</button>
      }
      <app-lang-switch />
      @if (auth.me()) {
        @if (auth.me()?.guest; as g) {
          <span class="who">{{ 'Guest of {name}' | t: { name: g.creatorName } }} <span class="badge warn">{{ timeLeft(g.endsAt) }}</span></span>
          <button type="button" class="btn small" (click)="logout()">{{ 'Leave' | t }}</button>
        } @else {
          <span class="who">{{ auth.me()?.name }} <span class="badge">{{ auth.me()?.role | t }}</span></span>
          <button type="button" class="btn small" (click)="logout()">{{ 'Sign out' | t }}</button>
        }
      } @else {
        <a routerLink="/activate" class="link">{{ 'Have a key?' | t }}</a>
        <a routerLink="/login" class="btn small primary">{{ 'Sign in' | t }}</a>
      }
    </header>
    @if (auth.adminBackup()) {
      <div class="usingbar" role="status">
        <span>{{ 'Using the account of' | t }} <b>{{ auth.me()?.name }}</b> {{ '(admin debug mode). Everything you do here counts as that user.' | t }}</span>
        <button type="button" class="btn small" (click)="returnToAdmin()">{{ 'Return to admin' | t }}</button>
      </div>
    }
    <main class="page">
      @if (auth.me()?.restricted) {
        <div class="restricted" role="alert">
          <b>{{ 'Your account is restricted.' | t }}</b> {{ 'You cannot use this website right now.' | t }}
          <p>{{ 'Reason:' | t }} {{ auth.me()?.restrictedReason || ('No reason was given.' | t) }}</p>
          <p class="small">{{ 'Contact the administrator if you think this is a mistake. You can still change your name and password and sign out.' | t }}</p>
        </div>
        <div class="tabs" role="tablist">
          <button type="button" role="tab" [class.on]="tab === 'appeal'" (click)="tab = 'appeal'">
            {{ 'Appeal' | t }} @if (auth.me()?.appealStatus === 'pending') { <span class="badge warn">{{ 'sent' | t }}</span> }
          </button>
          <button type="button" role="tab" [class.on]="tab === 'account'" (click)="tab = 'account'">{{ 'Account' | t }}</button>
        </div>
        @if (tab === 'appeal') {
          <app-appeal />
        } @else {
          <app-account />
        }
      } @else {
        <router-outlet />
      }
    </main>
  `,
  styles: `
    .tabs {
      display: flex;
      gap: 0.3rem;
      margin-bottom: 1rem;
      button {
        padding: 0.45rem 1rem;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        color: var(--muted);
        font: inherit;
        cursor: pointer;
        &.on {
          color: var(--text);
          border-color: var(--accent);
        }
      }
    }
    .usingbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      flex-wrap: wrap;
      padding: 0.5rem 1rem;
      background: #b54708;
      color: #fff;
      font-size: 0.92rem;
    }
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
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.tickTimer = setInterval(() => this.nowTick.set(Date.now()), 1000);
    // Keeps limits and referral counts current on every page, and notices a session the server ended
    // (account disabled, password changed elsewhere). The studio gets limit changes instantly over its socket.
    this.timer = setInterval(async () => {
      const wasSignedIn = !!this.auth.me();
      if (!wasSignedIn) return; // visitors have nothing to refresh
      await this.auth.refresh();
      if (!this.auth.me()) await this.router.navigate(['/login']);
    }, 15_000);
  }

  ngOnDestroy(): void {
    clearInterval(this.tickTimer);
    clearInterval(this.timer);
  }

  protected tab: 'appeal' | 'account' = 'appeal';

  /** A room named after its owner ("fernando's room") reads in the current language. */
  protected liveRoomTitle(name: string): string {
    const me = this.auth.me()?.name ?? '';
    return this.i18n.roomName({ name, ownerName: me, autoName: name === `${me}'s room` });
  }
  protected sharing = false;
  private readonly shareSvc = inject(ShareService);
  private readonly dialog = inject(DialogService);
  private readonly i18n = inject(I18nService);

  protected async share(): Promise<void> {
    this.sharing = true;
    try {
      await this.shareSvc.shareScreen();
    } catch (e: any) {
      await this.dialog.ask({ title: this.i18n.t('Could not start sharing'), message: e.message ?? String(e), confirmLabel: this.i18n.t('OK'), cancelLabel: this.i18n.t('Close') });
    } finally {
      this.sharing = false;
    }
  }

  protected async returnToAdmin(): Promise<void> {
    await this.streamer.leave(); // anything started as the user ends here
    await this.auth.returnToAdmin();
    await this.router.navigateByUrl('/dashboard/users');
  }

  /** Remaining time of a guest's invite, as m:ss (ticks every second). */
  protected timeLeft(endsAt: number): string {
    const s = Math.max(0, Math.floor((endsAt - this.nowTick()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  private readonly nowTick = signal(Date.now());
  private tickTimer?: ReturnType<typeof setInterval>;

  protected async logout(): Promise<void> {
    if (this.auth.me()?.role === 'guest') {
      // leaving gives the invite back
      await this.streamer.leave();
      try {
        await this.api.post('/api/me/invite/leave');
      } catch {
        /* already over */
      }
      this.auth.clear();
      await this.router.navigateByUrl('/');
      return;
    }
    if (this.auth.adminBackup()) return this.returnToAdmin(); // signing out of a borrowed account goes back to admin
    await this.streamer.leave(); // signing out ends any running stream
    await this.auth.logout();
    await this.router.navigateByUrl('/');
  }
}
