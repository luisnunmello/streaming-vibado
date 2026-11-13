import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import type { GlobalSettings, GuestView, Limits } from '../../core/models';
import { absoluteUrl, copyText, formatBytes, timeAgo } from '../../core/util';
import { LimitsEditor } from '../../shared/limits-editor';

interface Reveal {
  title: string;
  key: string;
  link: string;
}

@Component({
  selector: 'app-guests',
  imports: [FormsModule, LimitsEditor],
  template: `
    <h1 class="page-title">Guests</h1>

    <div class="card create">
      <h2>New guest</h2>
      <form (ngSubmit)="create()">
        <div class="row">
          <div class="field grow">
            <label for="gname">Name</label>
            <input id="gname" type="text" name="gname" [(ngModel)]="newName" maxlength="24" placeholder="e.g. maria" required />
          </div>
          <div class="field">
            <label for="gref">Referrals</label>
            <input id="gref" type="number" name="gref" min="0" max="1000" [(ngModel)]="newReferrals" />
          </div>
        </div>
        <details>
          <summary>Limits (start from the defaults in Bandwidth settings)</summary>
          @if (newLimits(); as l) {
            <app-limits-editor [limits]="l" (limitsChange)="newLimits.set($event)" />
          }
        </details>
        <div class="row actions">
          <button class="btn primary" type="submit" [disabled]="busy() || !newName.trim()">Create and generate key</button>
        </div>
      </form>
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
    </div>

    @if (reveal(); as r) {
      <div class="card reveal">
        <h2>{{ r.title }}</h2>
        <p class="muted">This key is shown only once and expires in 7 days. Send it to the person (the link opens the activation page with the key filled in).</p>
        <div class="keybox">
          <code>{{ r.key }}</code>
          <span class="spacer"></span>
          <button type="button" class="btn small" (click)="copy(r.key, 'key')">{{ copied() === 'key' ? 'Copied!' : 'Copy key' }}</button>
          <button type="button" class="btn small" (click)="copy(absolute(r.link), 'link')">{{ copied() === 'link' ? 'Copied!' : 'Copy link' }}</button>
          <button type="button" class="btn small" (click)="reveal.set(null)">Hide</button>
        </div>
      </div>
    }

    <div class="card">
      <div class="table-wrap">
        <table class="list">
          <thead>
            <tr>
              <th>Guest</th><th>Status</th><th>Invited by</th><th>Rooms</th><th>Referrals</th><th>This month</th><th>Last seen</th><th></th>
            </tr>
          </thead>
          <tbody>
            @for (g of guests(); track g.id) {
              <tr>
                <td><b>{{ g.name }}</b></td>
                <td>
                  <span class="badge" [class.good]="g.status === 'active'" [class.warn]="g.status === 'pending'" [class.bad]="g.status === 'disabled'">{{ g.status }}</span>
                </td>
                <td class="muted">{{ g.invitedByName ?? '–' }}</td>
                <td>{{ g.rooms }}@if (g.liveRooms) { <span class="badge live">{{ g.liveRooms }} live</span> }</td>
                <td>{{ g.referralsUsed }} / {{ g.referralQuota }}</td>
                <td>{{ fmt(g.monthBytes) }}</td>
                <td class="muted">{{ g.status === 'pending' ? 'not activated' : ago(g.lastSeen) }}</td>
                <td class="right">
                  <button type="button" class="btn small" (click)="toggleEdit(g)">{{ editing()?.id === g.id ? 'Close' : 'Edit' }}</button>
                </td>
              </tr>
              @if (editing(); as e) {
                @if (e.id === g.id) {
                  <tr class="edit">
                    <td colspan="8">
                      <div class="field narrow">
                        <label [for]="'q' + g.id">Referrals this guest may create</label>
                        <input [id]="'q' + g.id" type="number" min="0" max="1000" [value]="editQuota()" (input)="editQuota.set(+$any($event.target).value)" />
                      </div>
                      @if (editLimits(); as l) {
                        <app-limits-editor [limits]="l" (limitsChange)="editLimits.set($event)" />
                      }
                      <div class="row actions">
                        <button type="button" class="btn primary small" (click)="save(g)">Save changes</button>
                        <span class="spacer"></span>
                        <button type="button" class="btn small" (click)="reissue(g)">{{ g.status === 'pending' ? 'New activation key' : 'Reset password (new key)' }}</button>
                        @if (g.status === 'disabled') {
                          <button type="button" class="btn small" (click)="setStatus(g, 'active')">Enable</button>
                        } @else if (g.status === 'active') {
                          <button type="button" class="btn small" (click)="disable(g)">Disable</button>
                        }
                        <button type="button" class="btn small danger" (click)="remove(g)">Delete</button>
                      </div>
                    </td>
                  </tr>
                }
              }
            } @empty {
              <tr><td colspan="8" class="muted">No guests yet.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: `
    .create,
    .reveal {
      margin-bottom: 1rem;
    }
    .grow {
      flex: 1;
      min-width: 200px;
    }
    .narrow {
      max-width: 260px;
    }
    details {
      margin: 0.5rem 0 1rem;
      summary {
        cursor: pointer;
        color: var(--accent);
        font-size: 0.9rem;
        margin-bottom: 0.8rem;
      }
    }
    .actions {
      margin-top: 0.8rem;
    }
    .right {
      text-align: right;
    }
    .edit td {
      background: var(--bg);
    }
    p {
      margin: 0 0 0.8rem;
    }
  `,
})
export class Guests implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  protected readonly guests = signal<GuestView[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly reveal = signal<Reveal | null>(null);
  protected readonly copied = signal<'key' | 'link' | null>(null);
  protected readonly editing = signal<GuestView | null>(null);
  protected readonly editLimits = signal<Limits | null>(null);
  protected readonly editQuota = signal(0);
  protected readonly newLimits = signal<Limits | null>(null);
  protected newName = '';
  protected newReferrals = 0;
  protected readonly fmt = formatBytes;
  protected readonly ago = timeAgo;
  protected readonly absolute = absoluteUrl;
  private timer?: ReturnType<typeof setInterval>;

  async ngOnInit(): Promise<void> {
    await this.load();
    try {
      this.newLimits.set((await this.api.get<{ settings: GlobalSettings }>('/api/admin/settings')).settings.defaultLimits);
    } catch (e: any) {
      this.error.set(e.message);
    }
    this.timer = setInterval(() => void this.load(), 8000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  private async load(): Promise<void> {
    try {
      this.guests.set((await this.api.get<{ guests: GuestView[] }>('/api/admin/guests')).guests);
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
      const r = await this.api.post<{ key: string; link: string }>('/api/admin/guests', {
        name: this.newName.trim(),
        referralQuota: this.newReferrals,
        limits: this.newLimits(),
      });
      this.reveal.set({ title: `Activation key for ${this.newName.trim()}`, key: r.key, link: r.link });
      this.newName = '';
      this.newReferrals = 0;
    });
    this.busy.set(false);
  }

  protected toggleEdit(g: GuestView): void {
    if (this.editing()?.id === g.id) {
      this.editing.set(null);
      return;
    }
    this.editing.set(g);
    this.editLimits.set({ ...g.limits });
    this.editQuota.set(g.referralQuota);
  }

  protected save(g: GuestView): Promise<void> {
    return this.act(async () => {
      await this.api.patch(`/api/admin/guests/${g.id}`, { limits: this.editLimits(), referralQuota: this.editQuota() });
      this.editing.set(null);
    });
  }

  protected reissue(g: GuestView): Promise<void> {
    return this.act(async () => {
      const r = await this.api.post<{ key: string; link: string }>(`/api/admin/guests/${g.id}/key`);
      this.reveal.set({ title: `New activation key for ${g.name}`, key: r.key, link: r.link });
    });
  }

  protected setStatus(g: GuestView, status: 'active' | 'disabled', cascade = false): Promise<void> {
    return this.act(() => this.api.patch(`/api/admin/guests/${g.id}`, { status, cascade }));
  }

  protected disable(g: GuestView): Promise<void> {
    if (!confirm(`Disable ${g.name}? They are signed out and their streams stop.`)) return Promise.resolve();
    const cascade = confirm(`Also disable everyone ${g.name} invited (directly or not)?\n\nOK = yes, Cancel = only ${g.name}`);
    return this.setStatus(g, 'disabled', cascade);
  }

  protected remove(g: GuestView): Promise<void> {
    if (!confirm(`Delete ${g.name} and all their rooms? This cannot be undone.`)) return Promise.resolve();
    return this.act(async () => {
      await this.api.delete(`/api/admin/guests/${g.id}`);
      this.editing.set(null);
    });
  }

  protected async copy(text: string, what: 'key' | 'link'): Promise<void> {
    if (await copyText(text)) {
      this.copied.set(what);
      setTimeout(() => this.copied.set(null), 1500);
    }
  }
}
