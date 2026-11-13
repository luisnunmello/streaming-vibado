import { Component, inject } from '@angular/core';
import { TPipe } from '../core/i18n.service';
import { SOUND_EVENTS, SoundService, type SoundEvent } from '../core/sound.service';

/** Per-event switches, test buttons and custom files for the feedback sounds. Files never leave this browser. */
@Component({
  selector: 'app-sound-settings',
  imports: [TPipe],
  template: `
    <p class="muted note">{{ 'Custom sounds stay in this browser only: they are never uploaded to the server.' | t }}</p>

    <label class="check">
      <input type="checkbox" [checked]="!sound.muted()" (change)="sound.toggleMuted()" />
      {{ 'Sounds on' | t }}
    </label>

    <div class="field">
      <label for="snd-vol">{{ 'Volume' | t }} <b>{{ (sound.volume() * 100).toFixed(0) }}%</b></label>
      <input id="snd-vol" type="range" min="0" max="1" step="0.05" [value]="sound.volume()" (input)="sound.setVolume(+$any($event.target).value)" />
    </div>

    @for (e of events; track e.key) {
      <div class="event">
        <label class="check">
          <input type="checkbox" [checked]="sound.enabled()[e.key]" (change)="sound.setEnabled(e.key, $any($event.target).checked)" />
          <span>
            <b>{{ e.label | t }}</b>
            <small>{{ e.hint | t }}</small>
          </span>
        </label>
        <div class="actions">
          <span class="muted file">{{ sound.customNames()[e.key] ?? ('Built-in sound' | t) }}</span>
          <button type="button" class="btn small" (click)="sound.preview(e.key)">{{ 'Test' | t }}</button>
          <button type="button" class="btn small" (click)="picker.click()">{{ 'Choose file…' | t }}</button>
          @if (sound.customNames()[e.key]) {
            <button type="button" class="btn small" (click)="sound.clearCustom(e.key)">{{ 'Use built-in' | t }}</button>
          }
          <input #picker type="file" accept="audio/*" hidden (change)="choose(e.key, $any($event.target))" />
        </div>
      </div>
    }

    @if (sound.error()) {
      <p class="error">{{ sound.error() | t }}</p>
    }
  `,
  styles: `
    .note {
      margin: 0 0 0.8rem;
      font-size: 0.85rem;
    }
    .event {
      display: grid;
      gap: 0.4rem;
      padding: 0.6rem 0;
      border-top: 1px solid var(--line);
      small {
        display: block;
        color: var(--muted);
        font-weight: 400;
      }
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem;
      margin-left: 1.7rem;
    }
    .file {
      flex: 1 1 100%;
      font-size: 0.82rem;
      overflow-wrap: anywhere;
    }
  `,
})
export class SoundSettings {
  protected readonly sound = inject(SoundService);
  protected readonly events = SOUND_EVENTS;

  protected async choose(event: SoundEvent, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (await this.sound.setCustom(event, file)) this.sound.preview(event);
  }
}
