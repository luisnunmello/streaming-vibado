import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import type { RoomView } from './models';

const LAST_KEY = 'lastStudioRoom';

/**
 * "Share screen" shortcut: goes straight to the studio of the right room, creating the user's first room
 * when they have none. The studio starts the screen picker right away.
 */
@Injectable({ providedIn: 'root' })
export class ShareService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  remember(slug: string): void {
    try {
      localStorage.setItem(LAST_KEY, slug);
    } catch {
      /* storage unavailable */
    }
  }

  private lastUsed(): string | null {
    try {
      return localStorage.getItem(LAST_KEY);
    } catch {
      return null;
    }
  }

  /** Throws a message-carrying error when no room can be used. */
  async shareScreen(): Promise<void> {
    const me = this.auth.me();
    if (!me) throw new Error('Not signed in');
    const { rooms } = await this.api.get<{ rooms: RoomView[] }>('/api/rooms');
    const mine = rooms.filter((r) => (me.role === 'admin' ? r.ownerId === null : r.ownerId === me.userId));
    let target = mine.find((r) => r.slug === this.lastUsed()) ?? mine.find((r) => r.live) ?? mine[0];
    if (!target) {
      // first time: a private room (secret link) that is named after the user
      ({ room: target } = await this.api.post<{ room: RoomView }>('/api/rooms', { name: `${me.name}'s room`, visibility: 'private' }));
    }
    this.remember(target.slug);
    await this.router.navigate(['/dashboard/rooms', target.slug], { queryParams: { share: 1 } });
  }
}
