import { Component, HostListener, inject, signal } from '@angular/core';
import { I18nService } from '../core/i18n.service';

interface Item {
  id: number;
  text: string;
  leaving: boolean;
}

/** Corner messages ("Copied!", "Saved."). Fed by toast() in core/toast.ts. */
@Component({
  selector: 'app-toast-host',
  template: `
    <div class="toast-stack" aria-live="polite">
      @for (t of items(); track t.id) {
        <div class="toast-item" [class.leaving]="t.leaving">{{ t.text }}</div>
      }
    </div>
  `,
  styles: `
    .toast-stack {
      position: fixed;
      right: max(1rem, env(safe-area-inset-right));
      bottom: max(1rem, env(safe-area-inset-bottom));
      z-index: 2000;
      display: grid;
      gap: 0.5rem;
      justify-items: end;
      pointer-events: none;
    }
    .toast-item {
      padding: 0.6rem 0.95rem;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
      font-size: 0.9rem;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
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
