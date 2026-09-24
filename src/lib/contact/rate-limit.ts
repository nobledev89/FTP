/**
 * Best-effort per-connection limit for the contact form. It lives in one server instance's memory,
 * so it slows a single abuser rather than guaranteeing a global cap; the honeypot and fill-time
 * checks in `message.ts` stop most automated posts before they get here.
 */

export const CONTACT_LIMIT = 5;
export const CONTACT_WINDOW_MS = 60 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 5_000;

const submissions = new Map<string, number[]>();

export function allowContactSubmission(client: string, now: number = Date.now()): boolean {
  const recent = (submissions.get(client) ?? []).filter((time) => now - time < CONTACT_WINDOW_MS);
  if (recent.length >= CONTACT_LIMIT) {
    submissions.set(client, recent);
    return false;
  }
  recent.push(now);
  submissions.delete(client);
  submissions.set(client, recent);
  // Evict the oldest clients so memory stays bounded.
  while (submissions.size > MAX_TRACKED_CLIENTS) {
    const oldest = submissions.keys().next().value;
    if (oldest === undefined) break;
    submissions.delete(oldest);
  }
  return true;
}

/** Test helper. */
export function resetContactRateLimit(): void {
  submissions.clear();
}
