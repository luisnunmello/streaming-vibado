import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { RoomView } from '../../core/models';
import { absoluteUrl, copyText } from '../../core/util';

@Component({
  selector: 'app-rooms',
  imports: [FormsModule, RouterLink],
  template: `
    <h1 class="page-title">Rooms</h1>

    <div class="card create">
      <h2>New room</h2>
      <form class="row" (ngSubmit)="create()">
        <input type="text" name="name" [(ngModel)]="newName" placeholder="Room name" maxlength="40" required />
        <select name="vis" [(ngModel)]="newVisibility">
          <option value="public" [disabled]="!canPublic()">Public (listed in the lobby)</option>
          <option value="private">Private (secret link)</option>
        </select>
        <button class="btn primary" type="submit" [disabled]="busy() || !newName.trim() || full()">Create room</button>
      </form>
      @if (auth.me()?.limits; as l) {
        <p class="muted hint">You are using {{ ownCount() }} of {{ l.maxRooms }} rooms.</p>
      }
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="list">
          <thead>
            <tr>
              <th>Room</th>
              @if (auth.isAdmin()) {
                <th>Owner</th>
              }
              <th>Access</th>
              <th>Status</th>
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
                      <button class="btn small primary" type="submit">Save</button>
                      <button class="btn small" type="button" (click)="editing.set(null)">Cancel</button>
                    </form>
                  } @else {
                    <b>{{ r.name }}</b>
                    <div class="muted slug">/r/{{ r.slug }}</div>
                  }
                </td>
                @if (auth.isAdmin()) {
                  <td>{{ r.ownerName }}</td>
                }
                <td>
                  <span class="badge" [class.good]="r.visibility === 'public'">{{ r.visibility }}</span>
                </td>
                <td>
                  @if (r.live) {
                    <span class="badge live">LIVE</span> <span class="muted">{{ r.viewers }} watching</span>
                  } @else {
                    <span class="muted">offline</span>
                  }
                </td>
                <td class="actions">
                  @if (isMine(r)) {
                    <a class="btn small primary" [routerLink]="['/dashboard/rooms', r.slug]">{{ r.live ? 'Open studio' : 'Stream' }}</a>
                  }
                  <button type="button" class="btn small" (click)="copyLink(r)">{{ copied() === r.id ? 'Copied!' : 'Copy link' }}</button>
                  <a class="btn small" [href]="r.link" target="_blank" rel="noopener">Open</a>
                  <details class="more">
                    <summary class="btn small">More</summary>
                    <div class="menu">
                      <button type="button" (click)="startRename(r)">Rename</button>
                      @if (r.slug !== 'main') {
                        <button type="button" (click)="toggleVisibility(r)" [disabled]="r.visibility === 'private' && !canPublicFor(r)">
                          Make {{ r.visibility === 'public' ? 'private' : 'public' }}
                        </button>
                      }
                      @if (r.visibility === 'private') {
                        <button type="button" (click)="newLink(r)">New secret link (removes viewers)</button>
                      }
                      @if (r.live) {
                        <button type="button" (click)="stop(r)">Stop stream</button>
                      }
                      @if (r.slug !== 'main') {
                        <button type="button" class="danger" (click)="remove(r)">Delete room</button>
                      }
                    </div>
                  </details>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="muted">No rooms yet. Create your first one above.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: `
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
        position: absolute;
        right: 0;
        top: calc(100% + 4px);
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
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);

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
  protected readonly full = computed(() => {
    const l = this.auth.me()?.limits;
    return !!l && this.ownCount() >= l.maxRooms;
  });

  ngOnInit(): void {
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

  protected async create(): Promise<void> {
    this.busy.set(true);
    await this.act(async () => {
      await this.api.post('/api/rooms', { name: this.newName, visibility: this.newVisibility });
      this.newName = '';
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

  protected toggleVisibility(r: RoomView): Promise<void> {
    const next = r.visibility === 'public' ? 'private' : 'public';
    if (next === 'private' && r.viewers > 0 && !confirm('Making this room private removes everyone who is watching. Continue?')) return Promise.resolve();
    return this.act(() => this.api.patch(`/api/rooms/${r.id}`, { visibility: next }));
  }

  protected newLink(r: RoomView): Promise<void> {
    if (!confirm('The old link stops working and current viewers are removed. Continue?')) return Promise.resolve();
    return this.act(() => this.api.patch(`/api/rooms/${r.id}`, { regenerateSecret: true }));
  }

  protected stop(r: RoomView): Promise<void> {
    return this.act(() => this.api.post(`/api/rooms/${r.id}/stop`));
  }

  protected remove(r: RoomView): Promise<void> {
    if (!confirm(`Delete "${r.name}"? Its link stops working.`)) return Promise.resolve();
    return this.act(() => this.api.delete(`/api/rooms/${r.id}`));
  }

  protected async copyLink(r: RoomView): Promise<void> {
    if (await copyText(absoluteUrl(r.link))) {
      this.copied.set(r.id);
      setTimeout(() => this.copied() === r.id && this.copied.set(null), 1500);
    } else {
      this.error.set('Could not copy. Link: ' + absoluteUrl(r.link));
    }
  }
}
