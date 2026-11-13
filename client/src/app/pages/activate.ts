import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Topbar } from '../shared/topbar';

@Component({
  selector: 'app-activate',
  imports: [FormsModule, RouterLink, Topbar],
  template: `
    <app-topbar />
    <main class="center">
      @if (step() === 'key') {
        <form class="card box" (ngSubmit)="check()">
          <h1>Activate your account</h1>
          <p class="muted">Enter the key you received from the administrator or from a friend who invited you.</p>
          <div class="field">
            <label for="key">Key</label>
            <input id="key" type="text" name="key" [(ngModel)]="key" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" autofocus required />
          </div>
          <button class="btn primary wide" type="submit" [disabled]="busy() || !key">Continue</button>
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
          <p class="alt">Already have an account? <a routerLink="/login">Sign in</a></p>
        </form>
      } @else {
        <form class="card box" (ngSubmit)="finish()">
          <h1>{{ kind() === 'activation' ? 'Welcome, ' + fixedName() : 'Create your account' }}</h1>
          <p class="muted">
            @if (kind() === 'activation') {
              Choose a password to finish activating your account.
            } @else {
              Pick a name and a password. You'll use them to sign in.
            }
          </p>
          @if (kind() === 'referral') {
            <div class="field">
              <label for="name">Name <small>(3-24 letters, digits, _ or -)</small></label>
              <input id="name" type="text" name="name" [(ngModel)]="name" autocomplete="username" required />
            </div>
          }
          <div class="field">
            <label for="pw">Password <small>(min. 8 characters)</small></label>
            <input id="pw" type="password" name="pw" [(ngModel)]="password" autocomplete="new-password" required minlength="8" />
          </div>
          <div class="field">
            <label for="pw2">Repeat password</label>
            <input id="pw2" type="password" name="pw2" [(ngModel)]="repeat" autocomplete="new-password" required />
          </div>
          <button class="btn primary wide" type="submit" [disabled]="busy() || !password || !repeat || (kind() === 'referral' && !name)">Activate</button>
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
        </form>
      }
    </main>
  `,
  styles: `
    .center {
      min-height: calc(100dvh - 60px);
      display: grid;
      place-items: center;
      padding: 1rem;
    }
    .box {
      width: min(420px, 100%);
      h1 {
        margin: 0 0 0.3rem;
        font-size: 1.4rem;
      }
      .muted {
        margin: 0 0 1.2rem;
        font-size: 0.92rem;
      }
    }
    .wide {
      width: 100%;
    }
    .alt {
      margin: 1rem 0 0;
      font-size: 0.88rem;
      text-align: center;
      color: var(--muted);
    }
    small {
      font-weight: 400;
      opacity: 0.8;
    }
  `,
})
export class Activate implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly step = signal<'key' | 'details'>('key');
  protected readonly kind = signal<'activation' | 'referral'>('activation');
  protected readonly fixedName = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected key = '';
  protected name = '';
  protected password = '';
  protected repeat = '';

  ngOnInit(): void {
    const fromLink = this.route.snapshot.queryParamMap.get('key');
    if (fromLink) {
      this.key = fromLink;
      void this.check();
    }
  }

  protected async check(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const info = await this.api.get<{ kind: 'activation' | 'referral'; name?: string }>(`/api/activate/check?key=${encodeURIComponent(this.key.trim())}`);
      this.kind.set(info.kind);
      this.fixedName.set(info.name ?? '');
      this.step.set('details');
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async finish(): Promise<void> {
    this.error.set(null);
    if (this.password.length < 8) return void this.error.set('The password must have at least 8 characters.');
    if (this.password !== this.repeat) return void this.error.set('The passwords do not match.');
    this.busy.set(true);
    try {
      await this.auth.activate(this.key.trim(), this.password, this.kind() === 'referral' ? this.name.trim() : undefined);
      await this.router.navigateByUrl('/dashboard');
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }
}
