import { Component, HostListener, inject, signal } from '@angular/core';
import { I18nService } from '../core/i18n.service';

interface Item {
  id: number;
  text: string;
  leaving: boolean;
}

/** Messages at the top middle of the screen ("Copied!", "Saved."). Fed by toast() in core/toast.ts. */
@Component({
  selector: 'app-toast-host',
  template: `
    <div class="toast-stack" aria-live="polite">
      @for (t of items(); track t.id) {
        <div class="toast-item" [class.leaving]="t.leaving" role="status">
          <span class="msg">{{ t.text }}</span>
          <span class="timer" aria-hidden="true"><i></i></span>
        </div>
      }
    </div>
  `,
  styles: `
    .toast-stack {
      position: fixed;
      top: max(1rem, env(safe-area-inset-top));
      left: 50%;
      transform: translateX(-50%);
      width: min(440px, calc(100vw - 2rem));
      z-index: 2000;
      display: grid;
      gap: 0.6rem;
      pointer-events: none;
    }
    .toast-item {
      position: relative;
      overflow: hidden;
      padding: 0.95rem 1.2rem 1.2rem;
      border-radius: 14px;
      border: 1px solid var(--accent);
      background: var(--panel-2);
      color: var(--text);
      font-size: 1.05rem;
      font-weight: 600;
      text-align: center;
      box-shadow: 0 0 0 3px rgba(124, 156, 255, 0.25), 0 14px 40px rgba(0, 0, 0, 0.6);
      animation: toast-in 0.28s cubic-bezier(0.2, 1.2, 0.4, 1);
      transition: opacity 0.25s, transform 0.25s;
    }
    .toast-item.leaving {
      opacity: 0;
      transform: translateY(-10px);
    }
    /* Drains from full to empty over the time the message stays. */
    .timer {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 5px;
      background: rgba(255, 255, 255, 0.12);
    }
    .timer i {
      display: block;
      height: 100%;
      background: var(--accent);
      transform-origin: left;
      animation: toast-drain 2.2s linear forwards;
    }
    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateY(-18px) scale(0.92);
      }
    }
    @keyframes toast-drain {
      to {
        transform: scaleX(0);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .toast-item {
        animation: none;
      }
    }
  `,
})
export class ToastHost {
  private readonly i18n = inject(I18nService);
  protected readonly items = signal<Item[]>([]);
  private next = 1;

  @HostListener('window:app-toast', ['$event'])
  protected show(ev: Event): void {
    const text = (ev as CustomEvent<{ text: string }>).detail?.text;
    if (!text) return;
    const id = this.next++;
    this.items.update((l) => [...l.slice(-3), { id, text: this.i18n.t(text), leaving: false }]);
    setTimeout(() => this.items.update((l) => l.map((t) => (t.id === id ? { ...t, leaving: true } : t))), 2200);
    setTimeout(() => this.items.update((l) => l.filter((t) => t.id !== id)), 2450);
  }
}
