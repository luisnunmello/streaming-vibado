import { Component, inject } from '@angular/core';
import { PasswordCard } from '../../admin/password-card';
import { AuthService } from '../../core/auth.service';
import { formatBytes } from '../../core/util';

@Component({
  selector: 'app-account',
  imports: [PasswordCard],
  template: `
    <h1 class="page-title">Account</h1>
    <div class="layout">
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
  `,
})
export class Account {
  protected readonly auth = inject(AuthService);
  protected readonly fmt = formatBytes;
}
