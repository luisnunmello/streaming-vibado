import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiError, ApiService } from './api.service';
import type { Me } from './models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);

  readonly me = signal<Me | null>(null);
  readonly isAdmin = computed(() => this.me()?.role === 'admin');
  readonly isUser = computed(() => this.me()?.role === 'user');
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
      if (e instanceof ApiError && e.status === 401) this.api.setToken(null);
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
    this.api.setToken(null);
    this.me.set(null);
    this.loading = Promise.resolve();
  }

  changePassword(currentPassword: string, newPassword: string): Promise<unknown> {
    return this.api.put('/api/me/password', { currentPassword, newPassword });
  }
}
