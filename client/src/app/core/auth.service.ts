import { Injectable, signal } from '@angular/core';

const KEY = 'adminToken';

function readToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly token = signal<string | null>(readToken());

  private async call(path: string, body?: unknown, auth = true): Promise<any> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = this.token();
    if (auth && token) headers['authorization'] = `Bearer ${token}`;
    const res = await fetch(path, {
      method: body === undefined && path.endsWith('session') ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status });
    return data;
  }

  private setToken(token: string | null) {
    this.token.set(token);
    try {
      if (token) localStorage.setItem(KEY, token);
      else localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable: the session just won't survive a reload */
    }
  }

  async login(password: string): Promise<void> {
    const { token } = await this.call('/api/admin/login', { password }, false);
    this.setToken(token);
  }

  /** Checks a stored token against the server; clears it if it is no longer valid. */
  async validate(): Promise<boolean> {
    if (!this.token()) return false;
    try {
      await this.call('/api/admin/session');
      return true;
    } catch (e: any) {
      if (e.status === 401) this.setToken(null);
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.call('/api/admin/logout', {});
    } catch {
      /* already invalid */
    }
    this.setToken(null);
  }

  /** Called when the server tells us the session was revoked (e.g. password changed elsewhere). */
  expire(): void {
    this.setToken(null);
  }

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.call('/api/admin/password', { currentPassword, newPassword });
  }
}
