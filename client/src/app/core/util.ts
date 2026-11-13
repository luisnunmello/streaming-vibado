export function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(0)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

type Translate = (text: string, params?: Record<string, string | number>) => string;

export function timeAgo(ms: number | null, t: Translate = (text, params) => text.replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? ''))): string {
  if (!ms) return t('never');
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n} h ago', { n: Math.floor(s / 3600) });
  return t('{n} d ago', { n: Math.floor(s / 86400) });
}

export function dateShort(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Absolute URL for a path like /r/slug. */
export const absoluteUrl = (path: string): string => location.origin + path;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
