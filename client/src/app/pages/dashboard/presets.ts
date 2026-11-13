import { Component, OnInit, inject, signal } from '@angular/core';
import { I18nService, TPipe } from '../../core/i18n.service';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { DialogService } from '../../core/dialog.service';
import { describeLimits, type Limits, type Preset } from '../../core/models';
import { LimitsEditor } from '../../shared/limits-editor';
import { Modal } from '../../shared/modal';

@Component({
  selector: 'app-presets',
  imports: [FormsModule, LimitsEditor, Modal, TPipe],
  template: `
    <div class="head row">
      <h1 class="page-title">{{ 'Limit presets' | t }}</h1>
      <span class="spacer"></span>
      <button type="button" class="btn primary" (click)="openCreate()">{{ 'New preset' | t }}</button>
    </div>
    <p class="intro muted">
      {{ 'A preset is a named set of limits. Give a preset to users and they follow it: when you change the preset, every user on it gets the new limits immediately, including in their open studio.' | t }}
    </p>

    <app-modal [open]="createOpen()" [wide]="true" [title]="(cloneOf() ? 'Clone preset' : 'New preset') | t" (closed)="createOpen.set(false)">
      <form (ngSubmit)="create()">
        <div class="row">
          <div class="field grow">
            <label for="pname">{{ 'Name' | t }}</label>
            <input id="pname" type="text" name="pname" [(ngModel)]="newName" maxlength="40" [placeholder]="'e.g. Friends, Trusted, Small' | t" required />
          </div>
          <label class="check"><input type="checkbox" name="pdef" [(ngModel)]="newDefault" /> {{ 'Use for new users' | t }}</label>
        </div>
        @if (cloneOf(); as c) {
          <p class="muted hint">{{ 'Starts as a copy of' | t }} <b>{{ c.name }}</b>{{ '. Change anything you like.' | t }}</p>
        }
        @if (newLimits(); as l) {
          <app-limits-editor [limits]="l" (limitsChange)="newLimits.set($event)" />
        }
        @if (error()) {
          <p class="error">{{ error() | t }}</p>
        }
        <div class="modal-actions">
          <button class="btn" type="button" (click)="createOpen.set(false)">{{ 'Cancel' | t }}</button>
          <button class="btn primary" type="submit" [class.busy]="busy()" [disabled]="busy() || !newName.trim()">{{ 'Create preset' | t }}</button>
        </div>
      </form>
    </app-modal>

    @if (error() && !createOpen()) {
      <p class="error">{{ error() | t }}</p>
    }

    @if (!loaded()) {
      <div class="card" aria-busy="true">
        <div class="skeleton row"></div>
        <div class="skeleton row"></div>
        <div class="skeleton row short"></div>
      </div>
    }
    <div class="card" [class.is-loading]="!loaded()">
      <div class="table-wrap">
        <table class="list stack">
          <thead><tr><th>{{ 'Preset' | t }}</th><th>{{ 'Limits' | t }}</th><th>{{ 'Users' | t }}</th><th></th></tr></thead>
          <tbody>
            @for (p of presets(); track p.id) {
              <tr>
                <td>
                  <b>{{ p.name }}</b>
                  @if (p.isDefault) {
                    <span class="badge good" [title]="'New users and invited users start on this preset' | t">{{ 'default' | t }}</span>
                  }
                </td>
                <td [attr.data-label]="'Limits' | t" class="muted summary">{{ describe(p.limits) }}</td>
                <td [attr.data-label]="'Users' | t">{{ p.userCount }}</td>
                <td class="right">
                  <div class="cell-actions">
                    <button type="button" class="btn small" (click)="openCreate(p)">{{ 'Clone' | t }}</button>
                    <button type="button" class="btn small" (click)="toggleEdit(p)">{{ (editing()?.id === p.id ? 'Close' : 'Edit') | t }}</button>
                  </div>
                </td>
              </tr>
              @if (editing(); as e) {
                @if (e.id === p.id) {
                  <tr class="edit">
                    <td colspan="4">
                      <div class="field narrow">
                        <label [for]="'n' + p.id">{{ 'Name' | t }}</label>
                        <input [id]="'n' + p.id" type="text" maxlength="40" [value]="editName()" (input)="editName.set($any($event.target).value)" />
                      </div>
                      @if (editLimits(); as l) {
                        <app-limits-editor [limits]="l" (limitsChange)="editLimits.set($event)" />
                      }
                      <p class="muted hint">
                        @if (p.userCount > 0) {
                          {{ (p.userCount === 1 ? 'Saving updates {n} user right away.' : 'Saving updates {n} users right away.') | t: { n: p.userCount } }}
                        } @else {
                          {{ 'No user is on this preset yet.' | t }}
                        }
                      </p>
                      <div class="row actions">
                        <button type="button" class="btn primary small" (click)="save(p)">{{ 'Save changes' | t }}</button>
                        <span class="spacer"></span>
                        @if (!p.isDefault) {
                          <button type="button" class="btn small" (click)="makeDefault(p)">{{ 'Use for new users' | t }}</button>
                          <button type="button" class="btn small danger" (click)="remove(p)">{{ 'Delete' | t }}</button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              }
            } @empty {
              <tr><td colspan="4" class="muted">{{ 'No presets.' | t }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: `
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .intro {
      margin: -0.4rem 0 1rem;
      max-width: 70ch;
    }
    .create {
      margin-bottom: 1rem;
    }
    .grow {
      flex: 1;
      min-width: 220px;
    }
    .narrow {
      max-width: 320px;
    }
    .actions {
      margin-top: 0.8rem;
    }
    .summary {
      font-size: 0.85rem;
    }
    .right {
      text-align: right;
    }
    .edit td {
      background: var(--bg);
    }
    .hint {
      font-size: 0.85rem;
      margin: 0.8rem 0 0;
    }
    .badge {
      margin-left: 0.4rem;
    }
  `,
})
export class Presets implements OnInit {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(DialogService);
  protected readonly i18n = inject(I18nService);
  protected readonly presets = signal<Preset[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly editing = signal<Preset | null>(null);
  protected readonly createOpen = signal(false);
  protected readonly cloneOf = signal<Preset | null>(null);
  protected readonly editName = signal('');
  protected readonly editLimits = signal<Limits | null>(null);
  protected readonly newLimits = signal<Limits | null>(null);
  protected newName = '';
  protected newDefault = false;
  protected readonly describe = (l: Limits): string => describeLimits(l, (text, params) => this.i18n.t(text, params));

  async ngOnInit(): Promise<void> {
    await this.load();
    const def = this.presets().find((p) => p.isDefault);
    if (def) this.newLimits.set({ ...def.limits });
  }

  protected readonly loaded = signal(false);

  private async load(): Promise<void> {
    try {
      this.presets.set((await this.api.get<{ presets: Preset[] }>('/api/admin/presets')).presets);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.loaded.set(true);
    }
  }

  private async act(fn: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    try {
      await fn();
      await this.load();
    } catch (e: any) {
      this.error.set(e.message);
    }
  }

  /** Opens the "new preset" dialog, empty (starting from the default preset) or as a copy of `from`. */
  protected openCreate(from?: Preset): void {
    const base = from ?? this.presets().find((p) => p.isDefault);
    this.cloneOf.set(from ?? null);
    this.newName = from ? this.i18n.t('{name} copy', { name: from.name }).slice(0, 40) : '';
    this.newDefault = false;
    if (base) this.newLimits.set({ ...base.limits });
    this.error.set(null);
    this.createOpen.set(true);
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.post('/api/admin/presets', { name: this.newName.trim(), limits: this.newLimits(), isDefault: this.newDefault });
      this.createOpen.set(false);
      await this.load();
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }

  protected toggleEdit(p: Preset): void {
    if (this.editing()?.id === p.id) {
      this.editing.set(null);
      return;
    }
    this.editing.set(p);
    this.editName.set(p.name);
    this.editLimits.set({ ...p.limits });
  }

  protected save(p: Preset): Promise<void> {
    return this.act(async () => {
      await this.api.patch(`/api/admin/presets/${p.id}`, { name: this.editName().trim(), limits: this.editLimits() });
      this.editing.set(null);
    });
  }

  protected makeDefault(p: Preset): Promise<void> {
    return this.act(() => this.api.patch(`/api/admin/presets/${p.id}`, { isDefault: true }));
  }

  protected async remove(p: Preset): Promise<void> {
    const msg = p.userCount > 0 ? 'Delete "{name}"? Its {n} user(s) keep their current limits as custom limits.' : 'Delete "{name}"?';
    if (!(await this.dialog.confirm(msg, { title: 'Delete preset', confirmLabel: 'Delete', danger: true, params: { name: p.name, n: p.userCount } }))) return;
    return this.act(async () => {
      await this.api.delete(`/api/admin/presets/${p.id}`);
      this.editing.set(null);
    });
  }
}
