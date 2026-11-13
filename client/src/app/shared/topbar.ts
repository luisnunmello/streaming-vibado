import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { TPipe } from '../core/i18n.service';
import { LangSwitch } from './lang-switch';

@Component({
  selector: 'app-topbar',
  imports: [RouterLink, LangSwitch, TPipe],
  template: `
    <header>
      <a routerLink="/" class="brand">{{ 'Streaming' | t }}</a>
      <nav>
        <a routerLink="/dashboard/rooms">{{ 'Public rooms' | t }}</a>
      </nav>
      <span class="spacer"></span>
      <app-lang-switch />
      @if (auth.me(); as me) {
        <a routerLink="/dashboard" class="btn small">{{ me.name }} · {{ 'Dashboard' | t }}</a>
      } @else {
        <a routerLink="/activate" class="link">{{ 'Have a key?' | t }}</a>
        <a routerLink="/login" class="btn small primary">{{ 'Sign in' | t }}</a>
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
    @media (max-width: 560px) {
      header {
        flex-wrap: wrap;
        gap: 0.5rem 0.8rem;
        padding: 0.6rem 0.8rem;
      }
      nav {
        order: 5;
      }
    }
  `,
})
export class Topbar {
  protected readonly auth = inject(AuthService);
  constructor() {
    void this.auth.ensureLoaded();
  }
}
