import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { I18nService, TPipe } from '../core/i18n.service';
import { Topbar } from '../shared/topbar';

/** Landing page of a temporary invite link: shows who invited you and lets you accept. */
@Component({
  selector: 'app-invite',
  imports: [Topbar, TPipe],
  template: `
    <app-topbar />
    <main class="center">
      <div class="card box">
        @if (!loaded()) {
          <p class="muted">{{ 'Checking the invite…' | t }}</p>
        } @else if (info(); as i) {
          <h1>{{ 'You were invited' | t }}</h1>
          <p>
            <b>{{ i.creatorName }}</b>
            {{ 'lets you share your screen in their room' | t }}
            <b>{{ i18n.roomName({ name: i.roomName, ownerName: i.creatorName, autoName: i.autoName }) }}</b>
            {{ 'for {n} minutes. You need no account.' | t: { n: i.minutes } }}
          </p>
          <p class="muted">{{ 'The time starts when you accept. You can leave at any time, and so can they.' | t }}</p>
          @if (error()) {
            <p class="error">{{ error() | t }}</p>
          }
          <button type="button" class="btn primary wide" [class.busy]="busy()" [disabled]="busy()" (click)="accept()">{{ 'Accept the invite' | t }}</button>
        } @else {
          <h1>{{ 'Invite not available' | t }}</h1>
          <p class="muted">{{ 'This invite is invalid, expired or already used' | t }}</p>
        }
      </div>
    </main>
  `,
  styles: `
    .center {
      display: grid;
      place-items: center;
      padding: 2rem 1rem;
    }
    .box {
      width: min(440px, 100%);
    }
    h1 {
      margin: 0 0 0.8rem;
      font-size: 1.3rem;
    }
    .wide {
      width: 100%;
    }
  `,
})
export class Invite implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18nService);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<{ creatorName: string; roomName: string; autoName: boolean; minutes: number } | null>(null);
  private key = '';

  async ngOnInit(): Promise<void> {
    this.key = this.route.snapshot.queryParamMap.get('key') ?? '';
    try {
      this.info.set(await this.api.get(`/api/invites/check?key=${encodeURIComponent(this.key)}`));
    } catch {
      this.info.set(null);
    } finally {
      this.loaded.set(true);
    }
  }

  protected async accept(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const { token } = await this.api.post<{ token: string }>('/api/invites/redeem', { key: this.key });
      this.api.setToken(token);
      await this.auth.refresh();
      await this.router.navigateByUrl('/dashboard/rooms');
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }
}
