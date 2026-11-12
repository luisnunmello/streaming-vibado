import { Injectable, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';

/** Thin promise-based wrapper around the socket.io connection to the SFU server. */
@Injectable({ providedIn: 'root' })
export class SignalingService {
  private socket?: Socket;
  readonly connected = signal(false);

  /** Opens a new connection (closing any previous one). Register handlers with `on()` right after. */
  open(token?: string): void {
    this.close();
    const socket = io({ auth: token ? { token } : {}, transports: ['websocket'] });
    socket.on('connect', () => this.connected.set(true));
    socket.on('disconnect', () => this.connected.set(false));
    this.socket = socket;
  }

  close(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = undefined;
    this.connected.set(false);
  }

  /** Subscribes to a server event. Returns an unsubscribe function. */
  on<T = any>(event: string, handler: (data: T) => void): () => void {
    const socket = this.socket;
    socket?.on(event, handler);
    return () => socket?.off(event, handler);
  }

  request<T = any>(event: string, data: unknown = {}): Promise<T> {
    const socket = this.socket;
    if (!socket?.connected) return Promise.reject(new Error('Not connected to the server'));
    return new Promise<T>((resolve, reject) => {
      socket.timeout(15_000).emit(event, data, (err: Error | null, res: { ok: boolean; error?: string } & T) => {
        if (err) return reject(new Error('Server did not answer in time'));
        if (!res.ok) return reject(new Error(res.error ?? 'Request failed'));
        resolve(res);
      });
    });
  }
}
