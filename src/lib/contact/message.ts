import { z } from "zod";

/**
 * Reader contact form: what a visitor may send and how it becomes an email. Pure, so validation
 * and spam rules are testable without a mail provider.
 */

export const CONTACT_TOPICS = [
  { value: "correction", label: "Report an error or correction" },
  { value: "editorial", label: "Story tip or editorial question" },
  { value: "rights", label: "Rights and permissions" },
  { value: "commercial", label: "Commercial enquiry" },
  { value: "other", label: "Something else" },
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number]["value"];

/** A human needs at least this long to read the form and write a message. */
export const MIN_FILL_MS = 3_000;
/** A form older than this is stale; the visitor is asked to try again. */
const MAX_FILL_MS = 24 * 60 * 60 * 1000;

const singleLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value.replace(/[\r\n\t]+/g, " "));

const contactSchema = z.object({
  name: singleLine(120).pipe(z.string().min(1, "Please tell us your name.")),
  email: z.string().trim().max(254).pipe(z.email("Please enter a valid email address.")),
  topic: z.enum(CONTACT_TOPICS.map((topic) => topic.value) as [ContactTopic, ...ContactTopic[]], {
    error: "Please choose what your message is about.",
  }),
  articleUrl: singleLine(500)
    .refine((value) => value === "" || /^https?:\/\/\S+$/.test(value), {
      message: "Please enter the article's full address, or leave it blank.",
    })
    .optional()
    .default(""),
  message: z
    .string()
    .trim()
    .min(10, "Please write a little more so we can help.")
    .max(5_000, "Please keep your message under 5,000 characters."),
});

export type ContactMessage = z.infer<typeof contactSchema>;

export type ContactParseResult =
  | Readonly<{ ok: true; message: ContactMessage }>
  /** Looks automated. The visitor is shown success so bots learn nothing; nothing is sent. */
  | Readonly<{ ok: "spam" }>
  | Readonly<{ ok: false; error: string }>;

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export function parseContactForm(form: FormData, now: number = Date.now()): ContactParseResult {
  // Honeypot: hidden from people, filled by naive bots.
  if (field(form, "website").trim() !== "") return { ok: "spam" };

  const startedAt = Number(field(form, "startedAt"));
  // Set by the browser once the form is interactive; absent when scripts did not run.
  if (!Number.isFinite(startedAt) || startedAt <= 0) {
    return { ok: false, error: "Please reload the page and try again." };
  }
  if (now - startedAt < MIN_FILL_MS) return { ok: "spam" };
  if (now - startedAt > MAX_FILL_MS) {
    return { ok: false, error: "This form has expired. Please reload the page and try again." };
  }

  const parsed = contactSchema.safeParse({
    name: field(form, "name"),
    email: field(form, "email"),
    topic: field(form, "topic"),
    articleUrl: field(form, "articleUrl"),
    message: field(form, "message"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  return { ok: true, message: parsed.data };
}

export function contactTopicLabel(topic: ContactTopic): string {
  return CONTACT_TOPICS.find((item) => item.value === topic)?.label ?? topic;
}

/** Subject and plain-text body for the publisher's inbox. */
export function composeContactEmail(message: ContactMessage): { subject: string; text: string } {
  const label = contactTopicLabel(message.topic);
  return {
    subject: `[FinTechPulse contact] ${label}: ${message.name}`.slice(0, 200),
    text: [
      `From: ${message.name} <${message.email}>`,
      `Topic: ${label}`,
      ...(message.articleUrl ? [`Article: ${message.articleUrl}`] : []),
      "",
      message.message,
      "",
      "—",
      "Sent from the contact form at https://fintechpulse.co.uk/contact. Reply to answer the sender directly.",
    ].join("\n"),
  };
}
