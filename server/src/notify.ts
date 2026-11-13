import { countPendingAppeals } from './accounts.js';

/**
 * Optional notifications for the admin, sent to a webhook while nobody has the site open.
 *  - A Discord webhook URL (https://discord.com/api/webhooks/...) gets a Discord message.
 *  - Any other URL (ntfy.sh topic, Gotify, a custom endpoint...) gets the text as a plain POST body.
 * Set NOTIFY_WEBHOOK_URL to enable it. Failures are logged, never thrown.
 */
const url = process.env['NOTIFY_WEBHOOK_URL']?.trim() ?? '';

export const notificationsEnabled = (): boolean => url !== '';

export async function notifyAdmin(text: string): Promise<void> {
  if (!url) return;
  const message = text.slice(0, 1800);
  try {
    const discord = /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(url);
    const res = await fetch(url, {
      method: 'POST',
      headers: discord ? { 'content-type': 'application/json' } : { 'content-type': 'text/plain; charset=utf-8', Title: 'Streaming' },
      body: discord ? JSON.stringify({ content: message, allowed_mentions: { parse: [] } }) : message,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.warn(`[notify] webhook answered ${res.status}`);
  } catch (e: any) {
    console.warn('[notify] could not reach the webhook:', e?.message ?? e);
  }
}

/** Reminds the admin every `hours` hours while appeals are still waiting (0 = never). */
export function startAppealReminders(hours: number): void {
  if (!url || hours <= 0) return;
  let lastReminder = Date.now() - hours * 3_600_000 + 5 * 60_000; // the first reminder comes 5 minutes after start
  setInterval(() => {
    const n = countPendingAppeals();
    if (n === 0 || Date.now() - lastReminder < hours * 3_600_000) return;
    lastReminder = Date.now();
    void notifyAdmin(`Reminder: ${n} appeal${n === 1 ? ' is' : 's are'} still waiting for an answer.`);
  }, 60_000).unref();
}
