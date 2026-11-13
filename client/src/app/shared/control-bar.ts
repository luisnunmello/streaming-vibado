import { Component, computed, input } from '@angular/core';
import type { ControlSource } from '../core/stream-controls';

/** Quick streamer controls: change screen, mute, quality presets, stop. */
@Component({
  selector: 'app-control-bar',
  template: `
    @let c = ctl();
    <div class="bar" [class.nowrap]="compact()">
      <button type="button" (click)="c.changeScreen()" [disabled]="c.changing() || c.requested()" title="Share a different screen, window or tab without stopping the stream">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18v12zM8 12l2.5-3 2 2.5L15 9l3 4H8z"/></svg>
        {{ c.changing() ? 'Choosing…' : c.requested() ? (compact() ? 'Waiting…' : 'Waiting for the studio tab…') : compact() ? 'Screen' : 'Change screen' }}
      </button>

      @if (c.hasAudio()) {
        <button type="button" (click)="c.toggleMute()" [class.on]="c.muted()" [attr.aria-pressed]="c.muted()" [attr.aria-label]="c.muted() ? 'Unmute' : 'Mute'" [title]="c.muted() ? 'Unmute audio' : 'Mute audio'">
          @if (c.muted()) {
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>
            @if (!compact()) { Muted }
          } @else {
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12z"/></svg>
            @if (!compact()) { Mute }
          }
        </button>
      }

      @if (c.presets().length > 1 && compact()) {
        <select class="quality" aria-label="Quality" (change)="c.applyPreset(+$any($event.target).value)">
          @if (activeIndex() < 0) {
            <option value="" selected disabled>Quality</option>
          }
          @for (p of c.presets(); track p.label; let i = $index) {
            <option [value]="i" [selected]="i === activeIndex()">{{ p.label }}</option>
          }
        </select>
      } @else if (c.presets().length > 1) {
        <span class="group" role="group" aria-label="Quality">
          @for (p of c.presets(); track p.label; let i = $index) {
            <button type="button" class="chip" [class.on]="p.active" (click)="c.applyPreset(i)">{{ p.label }}</button>
          }
        </span>
      }

      <button type="button" class="stop" (click)="c.stop()">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>
        Stop
      </button>
    </div>
  `,
  styles: `
    .bar {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      padding: 0.4rem;
      border-radius: 12px;
      background: rgba(14, 18, 27, 0.88);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
    .bar.nowrap {
      flex-wrap: nowrap;
    }
    button {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.45rem 0.7rem;
      border: 0;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
      white-space: nowrap;
      &:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.2);
      }
      &:disabled {
        opacity: 0.55;
        cursor: default;
      }
      &.on {
        background: rgba(249, 112, 102, 0.35);
      }
      &.stop {
        background: #b42318;
        &:hover {
          background: #d92d20;
        }
      }
    }
    .group {
      display: inline-flex;
      gap: 2px;
      padding: 2px;
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.35);
    }
    .quality {
      padding: 0.42rem 0.5rem;
      border: 0;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
      max-width: 11rem;
      min-width: 0;
      flex: 0 1 auto;
      option {
        color: #111;
      }
    }
    .chip {
      padding: 0.35rem 0.6rem;
      background: transparent;
      font-size: 0.8rem;
      &.on {
        background: var(--accent-strong, #5b7dff);
        font-weight: 600;
      }
    }
  `,
})
export class ControlBar {
  readonly ctl = input.required<ControlSource>();
  /** One row: the quality presets become a dropdown. */
  readonly compact = input(false);
  protected readonly activeIndex = computed(() => this.ctl().presets().findIndex((p) => p.active));
}
