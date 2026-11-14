import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { TPipe } from '../core/i18n.service';
import { toast } from '../core/toast';
import { APP_VERSION } from '../core/version';
import { Modal } from './modal';

/** The screenshot is shrunk to this before it is sent, to keep storage and traffic cheap. */
const MAX_SIDE = 1280;
const MAX_BYTES = 300 * 1024;
/** Largest file we are willing to even try to shrink. */
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

const bytesOf = (dataUrl: string): number => ((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4;

/** Header button that opens the "report a bug" dialog. */
@Component({
  selector: 'app-bug-report',
  imports: [FormsModule, Modal, TPipe],
  template: `
    <button type="button" class="bugbtn" [title]="'Report a bug' | t" [attr.aria-label]="'Report a bug' | t" (click)="$event.stopPropagation(); show()">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M20 8h-2.81a5.99 5.99 0 0 0-1.82-1.96L17 4.41 15.59 3l-2.17 2.17a6 6 0 0 0-2.83 0L8.41 3 7 4.41l1.63 1.63A5.99 5.99 0 0 0 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81A6 6 0 0 0 12 21a6 6 0 0 0 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"/></svg>
      <span class="lbl">{{ 'Report a bug' | t }}</span>
    </button>

    <app-modal [open]="open()" [title]="'Report a bug' | t" (closed)="close()">
      <form (ngSubmit)="send()" (click)="$event.stopPropagation()">
        <div class="field">
          <label for="bugtitle">{{ 'Title' | t }}</label>
          <input id="bugtitle" name="bugtitle" type="text" maxlength="100" [(ngModel)]="title" [placeholder]="'What went wrong, in a few words' | t" required />
        </div>
        <div class="field">
          <label for="bugdesc">{{ 'Description' | t }}</label>
          <textarea id="bugdesc" name="bugdesc" rows="5" maxlength="2000" [(ngModel)]="description" [placeholder]="'What did you do, what did you expect, what happened instead?' | t" required></textarea>
        </div>
        <div class="field">
          <label for="bugshot">{{ 'Screenshot (optional)' | t }}</label>
          @if (shot(); as s) {
            <div class="preview">
              <img [src]="s.url" alt="" />
              <span class="muted">{{ s.kb }} KB</span>
              <button type="button" class="btn small" (click)="shot.set(null)">{{ 'Remove' | t }}</button>
            </div>
          } @else {
            <input id="bugshot" type="file" accept="image/png,image/jpeg,image/webp" (change)="pick($event)" />
            <p class="muted hint">{{ 'One image. It is shrunk before sending.' | t }}</p>
          }
        </div>
        @if (error()) {
          <p class="error">{{ error() | t }}</p>
        }
        <div class="modal-actions">
          <button class="btn" type="button" (click)="close()">{{ 'Cancel' | t }}</button>
          <button class="btn primary" type="submit" [class.busy]="busy()" [disabled]="busy() || title.trim().length < 3 || description.trim().length < 5">{{ 'Send report' | t }}</button>
        </div>
      </form>
    </app-modal>
  `,
  styles: `
    .bugbtn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.4rem 0.6rem;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      color: var(--muted);
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
      &:hover {
        color: var(--text);
      }
    }
    @media (max-width: 900px) and (min-width: 641px) {
      .lbl {
        display: none;
      }
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.6rem;
      margin-top: 1rem;
    }
    textarea,
    input[type='text'] {
      width: 100%;
    }
    .preview {
      display: flex;
      align-items: center;
      gap: 0.8rem;
    }
    .preview img {
      max-width: 160px;
      max-height: 100px;
      border-radius: 6px;
      border: 1px solid var(--line);
    }
  `,
})
export class BugReport {
  private readonly api = inject(ApiService);
  protected readonly open = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly shot = signal<{ url: string; kb: number } | null>(null);
  protected title = '';
  protected description = '';

  protected show(): void {
    this.error.set(null);
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected async pick(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > MAX_INPUT_BYTES) {
      this.error.set('Pick a PNG, JPEG or WebP image (up to 15 MB).');
      return;
    }
    try {
      const url = await shrink(file);
      this.shot.set({ url, kb: Math.round(bytesOf(url) / 1024) });
    } catch {
      this.error.set('That image could not be used. Try another one.');
    }
  }

  protected async send(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.post('/api/bugs', {
        title: this.title.trim(),
        description: this.description.trim(),
        screenshot: this.shot()?.url,
        page: location.pathname,
        version: APP_VERSION,
      });
      this.title = '';
      this.description = '';
      this.shot.set(null);
      this.open.set(false);
      toast('Thanks! Your bug report was sent.');
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not send the report');
    } finally {
      this.busy.set(false);
    }
  }
}

/** Scales an image down (longest side MAX_SIDE) and re-encodes it as JPEG, lowering quality until it fits MAX_BYTES. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff'; // JPEG has no transparency
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      for (const q of [0.8, 0.65, 0.5]) {
        const url = canvas.toDataURL('image/jpeg', q);
        if (bytesOf(url) <= MAX_BYTES) return url;
      }
      scale *= 0.75;
    }
    throw new Error('too big');
  } finally {
    bmp.close();
  }
}
