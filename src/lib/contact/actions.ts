"use server";

import { headers } from "next/headers";

import { parseContactForm } from "./message";
import { allowContactSubmission } from "./rate-limit";
import type { ContactFormState } from "./state";
import { readContactDeliveryConfig, sendContactEmail } from "./send";

const SENT = "Thanks — your message has been sent. We'll reply by email if a response is needed.";

export async function submitContactForm(
  _previous: ContactFormState,
  form: FormData,
): Promise<ContactFormState> {
  const parsed = parseContactForm(form);
  if (parsed.ok === "spam") return { status: "sent", message: SENT };
  if (!parsed.ok) return { status: "error", message: parsed.error };

  const requestHeaders = await headers();
  const client =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "unknown";
  if (!allowContactSubmission(client)) {
    return {
      status: "error",
      message: "Too many messages from this connection. Please try again in an hour.",
    };
  }

  const config = readContactDeliveryConfig();
  if (!config) {
    console.error("Contact form is not configured: set RESEND_API_KEY and CONTACT_TO_EMAIL");
    return {
      status: "error",
      message: "The contact form is temporarily unavailable. Please try again later.",
    };
  }

  try {
    await sendContactEmail(parsed.message, config);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Contact email failed");
    return {
      status: "error",
      message: "Your message could not be sent just now. Please try again in a few minutes.",
    };
  }
  return { status: "sent", message: SENT };
}
