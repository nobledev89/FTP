import { beforeEach, describe, expect, it, vi } from "vitest";

import { composeContactEmail, MIN_FILL_MS, parseContactForm } from "./message";
import { allowContactSubmission, CONTACT_LIMIT, resetContactRateLimit } from "./rate-limit";

vi.mock("server-only", () => ({}));
const { readContactDeliveryConfig, sendContactEmail } = await import("./send");

const now = Date.parse("2026-09-24T12:00:00Z");

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const values = {
    name: "Alex Reader",
    email: "alex@example.com",
    topic: "correction",
    articleUrl: "https://fintechpulse.co.uk/blog/some-story",
    message: "The fee quoted in the third paragraph is out of date.",
    website: "",
    startedAt: String(now - 60_000),
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("parseContactForm", () => {
  it("accepts a complete message", () => {
    const result = parseContactForm(form(), now);
    expect(result).toMatchObject({
      ok: true,
      message: { name: "Alex Reader", topic: "correction" },
    });
  });

  it("silently drops honeypot and instant submissions", () => {
    expect(parseContactForm(form({ website: "https://spam.example" }), now)).toEqual({
      ok: "spam",
    });
    expect(parseContactForm(form({ startedAt: String(now - MIN_FILL_MS + 1) }), now)).toEqual({
      ok: "spam",
    });
  });

  it("asks for a reload when the form was not stamped or is stale", () => {
    expect(parseContactForm(form({ startedAt: "" }), now)).toMatchObject({ ok: false });
    expect(
      parseContactForm(form({ startedAt: String(now - 2 * 24 * 60 * 60 * 1000) }), now),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
  });

  it("explains invalid fields", () => {
    expect(parseContactForm(form({ email: "not-an-email" }), now)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/email/i),
    });
    expect(parseContactForm(form({ topic: "free-money" }), now)).toMatchObject({ ok: false });
    expect(parseContactForm(form({ message: "hi" }), now)).toMatchObject({ ok: false });
    expect(parseContactForm(form({ articleUrl: "javascript:alert(1)" }), now)).toMatchObject({
      ok: false,
    });
  });

  it("keeps header-like fields on one line", () => {
    const result = parseContactForm(form({ name: "Alex\r\nBcc: victim@example.com" }), now);
    expect(result.ok).toBe(true);
    if (result.ok === true) expect(result.message.name).toBe("Alex Bcc: victim@example.com");
  });
});

describe("composeContactEmail", () => {
  it("labels the topic and includes the sender and article", () => {
    const result = parseContactForm(form(), now);
    if (result.ok !== true) throw new Error("expected a valid message");
    const email = composeContactEmail(result.message);
    expect(email.subject).toBe("[FinTechPulse contact] Report an error or correction: Alex Reader");
    expect(email.text).toContain("From: Alex Reader <alex@example.com>");
    expect(email.text).toContain("Article: https://fintechpulse.co.uk/blog/some-story");
  });
});

describe("contact delivery", () => {
  it("needs both the API key and the destination", () => {
    expect(readContactDeliveryConfig({ RESEND_API_KEY: "re_x" })).toBeNull();
    expect(readContactDeliveryConfig({ CONTACT_TO_EMAIL: "editor@example.com" })).toBeNull();
    expect(
      readContactDeliveryConfig({ RESEND_API_KEY: "re_x", CONTACT_TO_EMAIL: "editor@example.com" }),
    ).toMatchObject({ to: "editor@example.com", from: expect.stringContaining("resend.dev") });
  });

  it("sends to the configured inbox with the reader as reply-to", async () => {
    const result = parseContactForm(form(), now);
    if (result.ok !== true) throw new Error("expected a valid message");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendContactEmail(
      result.message,
      { apiKey: "re_test", to: "editor@example.com", from: "FinTechPulse <a@b.test>" },
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: ["editor@example.com"],
      reply_to: "alex@example.com",
    });
  });

  it("reports a rejected send without echoing the provider response", async () => {
    const result = parseContactForm(form(), now);
    if (result.ok !== true) throw new Error("expected a valid message");
    const fetchImpl = vi.fn(
      async () => new Response("editor@example.com is invalid", { status: 422 }),
    );
    await expect(
      sendContactEmail(
        result.message,
        { apiKey: "re_test", to: "editor@example.com", from: "x" },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/^Contact email was not accepted \(HTTP 422\)$/);
  });
});

describe("allowContactSubmission", () => {
  beforeEach(() => resetContactRateLimit());

  it("allows a few messages per connection per hour", () => {
    for (let index = 0; index < CONTACT_LIMIT; index += 1) {
      expect(allowContactSubmission("203.0.113.9", now + index)).toBe(true);
    }
    expect(allowContactSubmission("203.0.113.9", now + 10)).toBe(false);
    expect(allowContactSubmission("198.51.100.1", now + 10)).toBe(true);
    expect(allowContactSubmission("203.0.113.9", now + 60 * 60 * 1000 + 1)).toBe(true);
  });
});
