import { Injectable, Pipe, PipeTransform, inject, signal } from '@angular/core';
import { PT } from './i18n-pt';

export type Lang = 'en' | 'pt';
const KEY = 'lang';

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'en' || stored === 'pt') return stored;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

/**
 * Translations use the English text as the key: `t('Sign in')`. Text that has no Portuguese entry shows in English.
 * Placeholders look like `{name}` and are filled from `params`.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly lang = signal<Lang>(initialLang());

  constructor() {
    this.apply(this.lang());
  }

  set(lang: Lang): void {
    this.lang.set(lang);
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      /* storage unavailable */
    }
    this.apply(lang);
  }

  private apply(lang: Lang): void {
    if (typeof document !== 'undefined') document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  }

  /** Room title: a room named after its owner reads "X's room" / "Sala de X" in the current language. */
  roomName(room: { name: string; ownerName?: string | null; autoName?: boolean }): string {
    return room.autoName && room.ownerName ? this.t("{name}'s room", { name: room.ownerName }) : room.name;
  }

  t(text: string, params?: Record<string, string | number>): string {
    let out = this.lang() === 'pt' ? (PT[text] ?? text) : text;
    if (params) for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v));
    return out;
  }
}

/** `{{ 'Sign in' | t }}` or `{{ 'Hello {name}' | t: { name: user } }}` */
@Pipe({ name: 't', pure: false })
export class TPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  transform(text: string, params?: Record<string, string | number>): string {
    return this.i18n.t(text, params);
  }
}
