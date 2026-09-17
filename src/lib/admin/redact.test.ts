import { describe, expect, it } from "vitest";

import { MAX_LOG_TEXT_LENGTH, redactJson, redactJsonObject, redactLogText } from "./redact";

// GitHub's push protection rejects any literal with the shape of a Supabase secret key, including
// an obviously fake one, so the fixture is composed at runtime. It is not a credential.
const SECRET_KEY_SHAPED = ["sb", "secret", "0000000000000000NOTAREALKEY0000"].join("_");

describe("redactLogText", () => {
  it("returns null for absent or blank text", () => {
    expect(redactLogText(null)).toBeNull();
    expect(redactLogText(undefined)).toBeNull();
    expect(redactLogText("   ")).toBeNull();
  });

  it("masks Supabase and provider credentials", () => {
    const masked = redactLogText(
      `auth failed for ${SECRET_KEY_SHAPED} and sk-abcdefghijklmnopqrstuvwx`,
    );
    expect(masked).not.toContain("sb_secret_");
    expect(masked).not.toContain("sk-abcdefghijklmnop");
    expect(masked).toContain("[redacted]");
  });

  it("masks JSON web tokens", () => {
    const jwt =
      "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJleGFtcGxlLW9ubHkifQ.0000000000signature";
    expect(redactLogText(`bad token ${jwt}`)).not.toContain("eyJhbGciOi");
  });

  it("masks headers and assignment-style secrets", () => {
    expect(redactLogText("Authorization: Bearer abc.def.ghi")).not.toContain("abc.def.ghi");
    expect(redactLogText('{"api_key": "live-1234567890"}')).not.toContain("live-1234567890");
    expect(redactLogText("password=hunter2 failed")).not.toContain("hunter2");
  });

  it("masks credentials embedded in URLs", () => {
    expect(redactLogText("postgres://user:secret@127.0.0.1:5432/db")).not.toContain("secret");
    expect(redactLogText("https://example.test/x?token=abc123&page=2")).not.toContain("abc123");
  });

  it("masks local paths from the worker PC", () => {
    expect(redactLogText("ENOENT C:\\Users\\Owner\\codex\\out.json")).not.toContain("Owner");
    expect(redactLogText("cannot read /home/runner/work/secret.txt")).not.toContain("runner");
    expect(redactLogText("\\\\NAS01\\share\\keys.txt")).not.toContain("keys.txt");
  });

  it("masks email addresses", () => {
    expect(redactLogText("rejected for editor@fintechpulse.co.uk")).not.toContain("@fintechpulse");
  });

  it("collapses whitespace and truncates", () => {
    expect(redactLogText("line one\n\n   line two")).toBe("line one line two");
    const long = redactLogText("x".repeat(2000));
    expect(long).not.toBeNull();
    expect(long?.length).toBeLessThanOrEqual(MAX_LOG_TEXT_LENGTH);
    expect(long?.endsWith("…")).toBe(true);
  });

  it("leaves ordinary operator messages readable", () => {
    expect(redactLogText("Codex CLI exited with code 1 after 3 attempts")).toBe(
      "Codex CLI exited with code 1 after 3 attempts",
    );
  });
});

describe("redactJson", () => {
  it("redacts string leaves at every depth", () => {
    const value = redactJson({
      url: "https://example.test/a?token=abcdef123456",
      nested: { path: "C:\\Users\\Owner\\out.json", count: 3, ok: true },
      list: ["plain", "sk-abcdefghijklmnopqrstuvwx"],
    }) as Record<string, unknown>;

    expect(JSON.stringify(value)).not.toContain("abcdef123456");
    expect(JSON.stringify(value)).not.toContain("Owner");
    expect(JSON.stringify(value)).not.toContain("sk-abcdefghijklmnop");
    expect((value.nested as Record<string, unknown>).count).toBe(3);
    expect((value.nested as Record<string, unknown>).ok).toBe(true);
  });

  it("bounds recursion and collection size", () => {
    let deep: unknown = "leaf";
    for (let index = 0; index < 20; index += 1) deep = { deep };
    expect(() => redactJson(deep)).not.toThrow();
    expect((redactJson(Array.from({ length: 200 }, (_, i) => i)) as unknown[]).length).toBe(50);
  });

  it("keeps the object type through the typed wrapper", () => {
    const summary = { status: "ok", attempts: 2 };
    expect(redactJsonObject(summary)).toEqual({ status: "ok", attempts: 2 });
  });
});
