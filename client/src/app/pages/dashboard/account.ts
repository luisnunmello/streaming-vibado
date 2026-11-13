import { Component, inject, signal } from '@angular/core';
import { TPipe } from '../../core/i18n.service';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { PasswordCard } from '../../admin/password-card';
import { AuthService } from '../../core/auth.service';
import { formatBytes } from '../../core/util';

@Component({
  selector: 'app-account',
  imports: [PasswordCard, FormsModule, TPipe],
  template: `
    <h1 class="page-title">{{ 'Account' | t }}</h1>
    <div class="layout">
      @if (auth.me(); as m) {
        @if (m.role === 'user') {
          <form class="card" (ngSubmit)="saveName()">
            <h2>{{ 'Your name' | t }}</h2>
            <p class="muted">{{ 'Shown on your rooms and in the lobby. It is also the name you sign in with.' | t }}</p>
            <div class="field">
              <label for="nick">{{ 'Name' | t }}</label>
              <input id="nick" type="text" name="nick" [(ngModel)]="nick" maxlength="24" autocomplete="username" required />
            </div>
            <button class="btn primary" type="submit" [class.busy]="busy()" [disabled]="busy() || !nick.trim() || nick.trim() === m.name">{{ 'Change name' | t }}</button>
            @if (nameMsg()) {
              <p class="muted msg">{{ nameMsg() }}</p>
            }
            @if (nameError()) {
              <p class="error msg">{{ nameError() }}</p>
            }
          </form>
        }
      }
      <app-password-card />

      @if (auth.me(); as me) {
        <div class="card">
          <h2>{{ (me.role === 'admin' ? 'Administrator' : 'Your account') | t }}</h2>
          <p><b>{{ me.name }}</b>@if (me.invitedByName) { <span class="muted"> · {{ 'referred by {name}' | t: { name: me.invitedByName } }}</span> }</p>

          @if (me.limits; as l) {
            <table class="list">
              <tbody>
                <tr><td class="muted">{{ 'Rooms' | t }}</td><td>{{ 'up to {n}' | t: { n: l.maxRooms } }}</td></tr>
                <tr><td class="muted">{{ 'Streaming at the same time' | t }}</td><td>{{ '{n} room(s)' | t: { n: l.maxStreams } }}</td></tr>
                <tr><td class="muted">{{ 'Quality' | t }}</td><td>{{ 'up to {h}p, {fps} fps, {mbps} Mbps' | t: { h: l.maxHeight, fps: l.maxFps, mbps: l.maxBitrateMbps } }}</td></tr>
                <tr><td class="muted">{{ 'Viewers per room' | t }}</td><td>{{ l.maxViewersPerRoom }}</td></tr>
                <tr><td class="muted">{{ 'Streams you can watch at once' | t }}</td><td>{{ l.maxWatching }}</td></tr>
                <tr><td class="muted">{{ 'Stream length' | t }}</td><td>{{ l.maxStreamMinutes ? l.maxStreamMinutes + ' min' : 'unlimited' }}</td></tr>
                <tr><td class="muted">{{ 'Public rooms' | t }}</td><td>{{ l.allowPublicRooms ? 'allowed' : 'not allowed' }}</td></tr>
                <tr><td class="muted">{{ 'Audio' | t }}</td><td>{{ l.allowAudio ? 'allowed' : 'not allowed' }}</td></tr>
                <tr>
                  <td class="muted">{{ 'Traffic this month' | t }}</td>
                  <td>{{ fmt(me.monthBytes ?? 0) }}{{ l.monthlyGb ? ' of ' + l.monthlyGb + ' GB' : '' }}</td>
                </tr>
              </tbody>
            </table>
          } @else {
            <p class="muted">{{ 'The administrator account has no per-account limits.' | t }}</p>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .layout {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1rem;
      align-items: start;
    }
    p {
      margin: 0 0 0.8rem;
    }
    .msg {
      margin: 0.8rem 0 0;
    }
  `,
})
export class Account {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  protected readonly fmt = formatBytes;
  protected nick = this.auth.me()?.name ?? '';
  protected readonly busy = signal(false);
  protected readonly nameMsg = signal<string | null>(null);
  protected readonly nameError = signal<string | null>(null);

  protected async saveName(): Promise<void> {
    this.busy.set(true);
    this.nameMsg.set(null);
    this.nameError.set(null);
    try {
      const r = await this.api.put<{ name: string }>('/api/me/name', { name: this.nick.trim() });
      await this.auth.refresh();
      this.nick = r.name;
      this.nameMsg.set('Name changed.');
    } catch (e: any) {
      this.nameError.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }
}
