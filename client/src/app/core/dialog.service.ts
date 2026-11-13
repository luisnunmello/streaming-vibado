import { Injectable, signal } from '@angular/core';

export interface AskOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action. */
  danger?: boolean;
  /** An optional tick box shown under the message. */
  checkbox?: { label: string; checked?: boolean };
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
  readonly current = signal<OpenDialog | null>(null);

  ask(opts: AskOptions): Promise<AskResult> {
    // a dialog that is still open is answered "no" before the next one appears
    this.current()?.resolve({ ok: false, checked: false });
    return new Promise((resolve) => {
      this.current.set({ ...opts, checked: opts.checkbox?.checked ?? false, resolve });
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
