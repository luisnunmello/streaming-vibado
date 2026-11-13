import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { DialogService } from '../../core/dialog.service';
import { AuthService } from '../../core/auth.service';
import type { RoomView } from '../../core/models';
import { I18nService, TPipe } from '../../core/i18n.service';
import { ShareService } from '../../core/share.service';
import { Modal } from '../../shared/modal';
import { PublicRooms } from '../../shared/public-rooms';
import { absoluteUrl, copyText } from '../../core/util';

@Component({
  selector: 'app-rooms',
  imports: [FormsModule, RouterLink, TPipe, PublicRooms, Modal],
  template: `
    @if (!auth.me()) {
      <h1 class="page-title">{{ 'Public rooms' | t }}</h1>
      <app-public-rooms />
    } @else {
    <div class="head row">
      <h1 class="page-title">{{ 'Rooms' | t }}</h1>
      <span class="spacer"></span>
      @if (!(singleRoom() && ownCount() >= 1)) {
        <button type="button" class="btn" [disabled]="full()" [title]="full() ? ('You have reached your room limit.' | t) : ''" (click)="openNew()">{{ 'New room' | t }}</button>
      }
      <button type="button" class="btn primary" [disabled]="sharing()" (click)="share()">{{ 'Share screen' | t }}</button>
    </div>

    @if (error() && !newOpen()) {
      <p class="error">{{ error() | t }}</p>
    }

    <app-modal [open]="newOpen()" [title]="'New room' | t" (closed)="newOpen.set(false)">
      <form (ngSubmit)="create()">
        @if (!singleRoom()) {
          <div class="field">
            <label for="rname">{{ 'Name' | t }}</label>
            <input id="rname" type="text" name="name" [(ngModel)]="newName" [placeholder]="'Room name' | t" maxlength="40" required />
          </div>
        } @else {
          <p class="muted">{{ 'Your room is named after you:' | t }} <b>{{ i18n.t("{name}'s room", { name: auth.me()?.name ?? '' }) }}</b></p>
        }
        <div class="field">
          <label for="rvis">{{ 'Access' | t }}</label>
          <select id="rvis" name="vis" [(ngModel)]="newVisibility">
            <option value="public" [disabled]="!canPublic()">{{ 'Public (listed in the lobby)' | t }}</option>
            <option value="private">{{ 'Private (secret link)' | t }}</option>
          </select>
        </div>
        @if (auth.me()?.limits; as l) {
          <p class="muted hint">{{ 'You are using {n} of {max} rooms.' | t: { n: ownCount(), max: l.maxRooms } }}</p>
        }
        @if (error()) {
          <p class="error">{{ error() | t }}</p>
        }
        <div class="modal-actions">
          <button class="btn" type="button" (click)="newOpen.set(false)">{{ 'Cancel' | t }}</button>
          <button class="btn primary" type="submit" [disabled]="busy() || (!singleRoom() && !newName.trim()) || full()">{{ 'Create room' | t }}</button>
        </div>
      </form>
    </app-modal>

    <div class="card">
      <div class="table-wrap">
        <table class="list">
          <thead>
            <tr>
              <th>{{ 'Room' | t }}</th>
              @if (auth.isAdmin()) {
                <th>{{ 'Owner' | t }}</th>
              }
              <th>{{ 'Access' | t }}</th>
              <th>{{ 'Status' | t }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (r of rooms(); track r.id) {
              <tr>
                <td>
                  @if (editing() === r.id) {
                    <form class="row" (ngSubmit)="saveName(r)">
                      <input type="text" name="rename" [(ngModel)]="editName" maxlength="40" />
                      <button class="btn small primary" type="submit">{{ 'Save' | t }}</button>
                      <button class="btn small" type="button" (click)="editing.set(null)">{{ 'Cancel' | t }}</button>
                    </form>
                  } @else {
                    <b>{{ i18n.roomName(r) }}</b>
                    <div class="muted slug">/r/{{ r.slug }}</div>
                  }
                </td>
                @if (auth.isAdmin()) {
                  <td>{{ r.ownerName }}</td>
                }
                <td>
                  <span class="badge" [class.good]="r.visibility === 'public'">{{ r.visibility | t }}</span>
                </td>
                <td>
                  @if (r.live) {
                    <span class="badge live">{{ 'LIVE' | t }}</span> <span class="muted">{{ '{n} watching' | t: { n: r.viewers } }}</span>
                  } @else {
                    <span class="muted">{{ 'offline' | t }}</span>
                  }
                </td>
                <td>
                <div class="actions">
                  @if (isMine(r)) {
                    <a class="btn small primary" [routerLink]="['/dashboard/rooms', r.slug]">{{ (r.live ? 'Open studio' : 'Stream') | t }}</a>
                  }
                  <button type="button" class="btn small" (click)="copyLink(r)">{{ (copied() === r.id ? 'Copied!' : 'Copy link') | t }}</button>
                  <a class="btn small" [href]="r.link" target="_blank" rel="noopener">{{ 'Open' | t }}</a>
                  <details class="more" (toggle)="placeMenu($event)">
                    <summary class="btn small">{{ 'More' | t }}</summary>
                    <div class="menu">
                      @if (!singleRoom()) {
                        <button type="button" (click)="startRename(r)">{{ 'Rename' | t }}</button>
                      }
                      @if (r.slug !== 'main') {
                        <button type="button" (click)="toggleVisibility(r)" [disabled]="r.visibility === 'private' && !canPublicFor(r)">
                          {{ (r.visibility === 'public' ? 'Make private' : 'Make public') | t }}
                        </button>
                      }
                      @if (r.visibility === 'private') {
                        <button type="button" (click)="newLink(r)">{{ 'New secret link (removes viewers)' | t }}</button>
                      }
                      @if (r.live) {
                        <button type="button" (click)="stop(r)">{{ 'Stop stream' | t }}</button>
                      }
                      @if (r.slug !== 'main') {
                        <button type="button" class="danger" (click)="remove(r)">{{ 'Delete room' | t }}</button>
                      }
                    </div>
                  </details>
                </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="muted">{{ 'No rooms yet. Create your first one above.' | t }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    }
  `,
  styles: `
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .create {
      margin-bottom: 1rem;
      input[type='text'] {
        flex: 1;
        min-width: 200px;
        width: auto;
      }
      select {
        width: auto;
      }
    }
    .hint {
      margin: 0.6rem 0 0;
      font-size: 0.85rem;
    }
    .slug {
      font-size: 0.8rem;
    }
    .actions {
      display: flex;
      gap: 0.4rem;
      justify-content: flex-end;
      flex-wrap: wrap;
      a {
        text-decoration: none;
      }
    }
    .more {
      position: relative;
      summary {
        list-style: none;
        cursor: pointer;
      }
      summary::-webkit-details-marker {
        display: none;
      }
      .menu {
        position: fixed; // not clipped by the scrolling table wrapper; placed by placeMenu()
        right: 0;
        top: 0;
        z-index: 5;
        min-width: 230px;
        display: grid;
        padding: 0.3rem;
        border-radius: 10px;
        border: 1px solid var(--line);
        background: var(--panel-2);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        button {
          text-align: left;
          padding: 0.5rem 0.7rem;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--text);
          font: inherit;
          font-size: 0.9rem;
          cursor: pointer;
          &:hover:not(:disabled) {
            background: var(--panel);
          }
          &:disabled {
            opacity: 0.45;
            cursor: not-allowed;
          }
          &.danger {
            color: var(--bad);
          }
        }
      }
    }
  `,
})
export class Rooms implements OnInit, OnDestroy {
  /** Puts the open "More" menu under its button, in viewport coordinates, and closes it when the page moves. */
  protected placeMenu(ev: Event): void {
    const details = ev.target as HTMLDetailsElement;
    if (!details.open) return;
    const menu = details.querySelector<HTMLElement>('.menu');
    const btn = details.querySelector<HTMLElement>('summary');
    if (!menu || !btn) return;
    const r = btn.getBoundingClientRect();
    menu.style.top = r.bottom + 4 + 'px';
    menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    const close = () => {
      details.open = false;
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
  }

  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly dialog = inject(DialogService);

  protected readonly rooms = signal<RoomView[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly editing = signal<string | null>(null);
  protected readonly copied = signal<string | null>(null);
  protected newName = '';
  protected newVisibility: 'public' | 'private' = 'private';
  protected editName = '';
  private timer?: ReturnType<typeof setInterval>;

  protected readonly ownCount = computed(() => this.rooms().filter((r) => this.isMine(r)).length);
  protected readonly canPublic = computed(() => this.auth.me()?.limits?.allowPublicRooms !== false);
  protected readonly i18n = inject(I18nService);
  private readonly shareSvc = inject(ShareService);
  protected readonly sharing = signal(false);
  protected readonly newOpen = signal(false);
  /** A user who may have only one room gets it named after them; only its privacy is configurable. */
  protected readonly singleRoom = computed(() => this.auth.me()?.role === 'user' && this.auth.me()?.limits?.maxRooms === 1);
  protected readonly full = computed(() => {
    const l = this.auth.me()?.limits;
    return !!l && this.ownCount() >= l.maxRooms;
  });

  ngOnInit(): void {
    if (!this.auth.me()) return; // visitors only see the public rooms
    void this.load();
    this.timer = setInterval(() => void this.load(), 5000);
    this.newVisibility = this.canPublic() ? 'public' : 'private';
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  /** The studio is only for rooms you own (the admin owns the main room and their own). */
  protected isMine(r: RoomView): boolean {
    const me = this.auth.me();
    return !!me && (me.role === 'admin' ? r.ownerId === null : r.ownerId === me.userId);
  }

  protected canPublicFor(_r: RoomView): boolean {
    return this.canPublic();
  }

  private async load(): Promise<void> {
    if (!this.auth.me()) return;
    try {
      this.rooms.set((await this.api.get<{ rooms: RoomView[] }>('/api/rooms')).rooms);
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

  protected async share(): Promise<void> {
    this.sharing.set(true);
    this.error.set(null);
    try {
      await this.shareSvc.shareScreen();
    } catch (e: any) {
      this.error.set(e.message ?? String(e));
    } finally {
      this.sharing.set(false);
    }
  }

  protected openNew(): void {
    this.error.set(null);
    this.newName = '';
    this.newOpen.set(true);
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    await this.act(async () => {
      await this.api.post('/api/rooms', { name: this.singleRoom() ? '' : this.newName, visibility: this.newVisibility });
      this.newName = '';
      this.newOpen.set(false);
    });
    this.busy.set(false);
  }

  protected startRename(r: RoomView): void {
    this.editName = r.name;
    this.editing.set(r.id);
  }

  protected saveName(r: RoomView): Promise<void> {
    return this.act(async () => {
      await this.api.patch(`/api/rooms/${r.id}`, { name: this.editName });
      this.editing.set(null);
    });
  }

  protected async toggleVisibility(r: RoomView): Promise<void> {
    const next = r.visibility === 'public' ? 'private' : 'public';
    if (next === 'private' && r.viewers > 0 && !(await this.dialog.confirm('Making this room private removes everyone who is watching. Continue?', { title: 'Make room private', confirmLabel: 'Make private' }))) return;
    return this.act(() => this.api.patch(`/api/rooms/${r.id}`, { visibility: next }));
  }

  protected async newLink(r: RoomView): Promise<void> {
    if (!(await this.dialog.confirm('The old link stops working and current viewers are removed. Continue?', { title: 'New secret link', confirmLabel: 'Create new link' }))) return;
    return this.act(() => this.api.patch(`/api/rooms/${r.id}`, { regenerateSecret: true }));
  }

  protected stop(r: RoomView): Promise<void> {
    return this.act(() => this.api.post(`/api/rooms/${r.id}/stop`));
  }

  protected async remove(r: RoomView): Promise<void> {
    if (!(await this.dialog.confirm('Delete "{name}"? Its link stops working.', { title: 'Delete room', confirmLabel: 'Delete', danger: true, params: { name: this.i18n.roomName(r) } }))) return;
    return this.act(() => this.api.delete(`/api/rooms/${r.id}`));
  }

  protected async copyLink(r: RoomView): Promise<void> {
    if (await copyText(absoluteUrl(r.link))) {
      this.copied.set(r.id);
      setTimeout(() => this.copied() === r.id && this.copied.set(null), 1500);
    } else {
      this.error.set(this.i18n.t('Could not copy. Link: {link}', { link: absoluteUrl(r.link) }));
    }
  }
}
