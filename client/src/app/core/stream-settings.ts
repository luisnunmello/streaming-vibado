import type { Limits } from './models';

export type Codec = 'h264' | 'vp8' | 'vp9' | 'av1';
export type Priority = 'motion' | 'balanced' | 'detail';
export type AudioMode = 'none' | 'system' | 'window';

export interface StreamSettings {
  // --- can be changed while live ---
  bitrateMbps: number;
  fps: number;
  /** Output height in pixels; 0 = same as the captured source. */
  height: number;
  priority: Priority;
  muted: boolean;
  screenAudioGain: number;
  deviceGain: number;
  // --- applied when the stream starts ---
  codec: Codec;
  audioMode: AudioMode;
  /** Extra audio input (microphone or virtual cable) mixed into the stream; '' = none. */
  audioDeviceId: string;
  /** Send several quality levels so the server can lower quality for viewers instead of refusing them. */
  adaptive: boolean;
}

export const DEFAULT_SETTINGS: StreamSettings = {
  bitrateMbps: 10,
  fps: 60,
  height: 1080,
  priority: 'motion',
  muted: false,
  screenAudioGain: 1,
  deviceGain: 1,
  codec: 'h264',
  audioMode: 'system',
  audioDeviceId: '',
  adaptive: false,
};

export interface Preset {
  label: string;
  hint: string;
  values: Partial<StreamSettings>;
}

export const PRESETS: Preset[] = [
  { label: 'Gaming 1080p60', hint: 'Fast motion, ~10 Mbps', values: { height: 1080, fps: 60, bitrateMbps: 10, priority: 'motion' } },
  { label: 'Gaming 1440p60', hint: 'Fast motion, ~16 Mbps', values: { height: 1440, fps: 60, bitrateMbps: 16, priority: 'motion' } },
  { label: 'Desktop / text', hint: 'Sharp text, ~5 Mbps', values: { height: 1080, fps: 30, bitrateMbps: 5, priority: 'detail' } },
  { label: 'Low bandwidth', hint: '720p30, ~3 Mbps', values: { height: 720, fps: 30, bitrateMbps: 3, priority: 'balanced' } },
];

export const RESOLUTIONS = [
  { value: 0, label: 'Source' },
  { value: 1440, label: '1440p' },
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p' },
  { value: 480, label: '480p' },
];

export const CODECS: { value: Codec; label: string; hint: string }[] = [
  { value: 'h264', label: 'H.264', hint: 'Usually hardware encoded: lowest CPU use. If a viewer cannot play it, use VP8.' },
  { value: 'vp8', label: 'VP8', hint: 'Plays in every browser. Software encoded, so heavier on CPU than H.264.' },
  { value: 'vp9', label: 'VP9', hint: 'Better quality per Mbps, heavier on CPU' },
  { value: 'av1', label: 'AV1', hint: 'Best quality per Mbps, heaviest on CPU' },
];

export interface StreamStats {
  bitrateKbps: number;
  fps: number;
  width: number;
  height: number;
  /** Why the encoder is lowering quality, if it is. */
  limitation: 'none' | 'cpu' | 'bandwidth' | 'other';
  encodeMs: number;
  rttMs: number | null;
  lossPct: number;
  availableKbps: number | null;
  /** How many quality levels are being encoded. */
  layers: number;
}

const KEY = 'streamSettings';

export function loadSettings(defaults: Partial<StreamSettings> = {}): StreamSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS, ...defaults };
  }
}

/** Brings settings inside a user's limits (the server enforces them too). */
export function clampSettings(s: StreamSettings, limits: Limits | null): StreamSettings {
  if (!limits) return s;
  return {
    ...s,
    bitrateMbps: Math.min(s.bitrateMbps, limits.maxBitrateMbps),
    fps: Math.min(s.fps, limits.maxFps),
    height: s.height === 0 || s.height > limits.maxHeight ? limits.maxHeight : s.height,
    audioMode: limits.allowAudio ? s.audioMode : 'none',
    audioDeviceId: limits.allowAudio ? s.audioDeviceId : '',
  };
}

export function fpsOptions(limits: Limits | null): number[] {
  const base = [30, 60, 120];
  if (!limits) return base;
  const opts = base.filter((f) => f <= limits.maxFps);
  if (!opts.includes(limits.maxFps)) opts.push(limits.maxFps);
  return opts.sort((a, b) => a - b);
}

export function resolutionOptions(limits: Limits | null): { value: number; label: string }[] {
  if (!limits) return RESOLUTIONS;
  const opts = RESOLUTIONS.filter((r) => r.value !== 0 && r.value <= limits.maxHeight);
  if (!opts.some((r) => r.value === limits.maxHeight)) opts.unshift({ value: limits.maxHeight, label: limits.maxHeight + 'p' });
  return opts;
}

/** Presets as this account can use them: values above the limits collapse into the same result, so each result is listed once. */
export function distinctPresets(limits: Limits | null): Preset[] {
  if (!limits) return PRESETS;
  const seen = new Set<string>();
  return PRESETS.filter((p) => {
    const c = clampSettings({ ...DEFAULT_SETTINGS, ...p.values }, limits);
    const id = [c.height, c.fps, c.bitrateMbps, c.priority].join();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Is `current` what applying the preset would give? */
export function isPresetActive(p: Preset, current: StreamSettings, limits: Limits | null): boolean {
  const cur = current as unknown as Record<string, unknown>;
  const want = clampSettings({ ...current, ...p.values }, limits) as unknown as Record<string, unknown>;
  return Object.keys(p.values).every((k) => cur[k] === want[k]);
}

export function saveSettings(s: StreamSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
