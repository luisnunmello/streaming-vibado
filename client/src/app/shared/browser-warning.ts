import { Component } from '@angular/core';
import { TPipe } from '../core/i18n.service';

/** True in Chrome, Edge, Brave, Opera, Vivaldi and other Chromium browsers. */
export function isChromium(): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands;
  if (brands?.length) return brands.some((b) => /chromium/i.test(b.brand));
  return /\b(Chrome|Chromium|CriOS|Edg)\//.test(navigator.userAgent) && !/Firefox|FxiOS/.test(navigator.userAgent);
}

/** Warns people who are about to share their screen from a browser that does it poorly. */
@Component({
  selector: 'app-browser-warning',
  imports: [TPipe],
  template: `
    @if (!chromium) {
      <div class="warn" role="alert">
        <b>{{ 'Screen sharing works best in a Chromium browser.' | t }}</b>
        {{ 'Chrome, Edge, Brave or Opera are recommended. Other browsers, such as Firefox, have many limitations: no audio capture, no window-only audio, and some options do not work.' | t }}
      </div>
    }
  `,
  styles: `
    .warn {
      margin-bottom: 1rem;
      padding: 0.7rem 1rem;
      border-radius: 10px;
      border: 1px solid var(--warn);
      background: rgba(253, 176, 34, 0.12);
      color: var(--warn);
      font-size: 0.92rem;
      b {
        display: block;
        margin-bottom: 0.15rem;
      }
    }
  `,
})
export class BrowserWarning {
  protected readonly chromium = isChromium();
}
