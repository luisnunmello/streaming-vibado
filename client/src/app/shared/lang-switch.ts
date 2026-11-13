import { Component, inject } from '@angular/core';
import { I18nService, type Lang } from '../core/i18n.service';

/** English / Português toggle. */
@Component({
  selector: 'app-lang-switch',
  template: `
    <span class="sw" role="group" aria-label="Language">
      @for (l of langs; track l.code) {
        <button type="button" [class.on]="i18n.lang() === l.code" [attr.aria-pressed]="i18n.lang() === l.code" (click)="i18n.set(l.code)">{{ l.label }}</button>
      }
    </span>
  `,
  styles: `
    .sw {
      display: inline-flex;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    button {
      padding: 0.25rem 0.55rem;
      border: 0;
      background: transparent;
      color: var(--muted);
      font: inherit;
      font-size: 0.8rem;
      cursor: pointer;
      &.on {
        background: var(--panel-2);
        color: var(--text);
      }
    }
  `,
})
export class LangSwitch {
  protected readonly i18n = inject(I18nService);
  protected readonly langs: { code: Lang; label: string }[] = [
    { code: 'en', label: 'EN' },
    { code: 'pt', label: 'PT' },
  ];
}
