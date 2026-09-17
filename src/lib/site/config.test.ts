import { describe, expect, it } from "vitest";

import { CANONICAL_ORIGIN, designReviewEnabled, resolveSiteOrigin, siteConfig } from "./config";

describe("siteConfig", () => {
  it("locks the UK publication defaults", () => {
    expect(CANONICAL_ORIGIN).toBe("https://fintechpulse.co.uk");
    expect(siteConfig.locale).toBe("en-GB");
    expect(siteConfig.timeZone).toBe("Europe/London");
    expect(siteConfig.currency).toBe("GBP");
  });
});

describe("resolveSiteOrigin", () => {
  it("falls back to the canonical origin", () => {
    expect(resolveSiteOrigin(undefined).href).toBe("https://fintechpulse.co.uk/");
    expect(resolveSiteOrigin("  ").href).toBe("https://fintechpulse.co.uk/");
  });

  it("accepts an origin with or without a trailing slash", () => {
    expect(resolveSiteOrigin("http://localhost:3000").origin).toBe("http://localhost:3000");
    expect(resolveSiteOrigin("https://fintechpulse.co.uk/").origin).toBe(CANONICAL_ORIGIN);
  });

  it("rejects non-http protocols, paths, and malformed values", () => {
    expect(() => resolveSiteOrigin("javascript:alert(1)")).toThrow(/http or https/);
    expect(() => resolveSiteOrigin("https://fintechpulse.co.uk/blog")).toThrow(/without a path/);
    expect(() => resolveSiteOrigin("fintechpulse.co.uk")).toThrow(/absolute URL/);
  });
});

describe("designReviewEnabled", () => {
  it("is disabled only in Vercel production", () => {
    expect(designReviewEnabled({ VERCEL_ENV: "production" })).toBe(false);
    expect(designReviewEnabled({ VERCEL_ENV: "preview" })).toBe(true);
    expect(designReviewEnabled({})).toBe(true);
  });
});
