import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { I18nService, TPipe } from '../../core/i18n.service';
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
  imports: [FormsModule, LimitsEditor, Modal, RouterLink, TPipe],
  template: `
    <div class="head row">
      <h1 class="page-title">{{ 'Users' | t }}</h1>
      <span class="spacer"></span>
      <button type="button" class="btn primary" (click)="openNew()">{{ 'New user' | t }}</button>
    </div>

    <app-modal [open]="newOpen()" [wide]="true" [title]="'New user' | t" (closed)="newOpen.set(false)">
      <form (ngSubmit)="create()">
        <div class="row">
          <div class="field grow">
            <label for="uname">{{ 'Name' | t }}</label>
            <input id="uname" type="text" name="uname" [(ngModel)]="newName" maxlength="24" [placeholder]="'e.g. maria' | t" required />
          </div>
          <div class="field">
            <label for="uref">{{ 'Referrals' | t }}</label>
            <input id="uref" type="number" name="uref" min="0" max="1000" [(ngModel)]="newReferrals" />
          </div>
          <div class="field">
            <label for="upre">{{ 'Limits' | t }}</label>
            <select id="upre" name="upre" [ngModel]="newChoice()" (ngModelChange)="chooseNew($event)">
              @for (p of presets(); track p.id) {
                <option [value]="p.id">{{ p.name }}{{ p.isDefault ? (' (default)' | t) : '' }}</option>
              }
              <option [value]="custom">{{ 'Custom…' | t }}</option>
            </select>
          </div>
        </div>
        @if (presetOf(newChoice()); as p) {
          <p class="muted hint">{{ 'Follows' | t }} <b>{{ p.name }}</b>{{ '. Change any value below to stop following it.' | t }} <a routerLink="/dashboard/presets">{{ 'Manage presets' | t }}</a></p>
        }
        @if (newLimits(); as l) {
          <app-limits-editor [limits]="l" (limitsChange)="editNew($event)" />
        }
        @if (error()) {
          <p class="error">{{ error() | t }}</p>
        }
        <div class="modal-actions">
          <button class="btn" type="button" (click)="newOpen.set(false)">{{ 'Cancel' | t }}</button>
          <button class="btn primary" type="submit" [class.busy]="busy()" [disabled]="busy() || !newName.trim()">{{ 'Create and generate key' | t }}</button>
        </div>
      </form>
    </app-modal>

    @if (error() && !newOpen()) {
      <p class="error">{{ error() | t }}</p>
    }

    @if (reveal(); as r) {
      <div class="card reveal">
        <h2>{{ r.title }}</h2>
        <p class="muted">{{ 'This key is shown only once and expires in 7 days. Send it to the person (the link opens the activation page with the key filled in).' | t }}</p>
        <div class="keybox">
          <code>{{ r.key }}</code>
          <span class="spacer"></span>
          <button type="button" class="btn small" (click)="copy(r.key, 'key')">{{ (copied() === 'key' ? 'Copied!' : 'Copy key') | t }}</button>
          <button type="button" class="btn small" (click)="copy(absolute(r.link), 'link')">{{ (copied() === 'link' ? 'Copied!' : 'Copy link') | t }}</button>
          <button type="button" class="btn small" (click)="reveal.set(null)">{{ 'Hide' | t }}</button>
        </div>
      </div>
    }

    @if (selected().size > 0) {
      <div class="card bulk">
        <h2>{{ '{n} selected' | t: { n: selected().size } }}</h2>
        <div class="row">
          <div class="field narrow">
            <label for="bpre">{{ 'Apply limits' | t }}</label>
            <select id="bpre" [value]="bulkChoice()" (change)="chooseBulk($any($event.target).value)">
              @for (p of presets(); track p.id) {
                <option [value]="p.id" [selected]="bulkChoice() === '' + p.id">{{ p.name }}{{ p.isDefault ? (' (default)' | t) : '' }}</option>
              }
              <option [value]="custom" [selected]="bulkChoice() === custom">{{ 'Custom…' | t }}</option>
            </select>
          </div>
        </div>
        @if (presetOf(bulkChoice()); as p) {
          <p class="muted hint">{{ 'The selected users will follow' | t }} <b>{{ p.name }}</b> {{ 'from now on. Change any value below to give them custom limits instead.' | t }}</p>
        }
        @if (bulkLimits(); as l) {
          <app-limits-editor [limits]="l" (limitsChange)="editBulk($event)" />
        }
        <div class="row actions">
          <button type="button" class="btn primary small" [class.busy]="busy()" [disabled]="busy()" (click)="applyBulk()">{{ 'Apply to {n} user(s)' | t: { n: selected().size } }}</button>
          <button type="button" class="btn small" (click)="selected.set(emptySet)">{{ 'Clear selection' | t }}</button>
        </div>
        @if (bulkMessage()) {
          <p class="muted hint">{{ bulkMessage() }}</p>
        }
      </div>
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
          <thead>
            <tr>
              <th class="chk"><input type="checkbox" [attr.aria-label]="'Select all users' | t" [checked]="allSelected()" (change)="toggleAll($any($event.target).checked)" /></th><th>{{ 'User' | t }}</th><th>{{ 'Status' | t }}</th><th>{{ 'Limits' | t }}</th><th>{{ 'Referred by' | t }}</th><th>{{ 'Rooms' | t }}</th><th>{{ 'Referrals' | t }}</th><th>{{ 'This month' | t }}</th><th>{{ 'Last seen' | t }}</th><th></th>
            </tr>
          </thead>
          <tbody>
            @for (u of users(); track u.id) {
              <tr>
                <td class="chk"><input type="checkbox" [attr.aria-label]="'Select ' + u.name" [checked]="selected().has(u.id)" (change)="toggleOne(u.id, $any($event.target).checked)" /></td>
                <td><b>{{ u.name }}</b></td>
                <td [attr.data-label]="'Status' | t">
                  @if (u.restricted) {
                    <span class="badge bad" [title]="u.restrictedReason">{{ 'restricted' | t }}</span>
                  }
                  @if (u.appealStatus === 'pending') {
                    <span class="badge warn" [title]="'This user appealed their restriction. Open Edit to read it.' | t">{{ 'appeal' | t }}</span>
                  }
                  <span class="badge" [class.good]="u.status === 'active'" [class.warn]="u.status === 'pending'" [class.bad]="u.status === 'disabled'">{{ u.status | t }}</span>
                </td>
                <td [attr.data-label]="'Limits' | t">
                  @if (u.presetName) {
                    <span class="badge">{{ u.presetName }}</span>
                  } @else {
                    <span class="badge warn" [title]="'Not following a preset' | t">{{ 'custom' | t }}</span>
                  }
                </td>
                <td [attr.data-label]="'Referred by' | t" class="muted">{{ (u.invitedByName ?? 'Admin') | t }}</td>
                <td [attr.data-label]="'Rooms' | t">{{ u.rooms }}@if (u.liveRooms) { <span class="badge live">{{ '{n} live' | t: { n: u.liveRooms } }}</span> }</td>
                <td [attr.data-label]="'Referrals' | t">{{ u.referralsUsed }} / {{ u.referralQuota }}</td>
                <td [attr.data-label]="'This month' | t">{{ fmt(u.monthBytes) }}</td>
                <td [attr.data-label]="'Last seen' | t" class="muted">{{ u.status === 'pending' ? ('not activated' | t) : ago(u.lastSeen) }}</td>
                <td class="right">
                  <button type="button" class="btn small" (click)="toggleEdit(u)">{{ (editing()?.id === u.id ? 'Close' : 'Edit') | t }}</button>
                </td>
              </tr>
              @if (editing(); as e) {
                @if (e.id === u.id) {
                  <tr class="edit">
                    <td colspan="10">
                      <div class="row">
                        <div class="field narrow">
                          <label [for]="'q' + u.id">{{ 'Referrals this user may create' | t }}</label>
                          <input [id]="'q' + u.id" type="number" min="0" max="1000" [value]="editQuota()" (input)="editQuota.set(+$any($event.target).value)" />
                          @if (u.referralsUsed > 0) {
                            <small class="muted">{{ '{n} already used' | t: { n: u.referralsUsed } }}</small>
                          }
                        </div>
                        <div class="field narrow">
                          <label [for]="'p' + u.id">{{ 'Limits' | t }}</label>
                          <select [id]="'p' + u.id" [value]="editChoice()" (change)="chooseEdit($any($event.target).value)">
                            @for (p of presets(); track p.id) {
                              <option [value]="p.id" [selected]="editChoice() === '' + p.id">{{ p.name }}{{ p.isDefault ? (' (default)' | t) : '' }}</option>
                            }
                            <option [value]="custom" [selected]="editChoice() === custom">{{ 'Custom…' | t }}</option>
                          </select>
                        </div>
                      </div>
                      @if (presetOf(editChoice()); as p) {
                        <p class="muted hint">
                          {{ 'Follows' | t }} <b>{{ p.name }}</b>{{ ': changing the preset changes this user too. Change any value below to stop following it.' | t }}
                        </p>
                      }
                      @if (editLimits(); as l) {
                        <app-limits-editor [limits]="l" (limitsChange)="editUser($event)" />
                      }
                      @if (u.invitedByName) {
                        <p class="muted hint">{{ 'Referred by {name}, so these limits can never go above theirs.' | t: { name: u.invitedByName } }}</p>
                      }
                      <div class="row actions">
                        <button type="button" class="btn primary small" (click)="save(u)">{{ 'Save changes' | t }}</button>
                        <span class="spacer"></span>
                        <button type="button" class="btn small" (click)="reissue(u)">{{ (u.status === 'pending' ? 'New activation key' : 'Reset password (new key)') | t }}</button>
                        @if (u.status === 'disabled') {
                          <button type="button" class="btn small" (click)="setStatus(u, 'active')">{{ 'Enable' | t }}</button>
                        } @else if (u.status === 'active') {
                          <button type="button" class="btn small" (click)="disable(u)">{{ 'Disable' | t }}</button>
                        }
                        @if (u.status === 'active') {
                          <button type="button" class="btn small" [title]="'Sign in as this user for debugging; you can return to admin from the top bar' | t" (click)="useAs(u)">{{ 'Use temporarily' | t }}</button>
                        }
                        <button type="button" class="btn small" [title]="'Create a preset from the limits shown above' | t" (click)="openSavePreset(u)">{{ 'Save limits as preset…' | t }}</button>
                        <button type="button" class="btn small" [class.danger]="!u.restricted" (click)="openRestrict(u)">{{ (u.restricted ? 'Restriction…' : 'Restrict…') | t }}</button>
                        <button type="button" class="btn small danger" (click)="remove(u)">{{ 'Delete' | t }}</button>
                      </div>
                    </td>
                  </tr>
                }
              }
            } @empty {
              <tr><td colspan="10" class="muted">{{ 'No users yet.' | t }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    <app-modal [open]="!!presetFrom()" [title]="'Save limits as a preset' | t" (closed)="presetFrom.set(null)">
      @if (presetFrom(); as u) {
        <form (ngSubmit)="savePreset(u)">
          <p class="muted hint">{{ 'Creates a new preset with the limits currently shown for' | t }} <b>{{ u.name }}</b>.</p>
          <div class="field">
            <label for="spn">{{ 'Preset name' | t }}</label>
            <input id="spn" type="text" name="spn" [(ngModel)]="presetName" maxlength="40" required />
          </div>
          <label class="check"><input type="checkbox" name="spf" [(ngModel)]="presetFollow" /> {{ 'Make {name} follow the new preset' | t: { name: u.name } }}</label>
          @if (error()) {
            <p class="error">{{ error() | t }}</p>
          }
          <div class="modal-actions">
            <button class="btn" type="button" (click)="presetFrom.set(null)">{{ 'Cancel' | t }}</button>
            <button class="btn primary" type="submit" [class.busy]="busy()" [disabled]="busy() || !presetName.trim()">{{ 'Create preset' | t }}</button>
          </div>
        </form>
      }
    </app-modal>

    <app-modal [open]="!!restrictTarget()" [title]="(restrictLive()?.restricted ? 'Restriction on {name}' : 'Restrict {name}') | t: { name: restrictLive()?.name ?? '' }" (closed)="restrictTarget.set(null)">
      @if (restrictLive(); as u) {
        @if (!u.restricted) {
          <p class="muted hint">{{ 'The user can still sign in, but sees a red warning with your reason and cannot use the website. Running streams stop and their rooms are hidden.' | t }}</p>
          <div class="field">
            <label for="rs">{{ 'Reason (shown to them)' | t }}</label>
            <textarea id="rs" rows="3" maxlength="500" [value]="restrictReason()" (input)="restrictReason.set($any($event.target).value)"></textarea>
          </div>
          <label class="check"><input type="checkbox" [checked]="optChildren()" (change)="optChildren.set($any($event.target).checked)" /> {{ 'Also restrict everyone they referred (and the people those referred…)' | t }}</label>
          @if (optChildren()) {
            @if (willRestrictChildren(u); as kids) {
              <div class="chips child">@for (x of kids; track x.id) {<span class="chip">{{ x.name }}</span>}</div>
            } @else {
              <p class="muted hint none">{{ 'Nobody to restrict here.' | t }}</p>
            }
          }
          @if (u.invitedByName) {
            <label class="check"><input type="checkbox" [checked]="optParents()" (change)="optParents.set($any($event.target).checked)" /> {{ 'Also restrict who referred them ({name})' | t: { name: u.invitedByName } }}</label>
            @if (optParents()) {
              @if (willRestrictParent(u); as par) {
                <div class="chips parent">@for (x of [par]; track x.id) {<span class="chip">{{ x.name }}</span>}</div>
              } @else {
                <p class="muted hint none">{{ '{name} is already restricted.' | t: { name: u.invitedByName } }}</p>
              }
            }
          }
          <div class="modal-actions">
            <button type="button" class="btn" (click)="restrictTarget.set(null)">{{ 'Cancel' | t }}</button>
            <button type="button" class="btn danger" (click)="restrict(u)">{{ 'Restrict access' | t }}</button>
          </div>
        } @else {
          <p><b>{{ 'Reason:' | t }}</b> {{ u.restrictedReason }}</p>
          @if (u.appealStatus === 'pending') {
            <div class="appealbox">
              <b>{{ 'Appeal from {name}' | t: { name: u.name } }}</b> <span class="muted">{{ ago(u.appealAt) }}</span>
              <blockquote>{{ u.appealText }}</blockquote>
              <div class="field">
                <label for="dr">{{ 'Reply if you deny it (shown to them)' | t }}</label>
                <input id="dr" type="text" maxlength="500" [value]="denyReply()" (input)="denyReply.set($any($event.target).value)" />
              </div>
              <button type="button" class="btn small" (click)="denyAppeal(u)">{{ 'Deny appeal' | t }}</button>
              <span class="muted hint">{{ 'To accept it, lift the restriction below.' | t }}</span>
            </div>
          } @else if (u.appealStatus === 'denied') {
            <p class="muted">{{ 'Appeal denied. They can send a new one.' | t }}</p>
          }
          @if (causedChildren(u).length > 0) {
            <label class="check"><input type="checkbox" [checked]="optChildren()" (change)="optChildren.set($any($event.target).checked)" /> {{ 'Also lift it for the {n} user(s) restricted because of this one' | t: { n: causedChildren(u).length } }}</label>
            @if (optChildren()) {
              <div class="chips child">@for (x of causedChildren(u); track x.id) {<span class="chip">{{ x.name }}</span>}</div>
            }
          }
          @if (causedParent(u); as p) {
            <label class="check"><input type="checkbox" [checked]="optParents()" (change)="optParents.set($any($event.target).checked)" /> {{ 'Also lift it for {name}, who referred them' | t: { name: p.name } }}</label>
            @if (optParents()) {
              <div class="chips parent">@for (x of [p]; track x.id) {<span class="chip">{{ x.name }}</span>}</div>
            }
          }
          <div class="modal-actions">
            <button type="button" class="btn" (click)="restrictTarget.set(null)">{{ 'Close' | t }}</button>
            <button type="button" class="btn primary" (click)="unrestrict(u)">{{ 'Lift restriction' | t }}</button>
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
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      margin: 0 0 0.6rem 1.6rem;
    }
    .chip {
      padding: 0.15rem 0.6rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      border: 1px solid;
    }
    .chips.child .chip {
      color: var(--warn);
      border-color: var(--warn);
      background: rgba(253, 176, 34, 0.12);
    }
    .chips.parent .chip {
      color: #c4a8ff;
      border-color: #a07cf5;
      background: rgba(160, 124, 245, 0.14);
    }
    .none {
      margin: 0 0 0.6rem 1.6rem;
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
  protected readonly i18n = inject(I18nService);
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
  protected readonly describe = (l: Limits): string => describeLimits(l, (text, params) => this.i18n.t(text, params));
  protected readonly fmt = formatBytes;
  protected readonly ago = (ms: number | null): string => timeAgo(ms, (text, params) => this.i18n.t(text, params));
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
    const msg = choice === CUSTOM ? 'Give these custom limits to {n} user(s)? Their streams pick it up right away.' : 'Give the "{preset}" preset to {n} user(s)? Their streams pick it up right away.';
    if (!(await this.dialog.confirm(msg, { title: 'Apply limits', confirmLabel: 'Apply', params: { n: ids.length, preset: this.presetOf(choice)?.name ?? '' } }))) return;
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

  protected readonly loaded = signal(false);

  private async load(): Promise<void> {
    try {
      this.users.set((await this.api.get<{ users: UserView[] }>('/api/admin/users')).users);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.loaded.set(true);
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
    // the field counts only the referrals still to give: the ones already used are kept on top of it
    this.editQuota.set(Math.max(0, u.referralQuota - u.referralsUsed));
  }

  protected chooseEdit(choice: string): void {
    const p = this.presetOf(choice);
    if (p) this.editLimits.set({ ...p.limits });
    this.editChoice.set(choice);
  }

  protected save(u: UserView): Promise<void> {
    return this.act(async () => {
      const body: Record<string, unknown> = { referralQuota: Math.max(0, this.editQuota()) + u.referralsUsed };
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
    this.presetName = (u.presetName ? this.i18n.t('{name} copy', { name: u.presetName }) : this.i18n.t("{name}'s limits", { name: u.name })).slice(0, 40);
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

  /** Everyone invited by `u`, directly or not, who is not restricted yet (null when nobody). */
  protected willRestrictChildren(u: UserView): UserView[] | null {
    const all = this.users();
    const out: UserView[] = [];
    const walk = (id: number): void => {
      for (const x of all) {
        if (x.invitedById === id) {
          if (!x.restricted) out.push(x);
          walk(x.id);
        }
      }
    };
    walk(u.id);
    return out.length ? out : null;
  }

  /** The user who referred `u`, if they are not restricted yet. */
  protected willRestrictParent(u: UserView): UserView | null {
    const p = this.users().find((x) => x.id === u.invitedById);
    return p && !p.restricted ? p : null;
  }

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
      title: 'Disable {name}',
      message: '{name} is signed out and their streams stop.',
      confirmLabel: 'Disable',
      danger: true,
      checkbox: { label: 'Also disable everyone {name} invited (directly or not)' },
      params: { name: u.name },
    });
    if (r.ok) await this.setStatus(u, 'disabled', r.checked);
  }

  protected async remove(u: UserView): Promise<void> {
    if (!(await this.dialog.confirm('Delete {name} and all their rooms? This cannot be undone.', { title: 'Delete {name}', confirmLabel: 'Delete', danger: true, params: { name: u.name } }))) return;
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
