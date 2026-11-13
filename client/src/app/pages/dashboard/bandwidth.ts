import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { DialogService } from '../../core/dialog.service';
import { RouterLink } from '@angular/router';
import type { BandwidthView, GlobalSettings } from '../../core/models';

@Component({
  selector: 'app-bandwidth',
  imports: [FormsModule, RouterLink],
  template: `
    <h1 class="page-title">Bandwidth</h1>

    @if (view(); as v) {
      <div class="card meters">
        <h2>Live traffic</h2>

        <div class="meter">
          <div class="label"><span>Upload to viewers</span><b>{{ v.egress.total }} / {{ v.budget.egressMbps }} Mbps</b></div>
          <div class="bar" [class.hot]="pct(v.egress.total, v.budget.egressMbps) > 80">
            <i class="admin" [style.width.%]="pct(v.egress.admin, v.budget.egressMbps)"></i>
            <i class="user" [style.width.%]="pct(v.egress.user, v.budget.egressMbps)"></i>
            <u [style.left.%]="pct(v.budget.userEgressMbps, v.budget.egressMbps)" title="Users cannot go beyond this mark"></u>
          </div>
          <div class="legend"><span class="admin">Admin {{ v.egress.admin }}</span><span class="user">Users {{ v.egress.user }}</span><span class="muted">| = limit for users ({{ v.budget.userEgressMbps }} Mbps)</span></div>
        </div>

        <div class="meter">
          <div class="label"><span>Download from streamers</span><b>{{ v.ingress.total }} / {{ v.budget.ingressMbps }} Mbps</b></div>
          <div class="bar" [class.hot]="pct(v.ingress.total, v.budget.ingressMbps) > 80">
            <i class="admin" [style.width.%]="pct(v.ingress.admin, v.budget.ingressMbps)"></i>
            <i class="user" [style.width.%]="pct(v.ingress.user, v.budget.ingressMbps)"></i>
          </div>
        </div>

        @if (pct(v.egress.total, v.budget.egressMbps) > 80) {
          <p class="notice">Upload is above 80% of the budget. New viewers may be refused and user viewers moved to lower quality.</p>
        }
        @if (v.layerCap < 2) {
          <p class="notice">Under pressure: user viewers are capped at quality level {{ v.layerCap === 0 ? 'low' : 'medium' }} (only for streams with adaptive quality).</p>
        }

        <div class="row kill">
          @if (v.userStreamsPaused) {
            <span class="badge bad">User streaming is paused</span>
            <button type="button" class="btn small primary" (click)="setPaused(false)">Resume user streaming</button>
          } @else {
            <button type="button" class="btn small danger" (click)="setPaused(true)">Pause all user streams</button>
            <span class="muted hint">Stops every user stream and blocks new ones until you resume.</span>
          }
        </div>
      </div>

      <div class="card">
        <h2>Active rooms</h2>
        <div class="table-wrap">
          <table class="list">
            <thead><tr><th>Room</th><th>Owner</th><th>Status</th><th>Viewers</th><th>Out</th><th>In</th><th></th></tr></thead>
            <tbody>
              @for (r of v.rooms; track r.id) {
                <tr>
                  <td><b>{{ r.name }}</b></td>
                  <td>{{ r.owner }}</td>
                  <td>@if (r.live) { <span class="badge live">LIVE</span> } @else { <span class="muted">waiting</span> }</td>
                  <td>{{ r.viewers }}</td>
                  <td>{{ r.egressMbps }} Mbps</td>
                  <td>{{ r.ingressMbps }} Mbps</td>
                  <td class="right">@if (r.live) { <button type="button" class="btn small" (click)="stop(r.id)">Stop</button> }</td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="muted">Nothing is streaming right now.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }

    @if (draft(); as s) {
      <div class="card settings">
        <h2>Protection settings</h2>
        <div class="cols">
          <div class="field">
            <label for="eg">Upload budget (Mbps)</label>
            <input id="eg" type="number" min="1" [value]="s.egressBudgetMbps" (input)="patch({ egressBudgetMbps: +$any($event.target).value })" />
            <span class="hint">Keep it below your real uplink (about 70%).</span>
          </div>
          <div class="field">
            <label for="in">Download budget (Mbps)</label>
            <input id="in" type="number" min="1" [value]="s.ingressBudgetMbps" (input)="patch({ ingressBudgetMbps: +$any($event.target).value })" />
          </div>
          <div class="field">
            <label for="rs">Kept for the admin (%)</label>
            <input id="rs" type="number" min="0" max="90" [value]="s.adminReservePct" (input)="patch({ adminReservePct: +$any($event.target).value })" />
            <span class="hint">Users can never use this share of the upload budget.</span>
          </div>
          <div class="field">
            <label for="id">Stop user streams with no viewers after (min)</label>
            <input id="id" type="number" min="0" [value]="s.idleStopMinutes" (input)="patch({ idleStopMinutes: +$any($event.target).value })" />
            <span class="hint">0 = never.</span>
          </div>
          <div class="field">
            <label for="ip">Viewer connections per IP</label>
            <input id="ip" type="number" min="0" [value]="s.maxConnectionsPerIp" (input)="patch({ maxConnectionsPerIp: +$any($event.target).value })" />
            <span class="hint">0 = unlimited.</span>
          </div>
          <div class="field">
            <label for="anon">Streams watched at once (not signed in)</label>
            <input id="anon" type="number" min="0" [value]="s.anonymousMaxWatching" (input)="patch({ anonymousMaxWatching: +$any($event.target).value })" />
            <span class="hint">Counted per IP address, so people sharing a connection share it. 0 = unlimited.</span>
          </div>
        </div>

        <p class="muted hint presets-note">
          What each user may do (bitrate, viewers, rooms…) is set with <a routerLink="/dashboard/presets">limit presets</a>.
        </p>

        <div class="row save">
          <button type="button" class="btn primary" (click)="save()" [disabled]="!dirty()">Save settings</button>
          @if (saved()) {
            <span class="ok">Saved.</span>
          }
          @if (error()) {
            <span class="error">{{ error() }}</span>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .card {
      margin-bottom: 1rem;
    }
    .meter {
      margin-bottom: 1.1rem;
    }
    .label {
      display: flex;
      justify-content: space-between;
      font-size: 0.9rem;
      margin-bottom: 0.4rem;
    }
    .bar {
      position: relative;
      display: flex;
      height: 14px;
      border-radius: 7px;
      background: var(--bg);
      border: 1px solid var(--line);
      overflow: hidden;
      i {
        display: block;
        height: 100%;
        transition: width 0.4s;
      }
      i.admin {
        background: var(--accent);
      }
      i.user {
        background: var(--good);
      }
      u {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background: var(--warn);
      }
      &.hot {
        border-color: var(--warn);
      }
    }
    .legend {
      display: flex;
      gap: 1rem;
      font-size: 0.8rem;
      margin-top: 0.35rem;
      .admin {
        color: var(--accent);
      }
      .user {
        color: var(--good);
      }
    }
    .kill {
      margin-top: 1rem;
    }
    .hint {
      font-size: 0.82rem;
    }
    .right {
      text-align: right;
    }
    .presets-note {
      margin: 1.2rem 0 0;
    }
    .save {
      margin-top: 1.2rem;
    }
  `,
})
export class Bandwidth implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(DialogService);
  protected readonly view = signal<BandwidthView | null>(null);
  protected readonly draft = signal<GlobalSettings | null>(null);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);
  private original = '';
  private timer?: ReturnType<typeof setInterval>;
  protected readonly dirty = computed(() => !!this.draft() && JSON.stringify(this.draft()) !== this.original);

  async ngOnInit(): Promise<void> {
    await this.refresh();
    try {
      const { settings } = await this.api.get<{ settings: GlobalSettings }>('/api/admin/settings');
      this.original = JSON.stringify(settings);
      this.draft.set(settings);
    } catch (e: any) {
      this.error.set(e.message);
    }
    this.timer = setInterval(() => void this.refresh(), 2000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected pct(value: number, of: number): number {
    return of > 0 ? Math.min(100, (value / of) * 100) : 0;
  }

  private async refresh(): Promise<void> {
    try {
      this.view.set(await this.api.get<BandwidthView>('/api/admin/bandwidth'));
    } catch {
      /* transient */
    }
  }

  protected patch(values: Partial<GlobalSettings>): void {
    this.saved.set(false);
    this.draft.update((s) => (s ? { ...s, ...values } : s));
  }

  protected async save(): Promise<void> {
    this.error.set(null);
    try {
      const { settings } = await this.api.put<{ settings: GlobalSettings }>('/api/admin/settings', this.draft());
      this.original = JSON.stringify(settings);
      this.draft.set(settings);
      this.saved.set(true);
      await this.refresh();
    } catch (e: any) {
      this.error.set(e.message);
    }
  }

  protected async setPaused(paused: boolean): Promise<void> {
    if (paused && !(await this.dialog.confirm('Stop every user stream and block new ones until you resume?', { title: 'Pause user streams', confirmLabel: 'Stop and block', danger: true }))) return;
    try {
      await this.api.put('/api/admin/settings', { userStreamsPaused: paused });
      await this.refresh();
    } catch (e: any) {
      this.error.set(e.message);
    }
  }

  protected async stop(roomId: string): Promise<void> {
    try {
      await this.api.post(`/api/rooms/${roomId}/stop`);
      await this.refresh();
    } catch (e: any) {
      this.error.set(e.message);
    }
  }
}
