export interface Limits {
  maxRooms: number;
  maxStreams: number;
  maxBitrateMbps: number;
  maxHeight: number;
  maxFps: number;
  maxViewersPerRoom: number;
  maxStreamMinutes: number;
  allowPublicRooms: boolean;
  allowAudio: boolean;
  monthlyGb: number;
}

export interface Me {
  role: 'admin' | 'guest';
  name: string;
  guestId?: number;
  /** null for the admin (no per-account limits). */
  limits: Limits | null;
  referrals?: { quota: number; used: number };
  monthBytes?: number;
  invitedByName?: string | null;
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

export interface GuestView {
  id: number;
  name: string;
  status: 'pending' | 'active' | 'disabled';
  limits: Limits;
  referralQuota: number;
  referralsUsed: number;
  invitedById: number | null;
  invitedByName: string | null;
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
  guestStreamsPaused: boolean;
  defaultLimits: Limits;
}

export interface BandwidthView {
  egress: { guest: number; admin: number; total: number };
  ingress: { guest: number; admin: number; total: number };
  budget: { egressMbps: number; guestEgressMbps: number; ingressMbps: number };
  layerCap: number;
  guestStreamsPaused: boolean;
  rooms: { id: string; name: string; slug: string; owner: string; live: boolean; viewers: number; egressMbps: number; ingressMbps: number }[];
}

export const LIMIT_FIELDS: { key: keyof Limits; label: string; hint?: string; type: 'number' | 'boolean'; step?: number }[] = [
  { key: 'maxRooms', label: 'Max rooms', type: 'number' },
  { key: 'maxStreams', label: 'Streams at the same time', type: 'number' },
  { key: 'maxBitrateMbps', label: 'Max bitrate (Mbps)', type: 'number', step: 0.5 },
  { key: 'maxHeight', label: 'Max resolution (height, px)', type: 'number' },
  { key: 'maxFps', label: 'Max frame rate', type: 'number' },
  { key: 'maxViewersPerRoom', label: 'Max viewers per room', type: 'number' },
  { key: 'maxStreamMinutes', label: 'Max stream length (min)', hint: '0 = unlimited', type: 'number' },
  { key: 'monthlyGb', label: 'Monthly traffic (GB)', hint: '0 = unlimited', type: 'number' },
  { key: 'allowPublicRooms', label: 'May create public rooms', type: 'boolean' },
  { key: 'allowAudio', label: 'May stream audio', type: 'boolean' },
];
