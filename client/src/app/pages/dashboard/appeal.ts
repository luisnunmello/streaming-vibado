import { Component, inject, signal } from '@angular/core';
import { TPipe } from '../../core/i18n.service';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

/** Shown to a restricted user: write an appeal and see the administrator's answer. */
@Component({
  selector: 'app-appeal',
  imports: [FormsModule, TPipe],
  template: `
    @if (auth.me(); as me) {
      <div class="card">
        <h2>{{ 'Appeal the restriction' | t }}</h2>
        @if (me.appealStatus === 'pending') {
          <p class="muted">{{ 'Your appeal was sent and is waiting for the administrator.' | t }}</p>
          <blockquote>{{ me.appealText }}</blockquote>
        } @else {
          @if (me.appealStatus === 'denied') {
            <p class="denied"><b>{{ 'Your last appeal was denied.' | t }}</b>@if (me.appealReply) { {{ 'Reply:' | t }} {{ me.appealReply }} }</p>
          }
          <form (ngSubmit)="send()">
            <div class="field">
              <label for="appeal">{{ 'Why should the restriction be lifted?' | t }}</label>
              <textarea id="appeal" name="appeal" rows="4" maxlength="1000" [(ngModel)]="text" required></textarea>
            </div>
            <button class="btn primary" type="submit" [disabled]="busy() || text.trim().length < 5">{{ 'Send appeal' | t }}</button>
            @if (error()) {
              <p class="error msg">{{ error() | t }}</p>
            }
          </form>
        }
      </div>
    }
  `,
  styles: `
    blockquote {
      margin: 0.6rem 0 0;
      padding: 0.6rem 0.8rem;
      border-left: 3px solid var(--accent);
      background: var(--bg);
      white-space: pre-wrap;
    }
    .denied {
      color: #ffb4ad;
      margin: 0 0 0.8rem;
    }
    textarea {
      width: 100%;
    }
    .msg {
      margin: 0.8rem 0 0;
    }
  `,
})
export class Appeal {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  protected text = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async send(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.post('/api/me/appeal', { text: this.text.trim() });
      this.text = '';
      await this.auth.refresh();
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }
}
