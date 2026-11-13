import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DialogService } from '../../core/dialog.service';
import { I18nService, TPipe } from '../../core/i18n.service';
import type { InviteView, RoomView } from '../../core/models';
import { absoluteUrl, copyText } from '../../core/util';
import { Modal } from '../../shared/modal';

@Component({
  selector: 'app-invites',
  imports: [FormsModule, Modal, TPipe],
  template: `
    <div class="head row">
      <h1 class="page-title">{{ 'Temporary invites' | t }}</h1>
      <span class="spacer"></span>
      @if (cap() > 0) {
        <button type="button" class="btn primary" (click)="openNew()">{{ 'New invite' | t }}</button>
      }
    </div>
    <p class="intro muted">
      {{ 'A temporary invite lends one of your rooms, with your limits, to someone who needs no account or password. You can end it at any time, and so can they.' | t }}
    </p>
    @if (loaded() && cap() === 0) {
      <p class="muted">{{ 'Temporary invites are not allowed for your account.' | t }}</p>
    }

    @if (fresh(); as f) {
      <div class="card reveal">
        <h2>{{ 'Invite link' | t }}</h2>
        <p class="muted">{{ 'Shown only now. Send this link to the person you invite. It works once, within 24 hours.' | t }}</p>
        <div class="keybox">
          <code>{{ absolute(f.link) }}</code>
          <span class="spacer"></span>
          <button type="button" class="btn small" (click)="copy(f.link)">{{ (copied() ? 'Copied!' : 'Copy link') | t }}</button>
          <button type="button" class="btn small" (click)="fresh.set(null)">{{ 'Hide' | t }}</button>
        </div>
      </div>
    }

    @if (error() && !newOpen()) {
      <p class="error">{{ error() | t }}</p>
    }

    <app-modal [open]="newOpen()" [title]="'New temporary invite' | t" (closed)="newOpen.set(false)">
      <form (ngSubmit)="create()">
        <div class="field">
          <label for="iroom">{{ 'Room to lend' | t }}</label>
          <select id="iroom" name="iroom" [(ngModel)]="roomId">
            @for (r of rooms(); track r.id) {
              <option [value]="r.id">{{ i18n.roomName(r) }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="imin">{{ 'How long they can use it (minutes)' | t }} <small>{{ 'up to {n}' | t: { n: cap() } }}</small></label>
          <input id="imin" type="number" name="imin" min="1" [max]="cap()" [(ngModel)]="minutes" />
        </div>
        <p class="muted hint">{{ 'The time starts when they open the link. They stream with your limits and only in this room.' | t }}</p>
        @if (error()) {
          <p class="error">{{ error() | t }}</p>
        }
        <div class="modal-actions">
          <button type="button" class="btn" (click)="newOpen.set(false)">{{ 'Cancel' | t }}</button>
          <button type="submit" class="btn primary" [disabled]="busy() || !roomId">{{ 'Create invite' | t }}</button>
        </div>
      </form>
    </app-modal>

    @if (invites().length > 0) {
      <div class="card">
        <div class="table-wrap">
          <table class="list stack">
            <thead>
              <tr>
                <th>{{ 'Room' | t }}</th>
                <th>{{ 'Status' | t }}</th>
                <th>{{ 'Time' | t }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (i of invites(); track i.id) {
                <tr>
                  <td>
                    <b>{{ i18n.roomName({ name: i.roomName, ownerName: i.ownerName, autoName: i.autoName }) }}</b>
                  </td>
                  <td [attr.data-label]="'Status' | t">
                    <span class="badge" [class.good]="i.status === 'active'" [class.warn]="i.status === 'waiting'">{{ statusLabel(i) | t }}</span>
                  </td>
                  <td [attr.data-label]="'Time' | t" class="muted">{{ timeLabel(i) }}</td>
                  <td class="right">
                    @if (i.status === 'waiting' || i.status === 'active') {
                      <button type="button" class="btn small danger" (click)="revoke(i)">{{ (i.status === 'active' ? 'End now' : 'Revoke') | t }}</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    } @else if (loaded() && cap() > 0) {
      <p class="muted">{{ 'No invites yet.' | t }}</p>
    }
  `,
  styles: `
    .intro {
      margin: -0.4rem 0 1rem;
      max-width: 70ch;
    }
    .reveal {
      margin-bottom: 1rem;
    }
    .right {
      text-align: right;
    }
    small {
      font-weight: 400;
      opacity: 0.8;
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }
  `,
})
export class Invites implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  protected readonly i18n = inject(I18nService);
  protected readonly invites = signal<InviteView[]>([]);
  protected readonly rooms = signal<RoomView[]>([]);
  protected readonly cap = signal(0);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly newOpen = signal(false);
  protected readonly fresh = signal<{ link: string } | null>(null);
  protected readonly copied = signal(false);
  protected roomId = '';
  protected minutes = 30;
  protected readonly absolute = absoluteUrl;
  private timer?: ReturnType<typeof setInterval>;
  /** Refreshed every few seconds so "ends in" stays current. */
  private readonly now = signal(Date.now());
  protected readonly mine = computed(() => this.rooms());

  async ngOnInit(): Promise<void> {
    await this.load();
    this.timer = setInterval(() => {
      this.now.set(Date.now());
      void this.load();
    }, 5000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  private async load(): Promise<void> {
    try {
      const r = await this.api.get<{ cap: number; invites: InviteView[] }>('/api/me/invites');
      this.cap.set(r.cap);
      this.invites.set(r.invites);
      const me = this.auth.me();
      const { rooms } = await this.api.get<{ rooms: RoomView[] }>('/api/rooms');
      this.rooms.set(rooms.filter((x) => (me?.role === 'admin' ? x.ownerId === null : x.ownerId === me?.userId)));
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.loaded.set(true);
    }
  }

  protected openNew(): void {
    this.error.set(null);
    this.roomId = this.rooms()[0]?.id ?? '';
    this.minutes = Math.min(30, this.cap());
    this.newOpen.set(true);
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.api.post<{ link: string }>('/api/me/invites', { roomId: this.roomId, minutes: this.minutes });
      this.fresh.set({ link: r.link });
      this.newOpen.set(false);
      await this.load();
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async revoke(i: InviteView): Promise<void> {
    const msg = i.status === 'active' ? 'End this invite now? The guest is disconnected and their stream stops.' : 'Revoke this invite? The link stops working.';
    if (!(await this.dialog.confirm(msg, { title: 'Temporary invite', confirmLabel: i.status === 'active' ? 'End now' : 'Revoke', danger: true }))) return;
    try {
      await this.api.delete(`/api/me/invites/${i.id}`);
      await this.load();
    } catch (e: any) {
      this.error.set(e.message);
    }
  }

  protected async copy(link: string): Promise<void> {
    if (await copyText(absoluteUrl(link))) {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    }
  }

  protected statusLabel(i: InviteView): string {
    if (i.status === 'revoked') return i.revokedBy === 'guest' ? 'ended by the guest' : 'revoked';
    return i.status;
  }

  protected timeLabel(i: InviteView): string {
    const now = this.now();
    const mins = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
    if (i.status === 'active' && i.endsAt) return this.i18n.t('ends in {n} min', { n: mins(i.endsAt - now) });
    if (i.status === 'waiting') return this.i18n.t('{n} min once opened', { n: i.minutes });
    return this.i18n.t('{n} min', { n: i.minutes });
  }
}
