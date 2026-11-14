import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { BugReportView } from '../../core/bug';
import { DialogService } from '../../core/dialog.service';
import { TPipe } from '../../core/i18n.service';
import { APP_VERSION } from '../../core/version';

type Filter = 'open' | 'solved' | 'all';

/** Admin: bug reports sent from the header button. */
@Component({
  selector: 'app-bugs',
  imports: [FormsModule, TPipe],
  template: `
    <div class="head row">
      <h1 class="page-title">{{ 'Bug reports' | t }}</h1>
      <span class="spacer"></span>
      <span class="muted">{{ 'Current version' | t }}: v{{ version }}</span>
    </div>

    <div class="filters">
      @for (f of filters; track f.key) {
        <button type="button" class="btn small" [class.primary]="filter() === f.key" (click)="filter.set(f.key)">{{ f.label | t }} ({{ counts()[f.key] }})</button>
      }
    </div>

    @if (error()) {
      <p class="error">{{ error() | t }}</p>
    }

    @if (!loaded()) {
      <div class="card" aria-busy="true"><div class="skeleton row"></div><div class="skeleton row short"></div></div>
    }

    @for (b of shown(); track b.id) {
      <div class="card bug" [class.solved]="b.status === 'solved'">
        <div class="row top">
          <b class="ttl">#{{ b.id }} · {{ b.title }}</b>
          <span class="badge" [class.good]="b.status === 'solved'" [class.warn]="b.status === 'open'">{{ (b.status === 'solved' ? 'Solved' : 'Open') | t }}</span>
          <span class="spacer"></span>
          <button type="button" class="btn small" (click)="toggle(b)">{{ (editing()?.id === b.id ? 'Close' : 'Open details') | t }}</button>
        </div>
        <p class="meta muted">
          {{ b.reporter }} · {{ date(b.createdAt) }}
          @if (b.version) { · {{ 'seen in' | t }} v{{ b.version }} }
          @if (b.status === 'solved' && b.fixedIn) { · {{ 'fixed in' | t }} v{{ b.fixedIn }} }
          @if (b.page) { · {{ b.page }} }
        </p>
        <p class="desc">{{ b.description }}</p>

        @if (editing(); as e) {
          @if (e.id === b.id) {
            <div class="edit">
              <div class="field">
                <label [for]="'t' + b.id">{{ 'Title' | t }}</label>
                <input [id]="'t' + b.id" type="text" maxlength="100" [(ngModel)]="e.title" />
              </div>
              <div class="field">
                <label [for]="'d' + b.id">{{ 'Description' | t }}</label>
                <textarea [id]="'d' + b.id" rows="4" maxlength="2000" [(ngModel)]="e.description"></textarea>
              </div>
              <div class="row">
                <div class="field">
                  <label [for]="'v' + b.id">{{ 'Seen in version' | t }}</label>
                  <input [id]="'v' + b.id" type="text" maxlength="14" placeholder="1.0.0" [(ngModel)]="e.version" />
                </div>
                <div class="field">
                  <label [for]="'f' + b.id">{{ 'Fixed in version' | t }}</label>
                  <input [id]="'f' + b.id" type="text" maxlength="14" placeholder="1.0.1" [(ngModel)]="e.fixedIn" />
                </div>
              </div>
              <div class="field">
                <label [for]="'n' + b.id">{{ 'Admin note' | t }}</label>
                <textarea [id]="'n' + b.id" rows="2" maxlength="1000" [(ngModel)]="e.adminNote"></textarea>
              </div>
              @if (b.hasShot) {
                <div class="shot">
                  @if (shotUrl(); as u) {
                    <a [href]="u" target="_blank" rel="noopener"><img [src]="u" alt="" /></a>
                  } @else {
                    <span class="muted">{{ 'Loading screenshot…' | t }}</span>
                  }
                  <button type="button" class="btn small danger" (click)="dropShot(b)">{{ 'Delete screenshot' | t }}</button>
                </div>
              }
              @if (b.userAgent) {
                <p class="muted ua">{{ b.userAgent }}</p>
              }
              <div class="row actions">
                <button type="button" class="btn primary small" [disabled]="busy()" (click)="save(b)">{{ 'Save changes' | t }}</button>
                @if (b.status === 'open') {
                  <button type="button" class="btn small" [disabled]="busy()" (click)="solve(b)">{{ 'Mark solved' | t }}</button>
                } @else {
                  <button type="button" class="btn small" [disabled]="busy()" (click)="reopen(b)">{{ 'Reopen' | t }}</button>
                }
                <span class="spacer"></span>
                <button type="button" class="btn small danger" [disabled]="busy()" (click)="remove(b)">{{ 'Delete' | t }}</button>
              </div>
            </div>
          }
        }
      </div>
    } @empty {
      @if (loaded()) {
        <p class="muted">{{ 'No bug reports here.' | t }}</p>
      }
    }
  `,
  styles: `
    .filters {
      display: flex;
      gap: 0.5rem;
      margin: 0.8rem 0;
    }
    .bug {
      margin-bottom: 0.8rem;
    }
    .bug.solved {
      opacity: 0.8;
    }
    .top {
      gap: 0.6rem;
      align-items: center;
    }
    .ttl {
      overflow-wrap: anywhere;
    }
    .meta {
      margin: 0.3rem 0;
      font-size: 0.85rem;
    }
    .desc {
      margin: 0.4rem 0 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .edit {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--line);
    }
    textarea,
    input[type='text'] {
      width: 100%;
    }
    .shot {
      display: flex;
      align-items: flex-end;
      gap: 0.8rem;
      margin: 0.6rem 0;
    }
    .shot img {
      max-width: min(420px, 100%);
      max-height: 280px;
      border-radius: 6px;
      border: 1px solid var(--line);
    }
    .ua {
      font-size: 0.75rem;
      overflow-wrap: anywhere;
    }
    .actions {
      margin-top: 0.8rem;
      gap: 0.5rem;
    }
  `,
})
export class Bugs implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);

  protected readonly version = APP_VERSION;
  protected readonly filters: { key: Filter; label: string }[] = [
    { key: 'open', label: 'Open' },
    { key: 'solved', label: 'Solved' },
    { key: 'all', label: 'All' },
  ];
  protected readonly filter = signal<Filter>('open');
  protected readonly bugs = signal<BugReportView[]>([]);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal<BugReportView | null>(null);
  protected readonly shotUrl = signal<string | null>(null);

  protected readonly shown = computed(() => this.bugs().filter((b) => this.filter() === 'all' || b.status === this.filter()));
  protected readonly counts = computed(() => ({
    open: this.bugs().filter((b) => b.status === 'open').length,
    solved: this.bugs().filter((b) => b.status === 'solved').length,
    all: this.bugs().length,
  }));

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.clearShot();
  }

  protected date(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  private async load(): Promise<void> {
    try {
      this.bugs.set((await this.api.get<{ bugs: BugReportView[] }>('/api/admin/bugs')).bugs);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not load');
    }
    this.loaded.set(true);
  }

  private clearShot(): void {
    const u = this.shotUrl();
    if (u) URL.revokeObjectURL(u);
    this.shotUrl.set(null);
  }

  protected toggle(b: BugReportView): void {
    this.clearShot();
    if (this.editing()?.id === b.id) {
      this.editing.set(null);
      return;
    }
    this.editing.set({ ...b });
    if (b.hasShot) void this.loadShot(b.id);
  }

  /** The screenshot needs the login header, so it is fetched and shown from a blob. */
  private async loadShot(id: number): Promise<void> {
    try {
      const res = await fetch(`/api/admin/bugs/${id}/screenshot`, { headers: { authorization: `Bearer ${this.api.token()}` } });
      if (!res.ok || this.editing()?.id !== id) return;
      this.shotUrl.set(URL.createObjectURL(await res.blob()));
    } catch {
      /* no preview */
    }
  }

  /** Applies a server answer to the list and keeps the edit form in step. */
  private applied(bug: BugReportView): void {
    this.bugs.update((l) => l.map((x) => (x.id === bug.id ? bug : x)));
    this.editing.set({ ...bug });
    void this.auth.refresh(); // the open-reports badge
  }

  private async patch(b: BugReportView, body: Record<string, unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.applied((await this.api.patch<{ bug: BugReportView }>(`/api/admin/bugs/${b.id}`, body)).bug);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not save');
    } finally {
      this.busy.set(false);
    }
  }

  private fields(): Record<string, unknown> {
    const e = this.editing()!;
    return { title: e.title, description: e.description, adminNote: e.adminNote, version: e.version, fixedIn: e.fixedIn };
  }

  protected save(b: BugReportView): Promise<void> {
    return this.patch(b, this.fields());
  }

  /** Solving fills in the current version as "fixed in" when it was left empty. */
  protected solve(b: BugReportView): Promise<void> {
    const e = this.editing()!;
    return this.patch(b, { ...this.fields(), fixedIn: e.fixedIn.trim() || APP_VERSION, status: 'solved' });
  }

  protected reopen(b: BugReportView): Promise<void> {
    return this.patch(b, { ...this.fields(), status: 'open', fixedIn: '' });
  }

  protected async dropShot(b: BugReportView): Promise<void> {
    if (!(await this.dialog.confirm('Delete this screenshot?', { danger: true }))) return;
    try {
      this.clearShot();
      this.applied((await this.api.delete<{ bug: BugReportView }>(`/api/admin/bugs/${b.id}/screenshot`)).bug);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not delete');
    }
  }

  protected async remove(b: BugReportView): Promise<void> {
    if (!(await this.dialog.confirm('Delete this bug report for good?', { danger: true }))) return;
    try {
      await this.api.delete(`/api/admin/bugs/${b.id}`);
      this.clearShot();
      this.editing.set(null);
      this.bugs.update((l) => l.filter((x) => x.id !== b.id));
      void this.auth.refresh();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not delete');
    }
  }
}
