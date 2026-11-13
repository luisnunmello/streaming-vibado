import { get, run } from './db.js';
import { HttpError } from './errors.js';

/** Server-wide settings, editable by the admin. */
export interface GlobalSettings {
  /** Most the server may upload to viewers, all rooms together. */
  egressBudgetMbps: number;
  /** Most the server may receive from streamers. */
  ingressBudgetMbps: number;
  /** Share of the egress budget that users can never use (kept for the admin's own streams), 0-90. */
  adminReservePct: number;
  /** Stop a user stream after this many minutes without viewers. 0 = never. */
  idleStopMinutes: number;
  /** Viewer connections allowed per IP address. 0 = unlimited. */
  maxConnectionsPerIp: number;
  /** Emergency switch: no user can stream while true. */
  userStreamsPaused: boolean;
}

const defaults = (): GlobalSettings => ({
  egressBudgetMbps: Number(process.env.EGRESS_BUDGET_MBPS ?? 500),
  ingressBudgetMbps: Number(process.env.INGRESS_BUDGET_MBPS ?? 800),
  adminReservePct: 30,
  idleStopMinutes: 30,
  maxConnectionsPerIp: 4,
  userStreamsPaused: false,
});

let cache: GlobalSettings | null = null;

export function getGlobals(): GlobalSettings {
  if (cache) return cache;
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = 'global'");
  const base = defaults();
  let stored: Partial<GlobalSettings> = {};
  try {
    stored = row ? JSON.parse(row.value) : {};
  } catch {
    /* ignore corrupt value */
  }
  cache = { ...base, ...stored };
  return cache;
}

function num(v: unknown, name: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} must be between ${min} and ${max}`);
  return n;
}

export function updateGlobals(patch: Record<string, unknown>): GlobalSettings {
  const cur = getGlobals();
  const next: GlobalSettings = { ...cur };
  if (patch['egressBudgetMbps'] !== undefined) next.egressBudgetMbps = num(patch['egressBudgetMbps'], 'egressBudgetMbps', 1, 1_000_000);
  if (patch['ingressBudgetMbps'] !== undefined) next.ingressBudgetMbps = num(patch['ingressBudgetMbps'], 'ingressBudgetMbps', 1, 1_000_000);
  if (patch['adminReservePct'] !== undefined) next.adminReservePct = num(patch['adminReservePct'], 'adminReservePct', 0, 90);
  if (patch['idleStopMinutes'] !== undefined) next.idleStopMinutes = num(patch['idleStopMinutes'], 'idleStopMinutes', 0, 1440);
  if (patch['maxConnectionsPerIp'] !== undefined) next.maxConnectionsPerIp = num(patch['maxConnectionsPerIp'], 'maxConnectionsPerIp', 0, 1000);
  if (patch['userStreamsPaused'] !== undefined) {
    if (typeof patch['userStreamsPaused'] !== 'boolean') throw new HttpError(400, 'userStreamsPaused must be true or false');
    next.userStreamsPaused = patch['userStreamsPaused'];
  }
  run("INSERT INTO settings (key, value) VALUES ('global', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(next));
  cache = next;
  return next;
}
