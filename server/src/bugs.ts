import { all, get, run, tx } from './db.js';
import { HttpError } from './errors.js';

/** A screenshot is shrunk by the browser first; this is the most the server accepts (keeps storage cheap). */
export const MAX_SHOT_BYTES = 350 * 1024;
/** Reports kept at most; the admin deletes old ones to make room. */
const MAX_REPORTS = 500;

export type BugStatus = 'open' | 'solved';

export interface BugReport {
  id: number;
  title: string;
  description: string;
  reporter: string;
  page: string;
  userAgent: string;
  /** App version the reporter was running. */
  version: string;
  /** App version that fixed it (set by the admin). */
  fixedIn: string;
  status: BugStatus;
  adminNote: string;
  hasShot: boolean;
  createdAt: number;
  updatedAt: number;
  solvedAt: number | null;
}

interface Row {
  id: number;
  title: string;
  description: string;
  reporter: string;
  page: string;
  user_agent: string;
  version: string;
  fixed_in: string;
  status: BugStatus;
  admin_note: string;
  has_shot: number;
  created_at: number;
  updated_at: number;
  solved_at: number | null;
}

const toReport = (r: Row): BugReport => ({
  id: r.id,
  title: r.title,
  description: r.description,
  reporter: r.reporter,
  page: r.page,
  userAgent: r.user_agent,
  version: r.version,
  fixedIn: r.fixed_in,
  status: r.status,
  adminNote: r.admin_note,
  hasShot: !!r.has_shot,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  solvedAt: r.solved_at,
});

const text = (v: unknown, name: string, min: number, max: number): string => {
  if (typeof v !== 'string') throw new HttpError(400, `${name} is required`);
  const s = v.trim();
  if (s.length < min) throw new HttpError(400, `${name} is too short`);
  if (s.length > max) throw new HttpError(400, `${name} is too long`);
  return s;
};

/** Checks a "data:image/…;base64,…" URL and returns the image bytes. Only JPEG, PNG and WebP, by their real header. */
function parseShot(dataUrl: unknown): { mime: string; data: Buffer } {
  if (typeof dataUrl !== 'string') throw new HttpError(400, 'Invalid screenshot');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'The screenshot must be a JPEG, PNG or WebP image');
  const data = Buffer.from(m[2], 'base64');
  if (data.length > MAX_SHOT_BYTES) throw new HttpError(413, 'The screenshot is too large');
  const ok =
    (m[1] === 'image/jpeg' && data[0] === 0xff && data[1] === 0xd8) ||
    (m[1] === 'image/png' && data.subarray(0, 4).toString('hex') === '89504e47') ||
    (m[1] === 'image/webp' && data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP');
  if (!ok) throw new HttpError(400, 'Invalid screenshot');
  return { mime: m[1], data };
}

/** Versions look like 1.2.3 (anything else is ignored, so reports can't carry junk). */
export const cleanVersion = (v: unknown): string => (typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v.trim()) ? v.trim() : '');

export function createBug(input: { version?: unknown; title: unknown; description: unknown; screenshot?: unknown; reporter: string; page: unknown; userAgent: unknown }): BugReport {
  const title = text(input.title, 'The title', 3, 100);
  const description = text(input.description, 'The description', 5, 2000);
  const shot = input.screenshot ? parseShot(input.screenshot) : null;
  const page = typeof input.page === 'string' ? input.page.slice(0, 200) : '';
  const userAgent = typeof input.userAgent === 'string' ? input.userAgent.slice(0, 200) : '';
  if ((get<{ n: number }>('SELECT COUNT(*) AS n FROM bug_reports')?.n ?? 0) >= MAX_REPORTS) throw new HttpError(503, 'Bug reports are full right now. Please try again later.');
  const now = Date.now();
  const id = tx(() => {
    const r = run(
      'INSERT INTO bug_reports (title, description, reporter, page, user_agent, version, has_shot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      title,
      description,
      input.reporter,
      page,
      userAgent,
      cleanVersion(input.version),
      shot ? 1 : 0,
      now,
      now,
    );
    if (shot) run('INSERT INTO bug_shots (bug_id, mime, data) VALUES (?, ?, ?)', r.id, shot.mime, shot.data);
    return r.id;
  });
  return getBug(id)!;
}

export const getBug = (id: number): BugReport | undefined => {
  const r = get<Row>('SELECT * FROM bug_reports WHERE id = ?', id);
  return r && toReport(r);
};

export const listBugs = (): BugReport[] => all<Row>("SELECT * FROM bug_reports ORDER BY (status = 'open') DESC, created_at DESC").map(toReport);

export const countOpenBugs = (): number => get<{ n: number }>("SELECT COUNT(*) AS n FROM bug_reports WHERE status = 'open'")?.n ?? 0;

export const getShot = (id: number): { mime: string; data: Buffer } | undefined => get<{ mime: string; data: Buffer }>('SELECT mime, data FROM bug_shots WHERE bug_id = ?', id);

export function updateBug(id: number, patch: { title?: unknown; description?: unknown; adminNote?: unknown; status?: unknown; fixedIn?: unknown; version?: unknown }): BugReport {
  const cur = getBug(id);
  if (!cur) throw new HttpError(404, 'Report not found');
  const title = patch.title === undefined ? cur.title : text(patch.title, 'The title', 3, 100);
  const description = patch.description === undefined ? cur.description : text(patch.description, 'The description', 5, 2000);
  const adminNote = patch.adminNote === undefined ? cur.adminNote : typeof patch.adminNote === 'string' ? patch.adminNote.trim().slice(0, 1000) : '';
  const fixedIn = patch.fixedIn === undefined ? cur.fixedIn : cleanVersion(patch.fixedIn);
  if (patch.fixedIn !== undefined && patch.fixedIn !== '' && !fixedIn) throw new HttpError(400, 'The fixed-in version must look like 1.2.3');
  const version = patch.version === undefined ? cur.version : cleanVersion(patch.version);
  let status = cur.status;
  if (patch.status !== undefined) {
    if (patch.status !== 'open' && patch.status !== 'solved') throw new HttpError(400, 'Invalid status');
    status = patch.status;
  }
  const now = Date.now();
  const solvedAt = status === 'solved' ? (cur.status === 'solved' ? cur.solvedAt : now) : null;
  run('UPDATE bug_reports SET title = ?, description = ?, admin_note = ?, version = ?, fixed_in = ?, status = ?, solved_at = ?, updated_at = ? WHERE id = ?', title, description, adminNote, version, fixedIn, status, solvedAt, now, id);
  return getBug(id)!;
}

export function deleteBug(id: number): void {
  if (run('DELETE FROM bug_reports WHERE id = ?', id).changes === 0) throw new HttpError(404, 'Report not found');
}

/** Drops the screenshot of a report (keeps the text). */
export function removeShot(id: number): BugReport {
  if (!getBug(id)) throw new HttpError(404, 'Report not found');
  run('DELETE FROM bug_shots WHERE bug_id = ?', id);
  run('UPDATE bug_reports SET has_shot = 0, updated_at = ? WHERE id = ?', Date.now(), id);
  return getBug(id)!;
}
