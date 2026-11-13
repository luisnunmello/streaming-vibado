import { Component, HostListener, input, output } from '@angular/core';

/** A centered dialog over a dimmed page. Closes on Escape or a click outside; content goes inside the tags. */
@Component({
  selector: 'app-modal',
  template: `
    @if (open()) {
      <div class="backdrop" (mousedown)="onBackdrop($event)">
        <div class="panel" [class.wide]="wide()" role="dialog" aria-modal="true" [attr.aria-label]="title()">
          <h2>{{ title() }}</h2>
          <ng-content />
        </div>
      </div>
    }
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: grid;
      place-items: center;
      padding: 1rem;
      background: rgba(5, 8, 14, 0.7);
      overflow-y: auto;
    }
    .panel {
      width: min(560px, 100%);
      max-height: calc(100vh - 2rem);
      overflow-y: auto;
      padding: 1.2rem 1.3rem;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: var(--panel);
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
    }
    .panel.wide {
      width: min(780px, 100%);
    }
    h2 {
      margin: 0 0 0.8rem;
      font-size: 1.1rem;
    }
  `,
})
export class Modal {
  readonly open = input.required<boolean>();
  readonly title = input('');
  readonly wide = input(false);
  readonly closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.closed.emit();
  }

  protected onBackdrop(ev: MouseEvent): void {
    if (ev.target === ev.currentTarget) this.closed.emit();
  }
}
