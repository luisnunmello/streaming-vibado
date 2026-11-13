import { Component, inject } from '@angular/core';
import { DialogService } from '../core/dialog.service';
import { Modal } from './modal';

/** Draws the dialog requested through DialogService. Lives once, in the root component. */
@Component({
  selector: 'app-dialog-host',
  imports: [Modal],
  template: `
    @if (dialog.current(); as d) {
      <app-modal [open]="true" [title]="d.title ?? 'Please confirm'" (closed)="dialog.answer(false)">
        <p class="msg">{{ d.message }}</p>
        @if (d.checkbox; as cb) {
          <label class="check">
            <input type="checkbox" [checked]="d.checked" (change)="dialog.setChecked($any($event.target).checked)" />
            {{ cb.label }}
          </label>
        }
        <div class="actions">
          <button type="button" class="btn" (click)="dialog.answer(false)">{{ d.cancelLabel ?? 'Cancel' }}</button>
          <button type="button" class="btn" [class.danger]="d.danger" [class.primary]="!d.danger" (click)="dialog.answer(true)">
            {{ d.confirmLabel ?? 'Continue' }}
          </button>
        </div>
      </app-modal>
    }
  `,
  styles: `
    .msg {
      margin: 0 0 1rem;
      white-space: pre-line;
    }
    .check {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      margin-bottom: 1rem;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }
  `,
})
export class DialogHost {
  protected readonly dialog = inject(DialogService);
}
