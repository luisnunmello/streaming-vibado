import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-password-card',
  imports: [FormsModule],
  template: `
    <div class="card">
      <h2>Master password</h2>
      <form (ngSubmit)="submit()" autocomplete="off">
        <div class="field">
          <label for="cur">Current password</label>
          <input id="cur" type="password" name="cur" [(ngModel)]="current" autocomplete="current-password" required />
        </div>
        <div class="field">
          <label for="new">New password <small>(min. 8 characters)</small></label>
          <input id="new" type="password" name="new" [(ngModel)]="next" autocomplete="new-password" required minlength="8" />
        </div>
        <div class="field">
          <label for="rep">Repeat new password</label>
          <input id="rep" type="password" name="rep" [(ngModel)]="repeat" autocomplete="new-password" required />
        </div>
        <button class="btn primary" type="submit" [disabled]="busy() || !current || !next || !repeat">Change password</button>
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        @if (done()) {
          <p class="ok">Password changed. Other admin sessions were signed out.</p>
        }
      </form>
    </div>
  `,
  styles: `
    .ok {
      color: var(--good);
      font-size: 0.9rem;
      margin: 0.5rem 0 0;
    }
    small {
      font-weight: 400;
      opacity: 0.8;
    }
  `,
})
export class PasswordCard {
  private readonly auth = inject(AuthService);
  protected current = '';
  protected next = '';
  protected repeat = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal(false);

  protected async submit(): Promise<void> {
    this.error.set(null);
    this.done.set(false);
    if (this.next.length < 8) return void this.error.set('The new password must have at least 8 characters.');
    if (this.next !== this.repeat) return void this.error.set('The new passwords do not match.');
    this.busy.set(true);
    try {
      await this.auth.changePassword(this.current, this.next);
      this.current = this.next = this.repeat = '';
      this.done.set(true);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }
}
