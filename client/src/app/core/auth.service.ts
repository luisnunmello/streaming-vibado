import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiError, ApiService } from './api.service';
import type { Me } from './models';

const BACKUP_KEY = 'adminTokenBackup';

function readBackup(): string | null {
  try {
    return localStorage.getItem(BACKUP_KEY);
  } catch {
    return null;
  }
}

function writeBackup(token: string | null): void {
  try {
    if (token) localStorage.setItem(BACKUP_KEY, token);
    else localStorage.removeItem(BACKUP_KEY);
  } catch {
    /* storage unavailable */
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);

  readonly me = signal<Me | null>(null);
  readonly isAdmin = computed(() => this.me()?.role === 'admin');
  readonly isUser = computed(() => this.me()?.role === 'user');
  /** Set while the admin is using another user's account (the admin's own token is kept aside). */
  readonly adminBackup = signal<string | null>(readBackup());
  private loading?: Promise<void>;

  /** Loads the current user once (from the stored token). */
  ensureLoaded(): Promise<void> {
    this.loading ??= this.refresh();
    return this.loading;
  }

  async refresh(): Promise<void> {
    if (!this.api.token()) {
      this.me.set(null);
      return;
    }
    try {
      this.me.set(await this.api.get<Me>('/api/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // the temporary session ended (it lasts 2 hours): fall back to the admin's own
        const backup = this.adminBackup();
        if (backup) {
          this.setBackup(null);
          this.api.setToken(backup);
          return this.refresh();
        }
        this.api.setToken(null);
      }
      this.me.set(null);
    }
  }

  async login(name: string, password: string, remember = false): Promise<void> {
    const { token } = await this.api.post<{ token: string }>('/api/login', { name, password, remember });
    this.api.setToken(token);
    await this.refresh();
  }

  async activate(key: string, password: string, name?: string): Promise<void> {
    const { token } = await this.api.post<{ token: string }>('/api/activate', { key, password, name });
    this.api.setToken(token);
    await this.refresh();
  }

  private setBackup(token: string | null): void {
    this.adminBackup.set(token);
    writeBackup(token);
  }

  /** Admin only: switch to another user's account. The caller must stop any running stream first. */
  async impersonate(userId: number): Promise<void> {
    const adminToken = this.api.token();
    const { token } = await this.api.post<{ token: string }>(`/api/admin/users/${userId}/impersonate`);
    this.setBackup(adminToken);
    this.api.setToken(token);
    this.loading = undefined;
    await this.refresh();
  }

  /** Ends the temporary session and goes back to the admin account. */
  async returnToAdmin(): Promise<void> {
    const backup = this.adminBackup();
    if (!backup) return;
    try {
      await this.api.post('/api/logout'); // ends the temporary user session
    } catch {
      /* already gone */
    }
    this.setBackup(null);
    this.api.setToken(backup);
    this.loading = undefined;
    await this.refresh();
  }

  async logout(): Promise<void> {
    try {
      await this.api.post('/api/logout');
    } catch {
      /* already invalid */
    }
    this.clear();
  }

  /** The server ended this session (password changed elsewhere, account disabled…). */
  clear(): void {
    this.setBackup(null);
    this.api.setToken(null);
    this.me.set(null);
    this.loading = Promise.resolve();
  }

  changePassword(currentPassword: string, newPassword: string): Promise<unknown> {
    return this.api.put('/api/me/password', { currentPassword, newPassword });
  }
}
