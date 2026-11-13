import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { Topbar } from '../shared/topbar';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, Topbar],
  template: `
    <app-topbar />
    <main class="center">
      <form class="card box" (ngSubmit)="submit()">
        <h1>Sign in</h1>
        <p class="muted">Users use the name they were given. The administrator signs in as <b>admin</b>.</p>
        <div class="field">
          <label for="name">Name</label>
          <input id="name" type="text" name="name" [(ngModel)]="name" autocomplete="username" autofocus required />
        </div>
        <div class="field">
          <label for="pw">Password</label>
          <input id="pw" type="password" name="pw" [(ngModel)]="password" autocomplete="current-password" required />
        </div>
        <label class="check remember"><input type="checkbox" name="remember" [(ngModel)]="remember" /> Remember me (stay signed in for 30 days)</label>
        <button class="btn primary wide" type="submit" [disabled]="busy() || !name || !password">Sign in</button>
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        <p class="alt">Have an invite key? <a routerLink="/activate">Activate your account</a></p>
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
