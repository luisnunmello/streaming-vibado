import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { PasswordCard } from '../../admin/password-card';
import { AuthService } from '../../core/auth.service';
import { formatBytes } from '../../core/util';

@Component({
  selector: 'app-account',
  imports: [PasswordCard, FormsModule],
  template: `
    <h1 class="page-title">Account</h1>
    <div class="layout">
      @if (auth.me(); as m) {
        @if (m.role === 'user') {
          <form class="card" (ngSubmit)="saveName()">
            <h2>Your name</h2>
            <p class="muted">Shown on your rooms and in the lobby. It is also the name you sign in with.</p>
            <div class="field">
              <label for="nick">Name</label>
              <input id="nick" type="text" name="nick" [(ngModel)]="nick" maxlength="24" autocomplete="username" required />
            </div>
            <button class="btn primary" type="submit" [disabled]="busy() || !nick.trim() || nick.trim() === m.name">Change name</button>
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
          <h2>{{ me.role === 'admin' ? 'Administrator' : 'Your account' }}</h2>
          <p><b>{{ me.name }}</b>@if (me.invitedByName) { <span class="muted"> · referred by {{ me.invitedByName }}</span> }</p>

          @if (me.limits; as l) {
            <table class="list">
              <tbody>
                <tr><td class="muted">Rooms</td><td>up to {{ l.maxRooms }}</td></tr>
                <tr><td class="muted">Streaming at the same time</td><td>{{ l.maxStreams }} room(s)</td></tr>
                <tr><td class="muted">Quality</td><td>up to {{ l.maxHeight }}p, {{ l.maxFps }} fps, {{ l.maxBitrateMbps }} Mbps</td></tr>
                <tr><td class="muted">Viewers per room</td><td>{{ l.maxViewersPerRoom }}</td></tr>
                <tr><td class="muted">Streams you can watch at once</td><td>{{ l.maxWatching }}</td></tr>
                <tr><td class="muted">Stream length</td><td>{{ l.maxStreamMinutes ? l.maxStreamMinutes + ' min' : 'unlimited' }}</td></tr>
                <tr><td class="muted">Public rooms</td><td>{{ l.allowPublicRooms ? 'allowed' : 'not allowed' }}</td></tr>
                <tr><td class="muted">Audio</td><td>{{ l.allowAudio ? 'allowed' : 'not allowed' }}</td></tr>
                <tr>
                  <td class="muted">Traffic this month</td>
                  <td>{{ fmt(me.monthBytes ?? 0) }}{{ l.monthlyGb ? ' of ' + l.monthlyGb + ' GB' : '' }}</td>
                </tr>
              </tbody>
            </table>
          } @else {
            <p class="muted">The administrator account has no per-account limits.</p>
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
