import { all, get, run, tx } from './db.js';
import { HttpError } from './errors.js';
import { parseStoredLimits, sanitizeLimits, type Limits } from './limits.js';

/** A named set of limits that can be assigned to many users. Editing it updates all of them. */
export interface Preset {
  id: number;
  name: string;
  limits: Limits;
  isDefault: boolean;
  createdAt: number;
  /** Users currently linked to this preset. */
  userCount: number;
}

interface PresetRow {
  id: number;
  name: string;
  limits: string;
  is_default: number;
  created_at: number;
  user_count?: number;
}

const toPreset = (r: PresetRow): Preset => ({
  id: r.id,
  name: r.name,
  limits: parseStoredLimits(r.limits),
  isDefault: !!r.is_default,
  createdAt: r.created_at,
  userCount: r.user_count ?? 0,
});

const SELECT = 'SELECT p.*, (SELECT COUNT(*) FROM users u WHERE u.preset_id = p.id) AS user_count FROM presets p';

export const listPresets = (): Preset[] => all<PresetRow>(`${SELECT} ORDER BY p.is_default DESC, p.name`).map(toPreset);

export const getPreset = (id: number): Preset | undefined => {
  const r = get<PresetRow>(`${SELECT} WHERE p.id = ?`, id);
  return r && toPreset(r);
};

export function defaultPreset(): Preset {
  const r = get<PresetRow>(`${SELECT} WHERE p.is_default = 1`);
  if (!r) throw new Error('No default preset');
  return toPreset(r);
}

export function validatePresetName(name: unknown): string {
  if (typeof name !== 'string') throw new HttpError(400, 'A preset name is required');
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length < 1 || n.length > 40) throw new HttpError(400, 'The preset name must have 1 to 40 characters');
  return n;
}

function ensureNameFree(name: string, exceptId?: number): void {
  const row = get<{ id: number }>('SELECT id FROM presets WHERE name = ?', name);
  if (row && row.id !== exceptId) throw new HttpError(409, 'A preset with that name already exists');
}

export function createPreset(nameInput: unknown, limitsInput: unknown, makeDefault: unknown): Preset {
  const name = validatePresetName(nameInput);
  const limits = sanitizeLimits(limitsInput, defaultPreset().limits);
  return tx(() => {
    ensureNameFree(name);
    const { id } = run('INSERT INTO presets (name, limits, is_default, created_at) VALUES (?, ?, 0, ?)', name, JSON.stringify(limits), Date.now());
    if (makeDefault === true) setDefault(id);
    return getPreset(id)!;
  });
}

function setDefault(id: number): void {
  run('UPDATE presets SET is_default = 0 WHERE is_default = 1 AND id != ?', id);
  run('UPDATE presets SET is_default = 1 WHERE id = ?', id);
}

/** Returns the updated preset and the ids of the users linked to it (their limits just changed). */
export function updatePreset(id: number, patch: Record<string, unknown>): { preset: Preset; userIds: number[] } {
  const cur = getPreset(id);
  if (!cur) throw new HttpError(404, 'Preset not found');
  const name = patch['name'] !== undefined ? validatePresetName(patch['name']) : cur.name;
  const limits = patch['limits'] !== undefined ? sanitizeLimits(patch['limits'], cur.limits) : cur.limits;
  return tx(() => {
    ensureNameFree(name, id);
    run('UPDATE presets SET name = ?, limits = ? WHERE id = ?', name, JSON.stringify(limits), id);
    if (patch['isDefault'] === true) setDefault(id);
    else if (patch['isDefault'] === false && cur.isDefault) throw new HttpError(400, 'Make another preset the default instead');
    const userIds = all<{ id: number }>('SELECT id FROM users WHERE preset_id = ?', id).map((r) => r.id);
    return { preset: getPreset(id)!, userIds };
  });
}

/** Users on a deleted preset keep the limits they have right now, as custom limits. */
export function deletePreset(id: number): void {
  const preset = getPreset(id);
  if (!preset) throw new HttpError(404, 'Preset not found');
  if (preset.isDefault) throw new HttpError(409, 'The default preset cannot be deleted. Make another preset the default first.');
  tx(() => {
    run('UPDATE users SET limits = ?, preset_id = NULL WHERE preset_id = ?', JSON.stringify(preset.limits), id);
    run('DELETE FROM presets WHERE id = ?', id);
  });
}
