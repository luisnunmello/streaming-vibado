export interface Limits {
  maxRooms: number;
  maxStreams: number;
  maxBitrateMbps: number;
  maxHeight: number;
  maxFps: number;
  maxViewersPerRoom: number;
  maxWatching: number;
  maxStreamMinutes: number;
  allowPublicRooms: boolean;
  allowAudio: boolean;
  monthlyGb: number;
}

export interface Me {
  role: 'admin' | 'user';
  name: string;
  userId?: number;
  /** null for the admin (no per-account limits). */
  limits: Limits | null;
  referrals?: { quota: number; used: number };
  monthBytes?: number;
  invitedByName?: string | null;
  /** Can sign in but may not use the service. */
  restricted?: boolean;
  restrictedReason?: string;
  appealStatus?: '' | 'pending' | 'denied';
  appealText?: string;
  appealReply?: string;
  /** Admin only: appeals waiting for an answer. */
  pendingAppeals?: number;
}

export interface RoomView {
  id: string;
  slug: string;
  name: string;
  visibility: 'public' | 'private';
  ownerId: number | null;
  ownerName: string;
  createdAt: number;
  live: boolean;
  viewers: number;
  /** Path to share, e.g. /r/my-room or /r/my-room?key=… for private rooms. */
  link: string;
}

export interface LobbyRoom {
  slug: string;
  name: string;
  ownerName: string;
  live: boolean;
  viewers: number;
}

export interface UserView {
  id: number;
  name: string;
  status: 'pending' | 'active' | 'disabled';
  /** What the user may do right now. */
  limits: Limits;
  /** The preset the user follows; null = custom limits. */
  presetId: number | null;
  presetName: string | null;
  referralQuota: number;
  referralsUsed: number;
  invitedById: number | null;
  invitedByName: string | null;
  restricted: boolean;
  restrictedReason: string;
  restrictedById: number | null;
  appealStatus: '' | 'pending' | 'denied';
  appealText: string;
  appealAt: number | null;
  createdAt: number;
  activatedAt: number | null;
  lastSeen: number | null;
  rooms: number;
  liveRooms: number;
  monthBytes: number;
}

export interface ReferralKey {
  id: number;
  hint: string;
  status: 'unused' | 'used' | 'expired' | 'revoked';
  createdAt: number;
  expiresAt: number;
  usedBy: string | null;
}

export interface GlobalSettings {
  egressBudgetMbps: number;
  ingressBudgetMbps: number;
  adminReservePct: number;
  idleStopMinutes: number;
  maxConnectionsPerIp: number;
  anonymousMaxWatching: number;
  userStreamsPaused: boolean;
}

export interface Preset {
  id: number;
  name: string;
  limits: Limits;
  isDefault: boolean;
  createdAt: number;
  userCount: number;
}

/** One-line description of a set of limits. */
export function describeLimits(l: Limits): string {
  const parts = [`${l.maxHeight}p${l.maxFps}`, `${l.maxBitrateMbps} Mbps`, `${l.maxViewersPerRoom} viewers`, `${l.maxRooms} room${l.maxRooms === 1 ? '' : 's'}`];
  if (l.maxStreamMinutes) parts.push(`${l.maxStreamMinutes} min`);
  if (l.monthlyGb) parts.push(`${l.monthlyGb} GB/month`);
  if (!l.allowAudio) parts.push('no audio');
  if (!l.allowPublicRooms) parts.push('no public rooms');
  return parts.join(' · ');
}

export interface BandwidthView {
  egress: { user: number; admin: number; total: number };
  ingress: { user: number; admin: number; total: number };
  budget: { egressMbps: number; userEgressMbps: number; ingressMbps: number };
  layerCap: number;
  userStreamsPaused: boolean;
  rooms: { id: string; name: string; slug: string; owner: string; live: boolean; viewers: number; egressMbps: number; ingressMbps: number }[];
}

export const LIMIT_FIELDS: { key: keyof Limits; label: string; hint?: string; type: 'number' | 'boolean'; step?: number }[] = [
  { key: 'maxRooms', label: 'Max rooms', type: 'number' },
  { key: 'maxStreams', label: 'Streams at the same time', type: 'number' },
  { key: 'maxBitrateMbps', label: 'Max bitrate (Mbps)', type: 'number', step: 0.5 },
  { key: 'maxHeight', label: 'Max resolution (height, px)', type: 'number' },
  { key: 'maxFps', label: 'Max frame rate', type: 'number' },
  { key: 'maxViewersPerRoom', label: 'Max viewers per room', type: 'number' },
  { key: 'maxWatching', label: 'Streams watched at once', type: 'number' },
  { key: 'maxStreamMinutes', label: 'Max stream length (min)', hint: '0 = unlimited', type: 'number' },
  { key: 'monthlyGb', label: 'Monthly traffic (GB)', hint: '0 = unlimited', type: 'number' },
  { key: 'allowPublicRooms', label: 'May create public rooms', type: 'boolean' },
  { key: 'allowAudio', label: 'May stream audio', type: 'boolean' },
];
