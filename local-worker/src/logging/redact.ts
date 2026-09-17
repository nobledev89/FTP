const SENSITIVE_KEY = /authorization|cookie|password|secret|token|api[_-]?key|service[_-]?role/i;

const REDACTION_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]"],
  [/\b(?:sk-(?:ant-)?|sb_secret_)[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]"],
  [/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]"],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@"],
  [/\b[A-Z]:\\(?:[^\s\\]+\\)*[^\s\\]*/gi, "[REDACTED_PATH]"],
  [/(^|[\s"'(])\/(?:Users|home)\/[^\s"')]+/g, "$1[REDACTED_PATH]"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]"],
];

export function redactText(value: string): string {
  return REDACTION_RULES.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    value,
  );
}

/** Returns a JSON-safe copy with secret-bearing fields and strings redacted. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED_DEPTH]";
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      ...(typeof (value as Error & { code?: unknown }).code === "string"
        ? { code: (value as Error & { code: string }).code }
        : {}),
    };
  }
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(entry, depth + 1),
      ]),
    );
  }
  return redactText(String(value));
}

export function safeSummary(error: unknown, maximumLength = 2_000): string {
  const source = error instanceof Error ? error.message : String(error);
  const redacted = redactText(source)
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  return (redacted || "Unknown worker error").slice(0, maximumLength);
}
