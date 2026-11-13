import { Component, model } from '@angular/core';
import { TPipe } from '../core/i18n.service';
import { LIMIT_FIELDS, type Limits } from '../core/models';

/** Form fields for every per-account limit. */
@Component({
  imports: [TPipe],
  selector: 'app-limits-editor',
  template: `
    <div class="cols">
      @for (f of fields; track f.key) {
        @if (f.type === 'number') {
          <div class="field">
            <label [for]="uid + f.key">{{ f.label | t }}@if (f.hint) { <small>{{ f.hint | t }}</small> }</label>
            <input [id]="uid + f.key" type="number" min="0" [step]="f.step ?? 1"
                   [value]="$any(limits())[f.key]" (input)="set(f.key, +$any($event.target).value)" />
          </div>
        } @else {
          <label class="check">
            <input type="checkbox" [checked]="$any(limits())[f.key]" (change)="set(f.key, $any($event.target).checked)" />
            {{ f.label | t }}
          </label>
        }
      }
    </div>
  `,
  styles: `
    small {
      font-weight: 400;
      opacity: 0.8;
    }
  `,
})
export class LimitsEditor {
  private static counter = 0;
  /** Unique per editor, so several can be on one page without clashing ids. */
  protected readonly uid = `lim${++LimitsEditor.counter}-`;
  readonly limits = model.required<Limits>();
  protected readonly fields = LIMIT_FIELDS;

  protected set(key: keyof Limits, value: number | boolean): void {
    this.limits.update((l) => ({ ...l, [key]: value }));
  }
}
