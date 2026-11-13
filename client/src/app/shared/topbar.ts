import { Component, inject, signal } from '@angular/core';
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
      <div class="menu" [class.open]="open()" (click)="open.set(false)">
        <nav>
          <a routerLink="/dashboard/rooms">{{ 'Public rooms' | t }}</a>
        </nav>
        <span class="spacer"></span>
        <app-lang-switch (click)="$event.stopPropagation()" />
        @if (auth.me(); as me) {
          <a routerLink="/dashboard" class="btn small">{{ me.name }} · {{ 'Dashboard' | t }}</a>
        } @else {
          <a routerLink="/activate" class="link">{{ 'Have a key?' | t }}</a>
          <a routerLink="/login" class="btn small primary">{{ 'Sign in' | t }}</a>
        }
      </div>
      <button type="button" class="burger" [attr.aria-expanded]="open()" [attr.aria-label]="'Menu' | t" (click)="open.set(!open())">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          @if (open()) {
            <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          } @else {
            <path fill="currentColor" d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/>
          }
        </svg>
      </button>
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
    header {
      position: relative;
    }
    .menu {
      display: contents;
    }
    .burger {
      display: none;
      width: 40px;
      height: 40px;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      color: var(--text);
      cursor: pointer;
    }
    @media (max-width: 640px) {
      header {
        gap: 0.6rem;
        padding: 0.55rem 0.8rem;
      }
      .burger {
        display: grid;
        margin-left: auto;
      }
      .menu {
        display: none;
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        z-index: 30;
        flex-direction: column;
        align-items: stretch;
        gap: 0.7rem;
        padding: 0.8rem;
        border-bottom: 1px solid var(--line);
        background: var(--panel);
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.45);
      }
      .menu.open {
        display: flex;
      }
      .menu .spacer {
        display: none;
      }
      .menu nav a,
      .menu a.btn,
      .menu .link {
        display: block;
        padding: 0.6rem 0.8rem;
        text-align: center;
      }
      .menu app-lang-switch {
        align-self: flex-start;
      }
    }
  `,
})
export class Topbar {
  protected readonly auth = inject(AuthService);
  protected readonly open = signal(false);
  constructor() {
    void this.auth.ensureLoaded();
  }
}
