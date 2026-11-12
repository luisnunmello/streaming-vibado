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
  { value: 'h264', label: 'H.264', hint: 'Usually hardware encoded: lowest CPU use' },
  { value: 'vp8', label: 'VP8', hint: 'Software encoded, very compatible' },
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
}

const KEY = 'streamSettings';

export function loadSettings(): StreamSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: StreamSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
