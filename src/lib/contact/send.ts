import "server-only";

import { composeContactEmail, type ContactMessage } from "./message";

/**
 * Delivers a contact message through Resend's HTTP API.
 *
 * The destination address lives only in the server environment (`CONTACT_TO_EMAIL`): it is never
 * rendered, never sent to the browser, and never committed. Replies go straight to the sender via
 * `reply_to`.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** Resend's shared test sender works before a domain is verified, for the account's own inbox. */
const DEFAULT_FROM = "FinTechPulse <onboarding@resend.dev>";

export type ContactDeliveryConfig = Readonly<{ apiKey: string; to: string; from: string }>;

export function readContactDeliveryConfig(
  env: Record<string, string | undefined> = process.env,
): ContactDeliveryConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const to = env.CONTACT_TO_EMAIL?.trim();
  if (!apiKey || !to) return null;
  return { apiKey, to, from: env.CONTACT_FROM_EMAIL?.trim() || DEFAULT_FROM };
}

export async function sendContactEmail(
  message: ContactMessage,
  config: ContactDeliveryConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { subject, text } = composeContactEmail(message);
  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [config.to],
      reply_to: message.email,
      subject,
      text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // The provider's body can echo request fields; log the status only.
    throw new Error(`Contact email was not accepted (HTTP ${response.status})`);
  }
}
