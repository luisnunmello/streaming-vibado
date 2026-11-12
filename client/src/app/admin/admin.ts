import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { StreamerService } from '../core/streamer.service';
import { PasswordCard } from './password-card';
import { StreamerPanel } from './streamer-panel';

@Component({
  selector: 'app-admin',
  imports: [FormsModule, RouterLink, StreamerPanel, PasswordCard],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class Admin implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly streamer = inject(StreamerService);

  protected readonly checking = signal(true);
  protected readonly loggedIn = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected password = '';

  async ngOnInit(): Promise<void> {
    if (await this.auth.validate()) this.enter();
    this.checking.set(false);
  }

  ngOnDestroy(): void {
    this.streamer.disconnectAdmin();
  }

  private enter(): void {
    this.loggedIn.set(true);
    this.streamer.connectAdmin(() => {
      this.auth.expire();
      this.loggedIn.set(false);
      this.error.set('Your session ended (the password was changed from another session). Please sign in again.');
    });
  }

  protected async login(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.password);
      this.password = '';
      this.enter();
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async logout(): Promise<void> {
    this.streamer.disconnectAdmin();
    await this.auth.logout();
    this.loggedIn.set(false);
  }
}
