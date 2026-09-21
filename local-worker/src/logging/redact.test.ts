import { describe, expect, it } from "vitest";

import { StructuredLogger, type LogLevel } from "./logger.js";
import { redactText, redactValue, safeSummary } from "./redact.js";

describe("worker log redaction", () => {
  it("redacts credentials, identity, and personal paths in free text", () => {
    // Compose key-shaped fixtures so repository scanners do not mistake test text for credentials.
    const anthropicKey = ["sk", "ant", "api03", "secret"].join("-");
    const googleKey = ["AI", "za", "123456789012345678901234"].join("");
    const input = `Bearer abc.def.ghi ${anthropicKey} ${googleKey} at C:\\Users\\Dana\\worker and dana@example.com https://me:pass@example.com/x`;
    const output = redactText(input);
    expect(output).not.toContain("abc.def.ghi");
    expect(output).not.toContain(anthropicKey);
    expect(output).not.toContain(googleKey);
    expect(output).not.toContain("Dana");
    expect(output).not.toContain("dana@example.com");
    expect(output).not.toContain("me:pass");
  });

  it("redacts values under secret-bearing keys at any nesting depth", () => {
    expect(
      redactValue({
        job_id: "job-1",
        lease_token: "lease-value",
        nested: { SUPABASE_SERVICE_ROLE_KEY: "service-value" },
      }),
    ).toEqual({
      job_id: "job-1",
      lease_token: "[REDACTED]",
      nested: { SUPABASE_SERVICE_ROLE_KEY: "[REDACTED]" },
    });
  });

  it("emits one redacted JSON object per log line", () => {
    const lines: Array<{ line: string; level: LogLevel }> = [];
    const logger = new StructuredLogger(
      { worker_id: "worker-a" },
      { write: (line, level) => lines.push({ line, level }) },
      () => new Date("2026-09-18T00:00:00.000Z"),
    );
    logger.error("stage.failed", {
      authorization: "Bearer secret",
      error: new Error("at C:\\Users\\Dana"),
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("error");
    expect(JSON.parse(lines[0]!.line)).toMatchObject({
      timestamp: "2026-09-18T00:00:00.000Z",
      event: "stage.failed",
      worker_id: "worker-a",
      authorization: "[REDACTED]",
      error: { name: "Error", message: "at [REDACTED_PATH]" },
    });
  });

  it("bounds database-safe summaries", () => {
    expect(safeSummary(new Error(`token ${"x".repeat(100)}`), 20)).toHaveLength(20);
  });
});
