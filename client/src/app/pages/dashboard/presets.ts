import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { describeLimits, type Limits, type Preset } from '../../core/models';
import { LimitsEditor } from '../../shared/limits-editor';

@Component({
  selector: 'app-presets',
  imports: [FormsModule, LimitsEditor],
  template: `
    <h1 class="page-title">Limit presets</h1>
    <p class="intro muted">
      A preset is a named set of limits. Give a preset to users and they follow it: when you change the preset, every user on it
      gets the new limits immediately, including in their open studio.
    </p>

    <div class="card create">
      <h2>New preset</h2>
      <form (ngSubmit)="create()">
        <div class="row">
          <div class="field grow">
            <label for="pname">Name</label>
            <input id="pname" type="text" name="pname" [(ngModel)]="newName" maxlength="40" placeholder="e.g. Friends, Trusted, Small" required />
          </div>
          <label class="check"><input type="checkbox" name="pdef" [(ngModel)]="newDefault" /> Use for new users</label>
        </div>
        @if (newLimits(); as l) {
          <app-limits-editor [limits]="l" (limitsChange)="newLimits.set($event)" />
        }
        <div class="row actions">
          <button class="btn primary" type="submit" [disabled]="busy() || !newName.trim()">Create preset</button>
        </div>
      </form>
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="list">
          <thead><tr><th>Preset</th><th>Limits</th><th>Users</th><th></th></tr></thead>
          <tbody>
            @for (p of presets(); track p.id) {
              <tr>
                <td>
                  <b>{{ p.name }}</b>
                  @if (p.isDefault) {
                    <span class="badge good" title="New users and invited users start on this preset">default</span>
                  }
                </td>
                <td class="muted summary">{{ describe(p.limits) }}</td>
                <td>{{ p.userCount }}</td>
                <td class="right">
                  <button type="button" class="btn small" (click)="toggleEdit(p)">{{ editing()?.id === p.id ? 'Close' : 'Edit' }}</button>
                </td>
              </tr>
              @if (editing(); as e) {
                @if (e.id === p.id) {
                  <tr class="edit">
                    <td colspan="4">
                      <div class="field narrow">
                        <label [for]="'n' + p.id">Name</label>
                        <input [id]="'n' + p.id" type="text" maxlength="40" [value]="editName()" (input)="editName.set($any($event.target).value)" />
                      </div>
                      @if (editLimits(); as l) {
                        <app-limits-editor [limits]="l" (limitsChange)="editLimits.set($event)" />
                      }
                      <p class="muted hint">
                        @if (p.userCount > 0) {
                          Saving updates {{ p.userCount }} user{{ p.userCount === 1 ? '' : 's' }} right away.
                        } @else {
                          No user is on this preset yet.
                        }
                      </p>
                      <div class="row actions">
                        <button type="button" class="btn primary small" (click)="save(p)">Save changes</button>
                        <span class="spacer"></span>
                        @if (!p.isDefault) {
                          <button type="button" class="btn small" (click)="makeDefault(p)">Use for new users</button>
                          <button type="button" class="btn small danger" (click)="remove(p)">Delete</button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              }
            } @empty {
              <tr><td colspan="4" class="muted">No presets.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: `
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
  protected readonly presets = signal<Preset[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly editing = signal<Preset | null>(null);
  protected readonly editName = signal('');
  protected readonly editLimits = signal<Limits | null>(null);
  protected readonly newLimits = signal<Limits | null>(null);
  protected newName = '';
  protected newDefault = false;
  protected readonly describe = describeLimits;

  async ngOnInit(): Promise<void> {
    await this.load();
    const def = this.presets().find((p) => p.isDefault);
    if (def) this.newLimits.set({ ...def.limits });
  }

  private async load(): Promise<void> {
    try {
      this.presets.set((await this.api.get<{ presets: Preset[] }>('/api/admin/presets')).presets);
    } catch (e: any) {
      this.error.set(e.message);
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

  protected async create(): Promise<void> {
    this.busy.set(true);
    await this.act(async () => {
      await this.api.post('/api/admin/presets', { name: this.newName.trim(), limits: this.newLimits(), isDefault: this.newDefault });
      this.newName = '';
      this.newDefault = false;
    });
    this.busy.set(false);
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

  protected remove(p: Preset): Promise<void> {
    const msg =
      p.userCount > 0
        ? `Delete "${p.name}"? Its ${p.userCount} user(s) keep their current limits as custom limits.`
        : `Delete "${p.name}"?`;
    if (!confirm(msg)) return Promise.resolve();
    return this.act(async () => {
      await this.api.delete(`/api/admin/presets/${p.id}`);
      this.editing.set(null);
    });
  }
}
