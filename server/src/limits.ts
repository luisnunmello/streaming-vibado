import { HttpError } from './errors.js';

/** What a user account is allowed to do. Enforced on the server. */
export interface Limits {
  maxRooms: number;
  /** Rooms that may be live at the same time. */
  maxStreams: number;
  maxBitrateMbps: number;
  maxHeight: number;
  maxFps: number;
  maxViewersPerRoom: number;
  /** Streams this account may watch at the same time; starting another ends the one used least recently. */
  maxWatching: number;
  /** Longest temporary invite (minutes) this user may create; 0 = may not create them. */
  maxTempInviteMinutes: number;
  /** 0 = unlimited. */
  maxStreamMinutes: number;
  allowPublicRooms: boolean;
  allowAudio: boolean;
  /** Traffic delivered to viewers per calendar month, in GB. 0 = unlimited. */
  monthlyGb: number;
}

export const FALLBACK_LIMITS: Limits = {
  maxRooms: 3,
  maxStreams: 1,
  maxBitrateMbps: 3,
  maxHeight: 720,
  maxFps: 30,
  maxViewersPerRoom: 10,
  maxWatching: 1,
  maxTempInviteMinutes: 0,
  maxStreamMinutes: 120,
  allowPublicRooms: true,
  allowAudio: true,
  monthlyGb: 0,
};

type NumericKey = Exclude<keyof Limits, 'allowPublicRooms' | 'allowAudio'>;
const RANGES: Record<NumericKey, [number, number]> = {
  maxRooms: [0, 100],
  maxStreams: [0, 10],
  maxBitrateMbps: [0.5, 100],
  maxHeight: [240, 2160],
  maxFps: [5, 120],
  maxViewersPerRoom: [0, 100_000],
  maxWatching: [1, 20],
  maxTempInviteMinutes: [0, 1440],
  maxStreamMinutes: [0, 1440],
  monthlyGb: [0, 1_000_000],
};
const BOOLEANS: (keyof Limits)[] = ['allowPublicRooms', 'allowAudio'];

/** Applies `input` over `base`, rejecting out-of-range values. */
export function sanitizeLimits(input: unknown, base: Limits): Limits {
  const out: Limits = { ...base };
  if (input === undefined || input === null) return out;
  if (typeof input !== 'object') throw new HttpError(400, 'Invalid limits');
  const src = input as Record<string, unknown>;
  for (const [key, [min, max]] of Object.entries(RANGES) as [NumericKey, [number, number]][]) {
    if (src[key] === undefined) continue;
    const n = Number(src[key]);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${key} must be between ${min} and ${max}`);
    out[key] = n;
  }
  for (const key of BOOLEANS) {
    if (src[key] === undefined) continue;
    if (typeof src[key] !== 'boolean') throw new HttpError(400, `${key} must be true or false`);
    (out as unknown as Record<string, boolean>)[key] = src[key] as boolean;
  }
  return out;
}

/** Stored JSON may predate newly added limits: fill the gaps from the fallback. */
export function parseStoredLimits(json: string): Limits {
  try {
    return { ...FALLBACK_LIMITS, ...JSON.parse(json) };
  } catch {
    return { ...FALLBACK_LIMITS };
  }
}

const unlimited = (n: number) => (n === 0 ? Infinity : n);
const back = (n: number) => (n === Infinity ? 0 : n);

/** Invited users can never get more than the user who invited them. */
export function clampToParent(child: Limits, parent: Limits): Limits {
  return {
    maxRooms: Math.min(child.maxRooms, parent.maxRooms),
    maxStreams: Math.min(child.maxStreams, parent.maxStreams),
    maxBitrateMbps: Math.min(child.maxBitrateMbps, parent.maxBitrateMbps),
    maxHeight: Math.min(child.maxHeight, parent.maxHeight),
    maxFps: Math.min(child.maxFps, parent.maxFps),
    maxViewersPerRoom: Math.min(child.maxViewersPerRoom, parent.maxViewersPerRoom),
    maxWatching: Math.min(child.maxWatching, parent.maxWatching),
    maxTempInviteMinutes: Math.min(child.maxTempInviteMinutes, parent.maxTempInviteMinutes),
    maxStreamMinutes: back(Math.min(unlimited(child.maxStreamMinutes), unlimited(parent.maxStreamMinutes))),
    allowPublicRooms: child.allowPublicRooms && parent.allowPublicRooms,
    allowAudio: child.allowAudio && parent.allowAudio,
    monthlyGb: back(Math.min(unlimited(child.monthlyGb), unlimited(parent.monthlyGb))),
  };
}
