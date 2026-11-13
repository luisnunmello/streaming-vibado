import { Component, model } from '@angular/core';
import { LIMIT_FIELDS, type Limits } from '../core/models';

/** Form fields for every per-account limit. */
@Component({
  selector: 'app-limits-editor',
  template: `
    <div class="cols">
      @for (f of fields; track f.key) {
        @if (f.type === 'number') {
          <div class="field">
            <label [for]="'lim-' + f.key">{{ f.label }}@if (f.hint) { <small>{{ f.hint }}</small> }</label>
            <input [id]="'lim-' + f.key" type="number" min="0" [step]="f.step ?? 1"
                   [value]="$any(limits())[f.key]" (input)="set(f.key, +$any($event.target).value)" />
          </div>
        } @else {
          <label class="check">
            <input type="checkbox" [checked]="$any(limits())[f.key]" (change)="set(f.key, $any($event.target).checked)" />
            {{ f.label }}
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
  readonly limits = model.required<Limits>();
  protected readonly fields = LIMIT_FIELDS;

  protected set(key: keyof Limits, value: number | boolean): void {
    this.limits.update((l) => ({ ...l, [key]: value }));
  }
}
