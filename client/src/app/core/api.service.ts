import { Injectable, signal } from '@angular/core';

const KEY = 'sessionToken';

function readToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly token = signal<string | null>(readToken());

  setToken(token: string | null): void {
    this.token.set(token);
    try {
      if (token) localStorage.setItem(KEY, token);
      else localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable: the session just won't survive a reload */
    }
  }

  async call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = this.token();
    if (token) headers['authorization'] = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError('Could not reach the server', 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
    return data as T;
  }

  get = <T = any>(path: string) => this.call<T>('GET', path);
  post = <T = any>(path: string, body: unknown = {}) => this.call<T>('POST', path, body);
  put = <T = any>(path: string, body: unknown) => this.call<T>('PUT', path, body);
  patch = <T = any>(path: string, body: unknown) => this.call<T>('PATCH', path, body);
  delete = <T = any>(path: string) => this.call<T>('DELETE', path);
}
