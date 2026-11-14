import { Injectable, signal } from '@angular/core';
import { toast } from './toast';

export type SoundEvent = 'streamStart' | 'streamStop' | 'viewerJoin' | 'viewerLeave';

export const SOUND_EVENTS: { key: SoundEvent; label: string; hint: string }[] = [
  { key: 'streamStart', label: 'You start streaming', hint: 'Plays when your stream goes live.' },
  { key: 'streamStop', label: 'Your stream stops', hint: 'Plays when your stream ends, however it ends.' },
  { key: 'viewerJoin', label: 'Someone joins your stream', hint: 'Plays when the viewer count goes up.' },
  { key: 'viewerLeave', label: 'Someone leaves your stream', hint: 'Plays when the viewer count goes down.' },
];

/** What the toast says when an event plays its sound. */
const SOUND_TOASTS: Record<SoundEvent, string> = {
  streamStart: 'Your stream is live',
  streamStop: 'Your stream stopped',
  viewerJoin: 'Someone joined your stream',
  viewerLeave: 'Someone left your stream',
};

interface Stored {
  muted: boolean;
  volume: number;
  enabled: Record<SoundEvent, boolean>;
}

const KEY = 'soundSettings';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SECONDS = 15;

const DEFAULTS = (): Stored => ({
  muted: false,
  volume: 0.7,
  enabled: { streamStart: true, streamStop: true, viewerJoin: true, viewerLeave: true },
});

/** Notes of the built-in sounds: [frequency Hz, start s, length s]. Short and soft on purpose. */
const BUILT_IN: Record<SoundEvent, [number, number, number][]> = {
  streamStart: [[523.25, 0, 0.14], [783.99, 0.12, 0.26]],
  streamStop: [[783.99, 0, 0.14], [523.25, 0.12, 0.3]],
  viewerJoin: [[880, 0, 0.09], [1174.66, 0.08, 0.14]],
  viewerLeave: [[659.25, 0, 0.09], [493.88, 0.08, 0.16]],
};

// ---- custom files live in this browser's IndexedDB; they are never sent to the server ----
const DB_NAME = 'streaming-sounds';
const STORE = 'sounds';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbRun<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

interface CustomFile {
  blob: Blob;
  name: string;
}

/**
 * Feedback sounds for the streamer: built-in tones (generated with Web Audio, no files) that can be replaced by the
 * person's own audio files. Settings are in localStorage and the files in IndexedDB: nothing leaves the browser.
 */
@Injectable({ providedIn: 'root' })
export class SoundService {
  readonly muted = signal(false);
  readonly volume = signal(0.7);
  readonly enabled = signal<Record<SoundEvent, boolean>>(DEFAULTS().enabled);
  /** File name of the custom sound of each event (null = the built-in one). */
  readonly customNames = signal<Record<SoundEvent, string | null>>({ streamStart: null, streamStop: null, viewerJoin: null, viewerLeave: null });
  readonly error = signal<string | null>(null);

  private readonly files = new Map<SoundEvent, CustomFile>();
  private ctx?: AudioContext;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = { ...DEFAULTS(), ...(JSON.parse(raw) as Partial<Stored>) };
        this.muted.set(!!s.muted);
        this.volume.set(Math.min(1, Math.max(0, Number(s.volume) || 0)));
        this.enabled.set({ ...DEFAULTS().enabled, ...s.enabled });
      }
    } catch {
      /* corrupt or unavailable storage: defaults */
    }
    void this.loadCustom();
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ muted: this.muted(), volume: this.volume(), enabled: this.enabled() } satisfies Stored));
    } catch {
      /* storage unavailable: the choice just won't survive a reload */
    }
  }

  private async loadCustom(): Promise<void> {
    try {
      const names = { ...this.customNames() };
      for (const e of SOUND_EVENTS) {
        const f = await dbRun<CustomFile | undefined>('readonly', (s) => s.get(e.key));
        if (f?.blob) {
          this.files.set(e.key, f);
          names[e.key] = f.name;
        }
      }
      this.customNames.set(names);
    } catch {
      /* IndexedDB unavailable (private window): only the built-in sounds */
    }
  }

  toggleMuted(): void {
    this.muted.update((m) => !m);
    this.persist();
    if (!this.muted()) this.preview('streamStart'); // a small confirmation that sounds are back
  }

  setVolume(v: number): void {
    this.volume.set(Math.min(1, Math.max(0, v)));
    this.persist();
  }

  setEnabled(event: SoundEvent, on: boolean): void {
    this.enabled.update((e) => ({ ...e, [event]: on }));
    this.persist();
  }

  /** Plays the sound of an event, unless sounds are muted or that event is switched off. */
  play(event: SoundEvent): void {
    if (this.muted() || !this.enabled()[event]) return;
    this.preview(event);
    toast(SOUND_TOASTS[event]); // so the sound always comes with its reason on screen
  }

  /** Plays regardless of the mute switch (the "Test" buttons); still respects the volume. */
  preview(event: SoundEvent): void {
    const vol = this.volume();
    if (vol <= 0) return;
    const file = this.files.get(event);
    if (file) {
      const url = URL.createObjectURL(file.blob);
      const audio = new Audio(url);
      audio.volume = vol;
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => URL.revokeObjectURL(url);
      audio.play().catch(() => URL.revokeObjectURL(url));
      return;
    }
    this.synth(event, vol);
  }

  private synth(event: SoundEvent, vol: number): void {
    try {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      if (ctx.state === 'suspended') void ctx.resume();
      const t0 = ctx.currentTime + 0.02;
      for (const [freq, start, len] of BUILT_IN[event]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + start);
        gain.gain.exponentialRampToValueAtTime(0.35 * vol, t0 + start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + len);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0 + start);
        osc.stop(t0 + start + len + 0.02);
      }
    } catch {
      /* no audio output available */
    }
  }

  /** Stores a chosen audio file for an event (in this browser only). Returns false and sets `error` if it is not usable. */
  async setCustom(event: SoundEvent, file: File): Promise<boolean> {
    this.error.set(null);
    if (!file.type.startsWith('audio/')) return this.fail('That file is not an audio file.');
    if (file.size > MAX_BYTES) return this.fail('The file is too big (2 MB at most).');
    const seconds = await this.durationOf(file);
    if (seconds === null) return this.fail('This browser cannot play that file.');
    if (seconds > MAX_SECONDS) return this.fail('The sound is too long (15 seconds at most).');
    try {
      const entry: CustomFile = { blob: file, name: file.name };
      await dbRun('readwrite', (s) => s.put(entry, event));
      this.files.set(event, entry);
      this.customNames.update((n) => ({ ...n, [event]: file.name }));
      return true;
    } catch {
      return this.fail('This browser could not store the file (private window?).');
    }
  }

  async clearCustom(event: SoundEvent): Promise<void> {
    this.files.delete(event);
    this.customNames.update((n) => ({ ...n, [event]: null }));
    try {
      await dbRun('readwrite', (s) => s.delete(event));
    } catch {
      /* nothing stored anyway */
    }
  }

  private fail(message: string): false {
    this.error.set(message);
    return false;
  }

  private durationOf(file: Blob): Promise<number | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const a = new Audio();
      const done = (v: number | null) => {
        URL.revokeObjectURL(url);
        resolve(v);
      };
      const timer = setTimeout(() => done(null), 4000);
      a.onloadedmetadata = () => {
        clearTimeout(timer);
        done(Number.isFinite(a.duration) ? a.duration : MAX_SECONDS);
      };
      a.onerror = () => {
        clearTimeout(timer);
        done(null);
      };
      a.src = url;
    });
  }
}
