import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import type { ReferralKey } from '../../core/models';
import { absoluteUrl, copyText, dateShort } from '../../core/util';

@Component({
  selector: 'app-referrals',
  template: `
    <h1 class="page-title">Referrals</h1>
    <div class="card">
      <div class="row">
        <div>
          <b>{{ quota() - used() }}</b> of {{ quota() }} referrals left
          <div class="muted hint">Each key lets one person create an account. People you invite cannot invite others.</div>
        </div>
        <span class="spacer"></span>
        <button type="button" class="btn primary" (click)="create()" [disabled]="busy() || used() >= quota()">Create referral key</button>
      </div>

      @if (fresh(); as f) {
        <div class="keybox new">
          <div>
            <div class="muted hint">Shown only now. Send the link or the key to the person you invite.</div>
            <code>{{ f.key }}</code>
          </div>
          <span class="spacer"></span>
          <button type="button" class="btn small" (click)="copy(f.key)">Copy key</button>
          <button type="button" class="btn small" (click)="copy(absolute(f.link))">{{ copied() ? 'Copied!' : 'Copy link' }}</button>
        </div>
      }
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
    </div>

    <div class="card list-card">
      <div class="table-wrap">
        <table class="list">
          <thead>
            <tr><th>Key</th><th>Status</th><th>Expires</th><th>Used by</th><th></th></tr>
          </thead>
          <tbody>
            @for (k of keys(); track k.id) {
              <tr>
                <td><code>••••-••••-••••-{{ k.hint }}</code></td>
                <td>
                  <span class="badge" [class.good]="k.status === 'used'" [class.warn]="k.status === 'unused'" [class.bad]="k.status === 'revoked' || k.status === 'expired'">{{ k.status }}</span>
                </td>
                <td class="muted">{{ k.status === 'unused' ? dateShort(k.expiresAt) : '' }}</td>
                <td>{{ k.usedBy ?? '' }}</td>
                <td class="right">
                  @if (k.status === 'unused') {
                    <button type="button" class="btn small" (click)="revoke(k)">Revoke</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="muted">You haven't created any referral keys yet.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: `
    .hint {
      font-size: 0.85rem;
      margin-top: 0.2rem;
    }
    .new {
      margin-top: 1rem;
    }
    .list-card {
      margin-top: 1rem;
    }
    .right {
      text-align: right;
    }
  `,
})
export class Referrals implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly quota = signal(0);
  protected readonly used = signal(0);
  protected readonly keys = signal<ReferralKey[]>([]);
  protected readonly fresh = signal<{ key: string; link: string } | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected readonly dateShort = dateShort;
  protected readonly absolute = absoluteUrl;

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const r = await this.api.get<{ quota: number; used: number; keys: ReferralKey[] }>('/api/me/referrals');
      this.quota.set(r.quota);
      this.used.set(r.used);
      this.keys.set(r.keys);
    } catch (e: any) {
      this.error.set(e.message);
    }
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.fresh.set(await this.api.post('/api/me/referrals'));
      await this.load();
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async revoke(k: ReferralKey): Promise<void> {
    this.error.set(null);
    try {
      await this.api.delete(`/api/me/referrals/${k.id}`);
      await this.load();
    } catch (e: any) {
      this.error.set(e.message);
    }
  }

  protected async copy(text: string): Promise<void> {
    if (await copyText(text)) {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    }
  }
}
