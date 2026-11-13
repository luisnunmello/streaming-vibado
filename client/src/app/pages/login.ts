import { Component, inject, signal } from '@angular/core';
import { TPipe } from '../core/i18n.service';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { Topbar } from '../shared/topbar';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, Topbar, TPipe],
  template: `
    <app-topbar />
    <main class="center">
      <form class="card box" (ngSubmit)="submit()">
        <h1>{{ 'Sign in' | t }}</h1>
        <p class="muted">{{ 'Users use the name they were given. The administrator signs in as' | t }} <b>{{ 'admin' | t }}</b>.</p>
        <div class="field">
          <label for="name">{{ 'Name' | t }}</label>
          <input id="name" type="text" name="name" [(ngModel)]="name" autocomplete="username" autofocus required />
        </div>
        <div class="field">
          <label for="pw">{{ 'Password' | t }}</label>
          <input id="pw" type="password" name="pw" [(ngModel)]="password" autocomplete="current-password" required />
        </div>
        <label class="check remember"><input type="checkbox" name="remember" [(ngModel)]="remember" /> {{ 'Remember me (stay signed in for 30 days)' | t }}</label>
        <button class="btn primary wide" type="submit" [class.busy]="busy()" [disabled]="busy() || !name || !password">{{ 'Sign in' | t }}</button>
        @if (error()) {
          <p class="error">{{ error() | t }}</p>
        }
        <p class="alt">{{ 'Have an invite key?' | t }} <a routerLink="/activate">{{ 'Activate your account' | t }}</a></p>
        <p class="alt access">{{ "Don't have a referral code and want access? Ask luis10barbo on Discord." | t }}</p>
      </form>
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
      width: min(400px, 100%);
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
    .remember {
      margin: 0.2rem 0 1.1rem;
    }
    .alt {
      margin: 1rem 0 0;
      font-size: 0.88rem;
      text-align: center;
      color: var(--muted);
    }
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected name = '';
  protected password = '';
  protected remember = false;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.name.trim(), this.password, this.remember);
      const next = this.route.snapshot.queryParamMap.get('next');
      await this.router.navigateByUrl(next && next.startsWith('/') ? next : '/dashboard');
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }
}
