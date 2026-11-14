import { Component, OnDestroy, OnInit, inject, signal, effect, DestroyRef } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Account } from './account';
import { Appeal } from './appeal';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DialogService } from '../../core/dialog.service';
import { I18nService, TPipe } from '../../core/i18n.service';
import { ShareService } from '../../core/share.service';
import { SoundService } from '../../core/sound.service';
import { APP_VERSION } from '../../core/version';
import { BugReport } from '../../shared/bug-report';
import { LangSwitch } from '../../shared/lang-switch';
import { StreamerService } from '../../core/streamer.service';

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, Account, Appeal, BugReport, LangSwitch, TPipe],
  template: `
    <header>
      <a routerLink="/" class="brand">{{ 'Streaming' | t }}</a>
      <span class="ver" [title]="'App version' | t">v{{ version }}</span>
      <div class="menu" [class.open]="menuOpen()" (click)="menuOpen.set(false)">
        <nav>
          <a routerLink="/dashboard/rooms" routerLinkActive="on">{{ 'Rooms' | t }}</a>
          @if (auth.me()?.role === 'admin' || (auth.me()?.limits?.maxTempInviteMinutes ?? 0) > 0) {
            <a routerLink="/dashboard/invites" routerLinkActive="on">{{ 'Invite guests' | t }}</a>
          }
          @if (auth.isUser() && (auth.me()?.referrals?.quota ?? 0) > 0) {
            <a routerLink="/dashboard/referrals" routerLinkActive="on">{{ 'Referrals' | t }}</a>
          }
          @if (auth.isAdmin()) {
            <a routerLink="/dashboard/users" routerLinkActive="on">{{ 'Users' | t }}@if ((auth.me()?.pendingAppeals ?? 0) > 0) { <span class="badge warn" [title]="'Appeals waiting for an answer' | t">{{ auth.me()?.pendingAppeals }}</span> }</a>
            <a routerLink="/dashboard/presets" routerLinkActive="on">{{ 'Presets' | t }}</a>
            <a routerLink="/dashboard/bandwidth" routerLinkActive="on">{{ 'Bandwidth' | t }}</a>
            <a routerLink="/dashboard/bugs" routerLinkActive="on">{{ 'Bug reports' | t }}@if ((auth.me()?.openBugs ?? 0) > 0) { <span class="badge warn" [title]="'Open bug reports' | t">{{ auth.me()?.openBugs }}</span> }</a>
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
        <button type="button" class="soundbtn" [class.muted]="sound.muted()" [attr.aria-pressed]="sound.muted()" [attr.aria-label]="(sound.muted() ? 'Sounds are muted. Click to turn them on.' : 'Mute sounds') | t" [title]="(sound.muted() ? 'Sounds are muted. Click to turn them on.' : 'Mute sounds') | t" (click)="$event.stopPropagation(); sound.toggleMuted()">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            @if (sound.muted()) {
              <path fill="currentColor" d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>
            } @else {
              <path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            }
          </svg>
        </button>
        <app-bug-report />
        <app-lang-switch (click)="$event.stopPropagation()" />
        @if (auth.me()) {
          @if (auth.me()?.guest; as g) {
            <span class="who">{{ 'Guest of {name}' | t: { name: g.creatorName } }} <span class="badge warn">{{ timeLeft(g.endsAt) }}</span></span>
            <button type="button" class="btn small out" (click)="logout()">{{ 'Leave' | t }}</button>
          } @else {
            <span class="who">{{ auth.me()?.name }} <span class="badge">{{ auth.me()?.role | t }}</span></span>
            <button type="button" class="btn small out" (click)="logout()">{{ 'Sign out' | t }}</button>
          }
        } @else {
          <a routerLink="/activate" class="link keyl">{{ 'Have a key?' | t }}</a>
          <a routerLink="/login" class="btn small primary out">{{ 'Sign in' | t }}</a>
        }
      </div>
      @if (auth.me() && !auth.me()?.restricted) {
        <button type="button" class="btn small primary share" [class.pulsing]="streamer.state() === 'live'" [disabled]="sharing" (click)="share()" [title]="'Go straight to your studio and pick a screen to share' | t">{{ 'Share screen' | t }}</button>
      }
      <button type="button" class="burger" [class.open]="menuOpen()" [attr.aria-expanded]="menuOpen()" [attr.aria-label]="'Menu' | t" (click)="menuOpen.set(!menuOpen())">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          @if (menuOpen()) {
            <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          } @else {
            <path fill="currentColor" d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/>
          }
        </svg>
        @if (streamer.state() === 'live') {
          <i class="dot" [title]="'You are streaming. Click to go back to the studio.' | t"></i>
        }
      </button>
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
    .ver {
      color: var(--muted);
      font-size: 0.75rem;
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
    header {
      position: relative;
    }
    /* ANIM:menu-icon */
    .burger svg {
      animation: burger-turn 0.25s ease;
    }
    @keyframes burger-turn {
      from {
        transform: rotate(-90deg) scale(0.8);
        opacity: 0.4;
      }
    }
    .burger {
      display: none;
      position: relative;
      width: 40px;
      height: 40px;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      color: var(--text);
      cursor: pointer;
      .dot {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #ff5b4d;
        animation: blink 1.6s ease-in-out infinite;
      }
    }
    /* Wide screens: the menu's items are part of the header row, in this order. */
    .menu {
      display: contents;
    }
    .menu nav {
      order: 1;
    }
    .menu .spacer {
      order: 2;
    }
    .menu .livechip {
      order: 3;
    }
    .share {
      order: 4;
    }
    .menu .soundbtn {
      order: 5;
    }
    .menu app-lang-switch {
      order: 5;
    }
    .soundbtn {
      display: inline-grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
      cursor: pointer;
      transition: background-color 0.15s, border-color 0.15s, color 0.15s;
      &:hover {
        border-color: #3a4766;
      }
      /* a clear red tint while muted */
      &.muted {
        color: #ff8b82;
        border-color: #d92d20;
        background: rgba(217, 45, 32, 0.22);
      }
    }
    .menu .who {
      order: 6;
    }
    .menu .out,
    .menu .keyl {
      order: 7;
    }
    @media (max-width: 1100px) {
      header {
        flex-wrap: nowrap;
        gap: 0.6rem;
        padding: 0.55rem 0.8rem;
      }
      /* the header stays on top while scrolling; the burger is always the last thing on the right */
      header {
        position: sticky;
        top: 0;
        z-index: 40;
      }
      .share {
        margin-left: auto;
        order: 1;
      }
      .burger {
        display: grid;
        order: 2;
        margin-left: 0;
      }
      header:not(:has(.share)) .burger {
        margin-left: auto;
      }
      /* the menu takes over the whole screen, under the header row */
      .brand,
      .share,
      .burger {
        position: relative;
        z-index: 31;
      }
      .menu {
        display: flex;
        /* ANIM:menu-slide (closed state + transition) */
        visibility: hidden;
        opacity: 0;
        transform: translateX(28px);
        pointer-events: none;
        transition: opacity 0.2s ease, transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s linear 0.25s;
        position: fixed;
        /* a side panel pinned to the right; full screen only on small widths (below) */
        top: 0;
        right: 0;
        bottom: 0;
        width: 340px;
        max-width: 100%;
        border-left: 1px solid var(--line);
        box-shadow: -12px 0 32px rgba(0, 0, 0, 0.35);
        z-index: 30;
        /* rows: nav, live chip and sign out take a full row; sound, language and user share one */
        flex-direction: row;
        flex-wrap: wrap;
        align-content: flex-start;
        align-items: center;
        gap: 0.7rem;
        padding: 4.2rem 1rem 1.5rem;
        background: var(--panel);
        overflow-y: auto;
      }
      @media (max-width: 600px) {
        .menu {
          width: auto;
          left: 0;
          max-width: none;
          border-left: 0;
          box-shadow: none;
        }
      }
      /* ANIM:menu-slide (open state) */
      .menu.open {
        visibility: visible;
        opacity: 1;
        transform: none;
        pointer-events: auto;
        transition: opacity 0.2s ease, transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s;
      }
      .menu > * {
        order: 0;
      }
      .menu nav,
      .menu .livechip,
      .menu .out,
      .menu .keyl {
        flex: 1 1 100%;
      }
      .menu nav {
        order: 1;
        flex-direction: column;
        flex-wrap: nowrap;
        gap: 0.2rem;
        a {
          padding: 0.65rem 0.8rem;
        }
      }
      .menu .spacer {
        display: none;
      }
      .menu .livechip {
        order: 0;
        justify-content: center;
      }
      .menu .soundbtn {
        order: 2;
        width: 38px;
        height: 38px;
      }
      .menu app-lang-switch {
        order: 2;
      }
      .menu .who {
        order: 3;
        flex: 1 1 0;
        min-width: 0;
        text-align: right;
      }
      .menu .out,
      .menu .keyl {
        order: 4;
        text-align: center;
      }
      .menu a.btn {
        text-decoration: none;
      }
    }
  `,
})
export class Shell implements OnInit, OnDestroy {
  protected readonly version = APP_VERSION;
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
  /** The hamburger menu (small screens). */
  protected readonly menuOpen = signal(false);
  private readonly lockScroll = effect(() => {
    // the page behind the full-screen menu must not scroll
    document.body.style.overflow = this.menuOpen() ? 'hidden' : '';
  });
  private readonly unlock = inject(DestroyRef).onDestroy(() => (document.body.style.overflow = ''));

  /** A room named after its owner ("fernando's room") reads in the current language. */
  protected liveRoomTitle(name: string): string {
    const me = this.auth.me()?.name ?? '';
    return this.i18n.roomName({ name, ownerName: me, autoName: name === `${me}'s room` });
  }
  protected sharing = false;
  private readonly shareSvc = inject(ShareService);
  protected readonly sound = inject(SoundService);
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
