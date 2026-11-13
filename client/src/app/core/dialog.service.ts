import { Injectable, inject, signal } from '@angular/core';
import { I18nService } from './i18n.service';

export interface AskOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action. */
  danger?: boolean;
  /** An optional tick box shown under the message. */
  checkbox?: { label: string; checked?: boolean };
  /** Values for {placeholders} in the title, message and tick box text. */
  params?: Record<string, string | number>;
}

export interface AskResult {
  ok: boolean;
  checked: boolean;
}

export interface OpenDialog extends AskOptions {
  checked: boolean;
  resolve: (r: AskResult) => void;
}

/** In-page replacement for confirm(): `await dialog.confirm('…')`. The dialog itself is drawn by DialogHost. */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly i18n = inject(I18nService);
  readonly current = signal<OpenDialog | null>(null);

  ask(opts: AskOptions): Promise<AskResult> {
    // a dialog that is still open is answered "no" before the next one appears
    this.current()?.resolve({ ok: false, checked: false });
    return new Promise((resolve) => {
      const t = (text: string | undefined) => (text === undefined ? undefined : this.i18n.t(text, opts.params));
      this.current.set({
        ...opts,
        title: t(opts.title),
        message: t(opts.message)!,
        confirmLabel: t(opts.confirmLabel),
        cancelLabel: t(opts.cancelLabel),
        checkbox: opts.checkbox ? { ...opts.checkbox, label: t(opts.checkbox.label)! } : undefined,
        checked: opts.checkbox?.checked ?? false,
        resolve,
      });
    });
  }

  async confirm(message: string, opts: Omit<AskOptions, 'message'> = {}): Promise<boolean> {
    return (await this.ask({ ...opts, message })).ok;
  }

  setChecked(checked: boolean): void {
    const d = this.current();
    if (d) this.current.set({ ...d, checked });
  }

  answer(ok: boolean): void {
    const d = this.current();
    if (!d) return;
    this.current.set(null);
    d.resolve({ ok, checked: ok && d.checked });
  }
}
