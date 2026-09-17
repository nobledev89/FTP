/**
 * Redaction for text that reaches the admin console from the worker PC (plan sections 12 and 19:
 * "filterable provider/publish/job logs with redacted errors").
 *
 * Provider errors can quote a CLI's stderr, which may contain a local Windows path, a signed URL,
 * or an API key. The console is authenticated, but it is still the wrong place to surface any of
 * that: it ends up in screenshots, bug reports, and browser history.
 */

const MASK = "[redacted]";

type Rule = Readonly<{ pattern: RegExp; replacement: string }>;

const RULES: readonly Rule[] = [
  // Supabase and common provider key shapes.
  { pattern: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, replacement: MASK },
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}/g, replacement: MASK },
  { pattern: /\b(?:AIza|ghp_|gho_|github_pat_)[A-Za-z0-9_-]{10,}/g, replacement: MASK },
  // JSON Web Tokens, including the legacy Supabase anon/service keys.
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replacement: MASK },
  // Header- and assignment-style secrets: `Authorization: Bearer x`, `api_key=x`, `"token": "x"`.
  // The scheme is consumed with the value so `Bearer <token>` does not leave the token behind.
  {
    pattern: /\bauthorization\b\s*[:=]\s*(?:[A-Za-z]+\s+)?\S+/gi,
    replacement: `authorization: ${MASK}`,
  },
  { pattern: /\bbearer\s+\S+/gi, replacement: `bearer ${MASK}` },
  {
    pattern:
      /\b(api[-_]?key|apikey|secret|token|password|passwd|pwd|credential)\b\s*["']?\s*[:=]\s*["']?[^\s"',;}]+/gi,
    replacement: `$1=${MASK}`,
  },
  // Credentials embedded in a URL.
  { pattern: /\b([a-z][a-z0-9+.-]*):\/\/[^\s/@]+:[^\s/@]+@/gi, replacement: `$1://${MASK}@` },
  // Query-string credentials on any URL.
  {
    pattern: /([?&](?:token|key|signature|sig|api[-_]?key|access[-_]?token)=)[^&\s]+/gi,
    replacement: `$1${MASK}`,
  },
  // Local filesystem paths on the worker PC.
  { pattern: /\b[A-Za-z]:\\[^\s"'<>|]*/g, replacement: `${MASK}\\...` },
  { pattern: /\\\\[A-Za-z0-9_.-]+\\[^\s"'<>|]*/g, replacement: `${MASK}\\...` },
  { pattern: /\/(?:home|Users|root)\/[^\s"'<>|]*/g, replacement: `${MASK}/...` },
  // Addresses that would identify a person.
  { pattern: /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, replacement: MASK },
];

export const MAX_LOG_TEXT_LENGTH = 600;

/**
 * Masks credentials, local paths, and email addresses, then truncates. Returns null for absent or
 * blank input so callers can render an empty state instead of an empty box.
 */
export function redactLogText(
  value: string | null | undefined,
  maxLength: number = MAX_LOG_TEXT_LENGTH,
): string | null {
  if (typeof value !== "string") return null;
  let text = value.trim();
  if (text.length === 0) return null;

  for (const { pattern, replacement } of RULES) {
    text = text.replace(pattern, replacement);
  }
  // Collapse runs of whitespace so multi-line stack traces stay readable in a table cell.
  text = text.replace(/\s+/g, " ").trim();

  const limit = Math.max(40, Math.trunc(maxLength));
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/**
 * Redacts a JSON object column in place of its own type. Redaction only rewrites string leaves and
 * truncates long collections, so the result still satisfies the column's schema.
 */
export function redactJsonObject<T extends Record<string, unknown>>(value: T): T {
  return redactJson(value) as T;
}

/** Recursively redacts the string leaves of a JSON summary column. */
export function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 6) return MASK;
  if (typeof value === "string") return redactLogText(value, 240);
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => redactJson(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, entry]) => [key, redactJson(entry, depth + 1)]),
    );
  }
  return value;
}
