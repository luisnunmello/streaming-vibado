import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { StreamerService } from '../../core/streamer.service';
import { ApiService } from '../../core/api.service';
import { describeLimits, type Limits, type Preset, type UserView } from '../../core/models';
import { absoluteUrl, copyText, formatBytes, timeAgo } from '../../core/util';
import { DialogService } from '../../core/dialog.service';
import { LimitsEditor } from '../../shared/limits-editor';
import { Modal } from '../../shared/modal';

interface Reveal {
  title: string;
  key: string;
  link: string;
}

/** `<select>` value: a preset id, or this for hand-written limits. */
const CUSTOM = 'custom';

@Component({
  selector: 'app-users',
  imports: [FormsModule, LimitsEditor, Modal, RouterLink],
  template: `
    <div class="head">
      <h1 class="page-title">Users</h1>
      <button type="button" class="btn primary" (click)="openNew()">New user</button>
    </div>

    <app-modal [open]="newOpen()" [wide]="true" title="New user" (closed)="newOpen.set(false)">
      <form (ngSubmit)="create()">
        <div class="row">
          <div class="field grow">
            <label for="uname">Name</label>
            <input id="uname" type="text" name="uname" [(ngModel)]="newName" maxlength="24" placeholder="e.g. maria" required />
          </div>
          <div class="field">
            <label for="uref">Referrals</label>
            <input id="uref" type="number" name="uref" min="0" max="1000" [(ngModel)]="newReferrals" />
          </div>
          <div class="field">
            <label for="upre">Limits</label>
            <select id="upre" name="upre" [ngModel]="newChoice()" (ngModelChange)="chooseNew($event)">
              @for (p of presets(); track p.id) {
                <option [value]="p.id">{{ p.name }}{{ p.isDefault ? ' (default)' : '' }}</option>
              }
              <option [value]="custom">Custom…</option>
            </select>
          </div>
        </div>
        @if (presetOf(newChoice()); as p) {
          <p class="muted hint">Follows <b>{{ p.name }}</b>. Change any value below to stop following it. <a routerLink="/dashboard/presets">Manage presets</a></p>
        }
        @if (newLimits(); as l) {
          <app-limits-editor [limits]="l" (limitsChange)="editNew($event)" />
        }
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        <div class="modal-actions">
          <button class="btn" type="button" (click)="newOpen.set(false)">Cancel</button>
          <button class="btn primary" type="submit" [disabled]="busy() || !newName.trim()">Create and generate key</button>
        </div>
      </form>
    </app-modal>

    @if (error() && !newOpen()) {
      <p class="error">{{ error() }}</p>
    }

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

    @if (selected().size > 0) {
      <div class="card bulk">
        <h2>{{ selected().size }} selected</h2>
        <div class="row">
          <div class="field narrow">
            <label for="bpre">Apply limits</label>
            <select id="bpre" [value]="bulkChoice()" (change)="chooseBulk($any($event.target).value)">
              @for (p of presets(); track p.id) {
                <option [value]="p.id" [selected]="bulkChoice() === '' + p.id">{{ p.name }}{{ p.isDefault ? ' (default)' : '' }}</option>
              }
              <option [value]="custom" [selected]="bulkChoice() === custom">Custom…</option>
            </select>
          </div>
        </div>
        @if (presetOf(bulkChoice()); as p) {
          <p class="muted hint">The selected users will follow <b>{{ p.name }}</b> from now on. Change any value below to give them custom limits instead.</p>
        }
        @if (bulkLimits(); as l) {
          <app-limits-editor [limits]="l" (limitsChange)="editBulk($event)" />
        }
        <div class="row actions">
          <button type="button" class="btn primary small" [disabled]="busy()" (click)="applyBulk()">Apply to {{ selected().size }} user(s)</button>
          <button type="button" class="btn small" (click)="selected.set(emptySet)">Clear selection</button>
        </div>
        @if (bulkMessage()) {
          <p class="muted hint">{{ bulkMessage() }}</p>
        }
      </div>
    }

    <div class="card">
      <div class="table-wrap">
        <table class="list">
          <thead>
            <tr>
              <th class="chk"><input type="checkbox" aria-label="Select all users" [checked]="allSelected()" (change)="toggleAll($any($event.target).checked)" /></th><th>User</th><th>Status</th><th>Limits</th><th>Referred by</th><th>Rooms</th><th>Referrals</th><th>This month</th><th>Last seen</th><th></th>
            </tr>
          </thead>
          <tbody>
            @for (u of users(); track u.id) {
              <tr>
                <td class="chk"><input type="checkbox" [attr.aria-label]="'Select ' + u.name" [checked]="selected().has(u.id)" (change)="toggleOne(u.id, $any($event.target).checked)" /></td>
                <td><b>{{ u.name }}</b></td>
                <td>
                  @if (u.restricted) {
                    <span class="badge bad" [title]="u.restrictedReason">restricted</span>
                  }
                  @if (u.appealStatus === 'pending') {
                    <span class="badge warn" title="This user appealed their restriction. Open Edit to read it.">appeal</span>
                  }
                  <span class="badge" [class.good]="u.status === 'active'" [class.warn]="u.status === 'pending'" [class.bad]="u.status === 'disabled'">{{ u.status }}</span>
                </td>
                <td>
                  @if (u.presetName) {
                    <span class="badge">{{ u.presetName }}</span>
                  } @else {
                    <span class="badge warn" title="Not following a preset">custom</span>
                  }
                </td>
                <td class="muted">{{ u.invitedByName ?? 'Admin' }}</td>
                <td>{{ u.rooms }}@if (u.liveRooms) { <span class="badge live">{{ u.liveRooms }} live</span> }</td>
                <td>{{ u.referralsUsed }} / {{ u.referralQuota }}</td>
                <td>{{ fmt(u.monthBytes) }}</td>
                <td class="muted">{{ u.status === 'pending' ? 'not activated' : ago(u.lastSeen) }}</td>
                <td class="right">
                  <button type="button" class="btn small" (click)="toggleEdit(u)">{{ editing()?.id === u.id ? 'Close' : 'Edit' }}</button>
                </td>
              </tr>
              @if (editing(); as e) {
                @if (e.id === u.id) {
                  <tr class="edit">
                    <td colspan="10">
                      <div class="row">
                        <div class="field narrow">
                          <label [for]="'q' + u.id">Referrals this user may create</label>
                          <input [id]="'q' + u.id" type="number" min="0" max="1000" [value]="editQuota()" (input)="editQuota.set(+$any($event.target).value)" />
                        </div>
                        <div class="field narrow">
                          <label [for]="'p' + u.id">Limits</label>
                          <select [id]="'p' + u.id" [value]="editChoice()" (change)="chooseEdit($any($event.target).value)">
                            @for (p of presets(); track p.id) {
                              <option [value]="p.id" [selected]="editChoice() === '' + p.id">{{ p.name }}{{ p.isDefault ? ' (default)' : '' }}</option>
                            }
                            <option [value]="custom" [selected]="editChoice() === custom">Custom…</option>
                          </select>
                        </div>
                      </div>
                      @if (presetOf(editChoice()); as p) {
                        <p class="muted hint">
                          Follows <b>{{ p.name }}</b>: changing the preset changes this user too. Change any value below to stop following it.
                        </p>
                      }
                      @if (editLimits(); as l) {
                        <app-limits-editor [limits]="l" (limitsChange)="editUser($event)" />
                      }
                      @if (u.invitedByName) {
                        <p class="muted hint">Referred by {{ u.invitedByName }}, so these limits can never go above theirs.</p>
                      }
                      <div class="row actions">
                        <button type="button" class="btn primary small" (click)="save(u)">Save changes</button>
                        <span class="spacer"></span>
                        <button type="button" class="btn small" (click)="reissue(u)">{{ u.status === 'pending' ? 'New activation key' : 'Reset password (new key)' }}</button>
                        @if (u.status === 'disabled') {
                          <button type="button" class="btn small" (click)="setStatus(u, 'active')">Enable</button>
                        } @else if (u.status === 'active') {
                          <button type="button" class="btn small" (click)="disable(u)">Disable</button>
                        }
                        @if (u.status === 'active') {
                          <button type="button" class="btn small" title="Sign in as this user for debugging; you can return to admin from the top bar" (click)="useAs(u)">Use temporarily</button>
                        }
                        <button type="button" class="btn small" title="Create a preset from the limits shown above" (click)="openSavePreset(u)">Save limits as preset…</button>
                        <button type="button" class="btn small" [class.danger]="!u.restricted" (click)="openRestrict(u)">{{ u.restricted ? 'Restriction…' : 'Restrict…' }}</button>
                        <button type="button" class="btn small danger" (click)="remove(u)">Delete</button>
                      </div>
                    </td>
                  </tr>
                }
              }
            } @empty {
              <tr><td colspan="10" class="muted">No users yet.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    <app-modal [open]="!!presetFrom()" title="Save limits as a preset" (closed)="presetFrom.set(null)">
      @if (presetFrom(); as u) {
        <form (ngSubmit)="savePreset(u)">
          <p class="muted hint">Creates a new preset with the limits currently shown for <b>{{ u.name }}</b>.</p>
          <div class="field">
            <label for="spn">Preset name</label>
            <input id="spn" type="text" name="spn" [(ngModel)]="presetName" maxlength="40" required />
          </div>
          <label class="check"><input type="checkbox" name="spf" [(ngModel)]="presetFollow" /> Make {{ u.name }} follow the new preset</label>
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
          <div class="modal-actions">
            <button class="btn" type="button" (click)="presetFrom.set(null)">Cancel</button>
            <button class="btn primary" type="submit" [disabled]="busy() || !presetName.trim()">Create preset</button>
          </div>
        </form>
      }
    </app-modal>

    <app-modal [open]="!!restrictTarget()" [title]="restrictLive()?.restricted ? 'Restriction on ' + restrictLive()?.name : 'Restrict ' + restrictLive()?.name" (closed)="restrictTarget.set(null)">
      @if (restrictLive(); as u) {
        @if (!u.restricted) {
          <p class="muted hint">The user can still sign in, but sees a red warning with your reason and cannot use the website. Running streams stop and their rooms are hidden.</p>
          <div class="field">
            <label for="rs">Reason (shown to them)</label>
            <textarea id="rs" rows="3" maxlength="500" [value]="restrictReason()" (input)="restrictReason.set($any($event.target).value)"></textarea>
          </div>
          <label class="check"><input type="checkbox" [checked]="optChildren()" (change)="optChildren.set($any($event.target).checked)" /> Also restrict everyone they referred (and the people those referred…)</label>
          @if (u.invitedByName) {
            <label class="check"><input type="checkbox" [checked]="optParents()" (change)="optParents.set($any($event.target).checked)" /> Also restrict who referred them ({{ u.invitedByName }})</label>
          }
          <div class="modal-actions">
            <button type="button" class="btn" (click)="restrictTarget.set(null)">Cancel</button>
            <button type="button" class="btn danger" (click)="restrict(u)">Restrict access</button>
          </div>
        } @else {
          <p><b>Reason:</b> {{ u.restrictedReason }}</p>
          @if (u.appealStatus === 'pending') {
            <div class="appealbox">
              <b>Appeal from {{ u.name }}</b> <span class="muted">{{ ago(u.appealAt) }}</span>
              <blockquote>{{ u.appealText }}</blockquote>
              <div class="field">
                <label for="dr">Reply if you deny it (shown to them)</label>
                <input id="dr" type="text" maxlength="500" [value]="denyReply()" (input)="denyReply.set($any($event.target).value)" />
              </div>
              <button type="button" class="btn small" (click)="denyAppeal(u)">Deny appeal</button>
              <span class="muted hint">To accept it, lift the restriction below.</span>
            </div>
          } @else if (u.appealStatus === 'denied') {
            <p class="muted">Appeal denied. They can send a new one.</p>
          }
          @if (causedChildren(u).length > 0) {
            <label class="check"><input type="checkbox" [checked]="optChildren()" (change)="optChildren.set($any($event.target).checked)" /> Also lift it for the {{ causedChildren(u).length }} user(s) restricted because of this one</label>
          }
          @if (causedParent(u); as p) {
            <label class="check"><input type="checkbox" [checked]="optParents()" (change)="optParents.set($any($event.target).checked)" /> Also lift it for {{ p.name }}, who referred them</label>
          }
          <div class="modal-actions">
            <button type="button" class="btn" (click)="restrictTarget.set(null)">Close</button>
            <button type="button" class="btn primary" (click)="unrestrict(u)">Lift restriction</button>
          </div>
        }
      }
    </app-modal>
  `,
  styles: `
    .appealbox {
      display: grid;
      gap: 0.5rem;
      justify-items: start;
      width: 100%;
      padding: 0.6rem 0.8rem;
      border: 1px solid var(--warn);
      border-radius: 8px;
      blockquote {
        margin: 0;
        padding: 0.4rem 0.7rem;
        border-left: 3px solid var(--warn);
        background: var(--panel);
        white-space: pre-wrap;
      }
      .field {
        width: 100%;
      }
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .check {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      margin: 0.5rem 0;
    }
    .chk {
      width: 2rem;
    }
    .bulk {
      margin-bottom: 1rem;
      border-color: var(--accent);
    }
    .create,
    .reveal {
      margin-bottom: 1rem;
    }
    .grow {
      flex: 1;
      min-width: 200px;
    }
    .narrow {
      min-width: 220px;
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
    .hint {
      font-size: 0.88rem;
      margin: 0.4rem 0 0.8rem;
    }
    p {
      margin: 0 0 0.8rem;
    }
  `,
})
export class Users implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly streamer = inject(StreamerService);
  protected readonly users = signal<UserView[]>([]);
  protected readonly presets = signal<Preset[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly reveal = signal<Reveal | null>(null);
  protected readonly copied = signal<'key' | 'link' | null>(null);
  protected readonly editing = signal<UserView | null>(null);
  protected readonly editChoice = signal('');
  protected readonly editLimits = signal<Limits | null>(null);
  protected readonly editQuota = signal(0);
  protected readonly restrictTarget = signal<UserView | null>(null);
  protected readonly newOpen = signal(false);
  protected readonly presetFrom = signal<UserView | null>(null);
  protected presetName = '';
  protected presetFollow = true;
  protected readonly denyReply = signal('');
  protected readonly restrictReason = signal('');
  protected readonly optChildren = signal(true);
  protected readonly optParents = signal(false);
  protected readonly selected = signal<ReadonlySet<number>>(new Set());
  protected readonly emptySet: ReadonlySet<number> = new Set();
  protected readonly bulkChoice = signal('');
  protected readonly bulkLimits = signal<Limits | null>(null);
  protected readonly bulkMessage = signal<string | null>(null);
  protected readonly newChoice = signal('');
  protected readonly newLimits = signal<Limits | null>(null);
  protected newName = '';
  protected newReferrals = 0;
  protected readonly custom = CUSTOM;
  protected readonly describe = describeLimits;
  protected readonly fmt = formatBytes;
  protected readonly ago = timeAgo;
  protected readonly absolute = absoluteUrl;
  private timer?: ReturnType<typeof setInterval>;

  async ngOnInit(): Promise<void> {
    await Promise.all([this.load(), this.loadPresets()]);
    const def = this.presets().find((p) => p.isDefault);
    if (def) {
      this.newChoice.set('' + def.id);
      this.newLimits.set({ ...def.limits });
      this.bulkChoice.set('' + def.id);
      this.bulkLimits.set({ ...def.limits });
    }
    this.timer = setInterval(() => void this.load(), 8000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected allSelected(): boolean {
    const us = this.users();
    return us.length > 0 && us.every((u) => this.selected().has(u.id));
  }

  protected toggleAll(on: boolean): void {
    this.selected.set(on ? new Set(this.users().map((u) => u.id)) : new Set());
  }

  protected toggleOne(id: number, on: boolean): void {
    const next = new Set(this.selected());
    if (on) next.add(id);
    else next.delete(id);
    this.selected.set(next);
  }

  protected chooseBulk(choice: string): void {
    const p = this.presetOf(choice);
    if (p) this.bulkLimits.set({ ...p.limits });
    this.bulkChoice.set(choice);
  }

  /** Give the same preset (or the same hand-written limits) to every selected user. */
  protected async applyBulk(): Promise<void> {
    const ids = [...this.selected()];
    const choice = this.bulkChoice();
    if (!ids.length || !choice) return;
    const what = choice === CUSTOM ? 'these custom limits' : `the "${this.presetOf(choice)?.name}" preset`;
    if (!(await this.dialog.confirm(`Give ${what} to ${ids.length} user(s)? Their streams pick it up right away.`, { title: 'Apply limits', confirmLabel: 'Apply' }))) return;
    this.busy.set(true);
    this.bulkMessage.set(null);
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await this.api.patch(`/api/admin/users/${id}`, choice === CUSTOM ? { limits: this.bulkLimits() } : { presetId: Number(choice) });
      } catch (e: any) {
        failed.push(`${this.users().find((u) => u.id === id)?.name ?? id}: ${e.message}`);
      }
    }
    await Promise.all([this.load(), this.loadPresets()]);
    this.busy.set(false);
    this.bulkMessage.set(failed.length ? `Updated ${ids.length - failed.length} of ${ids.length}. Failed: ${failed.join('; ')}` : `Updated ${ids.length} user(s).`);
  }

  protected presetOf(choice: string): Preset | undefined {
    return this.presets().find((p) => '' + p.id === choice);
  }

  private async load(): Promise<void> {
    try {
      this.users.set((await this.api.get<{ users: UserView[] }>('/api/admin/users')).users);
    } catch (e: any) {
      this.error.set(e.message);
    }
  }

  private async loadPresets(): Promise<void> {
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

  protected chooseNew(choice: string): void {
    const p = this.presetOf(choice);
    if (p) this.newLimits.set({ ...p.limits }); // show what the preset gives; custom keeps the current values
    this.newChoice.set(choice);
  }

  /** Editing any limit by hand means the user no longer follows the preset. */
  protected editNew(l: Limits): void {
    this.newLimits.set(l);
    this.newChoice.set(CUSTOM);
  }
  protected editBulk(l: Limits): void {
    this.bulkLimits.set(l);
    this.bulkChoice.set(CUSTOM);
  }
  protected editUser(l: Limits): void {
    this.editLimits.set(l);
    this.editChoice.set(CUSTOM);
  }

  protected openNew(): void {
    this.error.set(null);
    this.newOpen.set(true);
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    await this.act(async () => {
      const body: Record<string, unknown> = { name: this.newName.trim(), referralQuota: this.newReferrals };
      if (this.newChoice() === CUSTOM) body['limits'] = this.newLimits();
      else body['presetId'] = Number(this.newChoice());
      const r = await this.api.post<{ key: string; link: string }>('/api/admin/users', body);
      this.reveal.set({ title: `Activation key for ${this.newName.trim()}`, key: r.key, link: r.link });
      this.newName = '';
      this.newReferrals = 0;
      this.newOpen.set(false);
    });
    this.busy.set(false);
  }

  protected toggleEdit(u: UserView): void {
    if (this.editing()?.id === u.id) {
      this.editing.set(null);
      return;
    }
    this.editing.set(u);
    this.restrictReason.set('');
    this.optChildren.set(true);
    this.optParents.set(false);
    this.editChoice.set(u.presetId ? '' + u.presetId : CUSTOM);
    this.editLimits.set({ ...u.limits });
    this.editQuota.set(u.referralQuota);
  }

  protected chooseEdit(choice: string): void {
    const p = this.presetOf(choice);
    if (p) this.editLimits.set({ ...p.limits });
    this.editChoice.set(choice);
  }

  protected save(u: UserView): Promise<void> {
    return this.act(async () => {
      const body: Record<string, unknown> = { referralQuota: this.editQuota() };
      if (this.editChoice() === CUSTOM) body['limits'] = this.editLimits();
      else if (this.editChoice() !== (u.presetId ? '' + u.presetId : '')) body['presetId'] = Number(this.editChoice());
      await this.api.patch(`/api/admin/users/${u.id}`, body);
      this.editing.set(null);
      await this.loadPresets();
    });
  }

  protected async useAs(u: UserView): Promise<void> {
    this.error.set(null);
    try {
      await this.streamer.leave(); // no stream may carry over between accounts
      await this.auth.impersonate(u.id);
      await this.router.navigateByUrl('/dashboard/rooms');
    } catch (e: any) {
      this.error.set(e.message);
    }
  }

  protected openSavePreset(u: UserView): void {
    this.error.set(null);
    this.presetName = u.presetName ? `${u.presetName} copy`.slice(0, 40) : `${u.name}'s limits`.slice(0, 40);
    this.presetFollow = true;
    this.presetFrom.set(u);
  }

  /** Copies the limits shown in the user's editor (their custom values, or a preset's) into a new preset. */
  protected async savePreset(u: UserView): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const limits = this.editing()?.id === u.id ? this.editLimits() : u.limits;
      const { preset } = await this.api.post<{ preset: Preset }>('/api/admin/presets', { name: this.presetName.trim(), limits });
      if (this.presetFollow) await this.api.patch(`/api/admin/users/${u.id}`, { presetId: preset.id });
      this.presetFrom.set(null);
      this.editing.set(null);
      await Promise.all([this.load(), this.loadPresets()]);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }

  protected openRestrict(u: UserView): void {
    this.restrictReason.set('');
    this.denyReply.set('');
    this.optChildren.set(true);
    this.optParents.set(false);
    this.restrictTarget.set(u);
  }

  /** The modal shows the latest data of its user (the list refreshes in the background). */
  protected readonly restrictLive = computed(() => {
    const t = this.restrictTarget();
    return t ? (this.users().find((x) => x.id === t.id) ?? t) : null;
  });

  /** Users below this one whose restriction was caused by restricting this user. */
  protected causedChildren(u: UserView): UserView[] {
    return this.users().filter((x) => x.restricted && x.restrictedById === u.id && x.id !== u.invitedById);
  }

  /** The user who referred this one, if their restriction was caused by restricting this user. */
  protected causedParent(u: UserView): UserView | undefined {
    return this.users().find((x) => x.id === u.invitedById && x.restricted && x.restrictedById === u.id);
  }

  protected restrict(u: UserView): Promise<void> {
    return this.act(async () => {
      await this.api.post(`/api/admin/users/${u.id}/restrict`, { reason: this.restrictReason().trim(), children: this.optChildren(), parents: this.optParents() });
      this.restrictReason.set('');
      this.restrictTarget.set(null);
      this.editing.set(null);
    });
  }

  protected denyAppeal(u: UserView): Promise<void> {
    return this.act(async () => {
      await this.api.post(`/api/admin/users/${u.id}/appeal/deny`, { reply: this.denyReply().trim() });
      this.denyReply.set('');
      this.restrictTarget.set(null);
    });
  }

  protected unrestrict(u: UserView): Promise<void> {
    return this.act(async () => {
      await this.api.post(`/api/admin/users/${u.id}/unrestrict`, {
        children: this.causedChildren(u).length > 0 && this.optChildren(),
        parents: !!this.causedParent(u) && this.optParents(),
      });
      this.restrictTarget.set(null);
      this.editing.set(null);
    });
  }

  protected reissue(u: UserView): Promise<void> {
    return this.act(async () => {
      const r = await this.api.post<{ key: string; link: string }>(`/api/admin/users/${u.id}/key`);
      this.reveal.set({ title: `New activation key for ${u.name}`, key: r.key, link: r.link });
    });
  }

  protected setStatus(u: UserView, status: 'active' | 'disabled', cascade = false): Promise<void> {
    return this.act(() => this.api.patch(`/api/admin/users/${u.id}`, { status, cascade }));
  }

  protected async disable(u: UserView): Promise<void> {
    const r = await this.dialog.ask({
      title: `Disable ${u.name}`,
      message: `${u.name} is signed out and their streams stop.`,
      confirmLabel: 'Disable',
      danger: true,
      checkbox: { label: `Also disable everyone ${u.name} invited (directly or not)` },
    });
    if (r.ok) await this.setStatus(u, 'disabled', r.checked);
  }

  protected async remove(u: UserView): Promise<void> {
    if (!(await this.dialog.confirm(`Delete ${u.name} and all their rooms? This cannot be undone.`, { title: `Delete ${u.name}`, confirmLabel: 'Delete', danger: true }))) return;
    return this.act(async () => {
      await this.api.delete(`/api/admin/users/${u.id}`);
      this.editing.set(null);
      await this.loadPresets();
    });
  }

  protected async copy(text: string, what: 'key' | 'link'): Promise<void> {
    if (await copyText(text)) {
      this.copied.set(what);
      setTimeout(() => this.copied.set(null), 1500);
    }
  }
}
