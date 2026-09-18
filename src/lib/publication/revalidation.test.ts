import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { authenticateRevalidationRequest, signRevalidationRequest } from "./revalidation";

const secret = "test-revalidation-secret-that-is-long-enough";

function signed(now: number, nonce = randomUUID()) {
  const timestamp = String(Math.floor(now / 1000));
  const body = JSON.stringify({ slug: "safe-public-article" });
  return {
    secret,
    timestamp,
    nonce,
    body,
    signature: signRevalidationRequest(secret, timestamp, nonce, body),
    now,
  };
}

describe("revalidation authentication", () => {
  it("accepts a current, correctly signed, narrow request once", () => {
    const now = Date.parse("2026-09-18T10:00:00Z");
    const request = signed(now);
    expect(authenticateRevalidationRequest(request)).toEqual({
      ok: true,
      request: {
        slug: "safe-public-article",
        timestamp: Math.floor(now / 1000),
        nonce: request.nonce,
      },
    });
    expect(authenticateRevalidationRequest(request)).toMatchObject({ ok: false, status: 409 });
  });

  it("rejects invalid, expired, and over-broad requests", () => {
    const now = Date.parse("2026-09-18T10:00:00Z");
    expect(
      authenticateRevalidationRequest({ ...signed(now), signature: "0".repeat(64) }),
    ).toMatchObject({ ok: false, status: 401 });
    expect(authenticateRevalidationRequest({ ...signed(now), now: now + 301_000 })).toMatchObject({
      ok: false,
      status: 401,
    });

    const request = signed(now, randomUUID());
    const body = JSON.stringify({ slug: "safe-public-article", tag: "anything" });
    expect(
      authenticateRevalidationRequest({
        ...request,
        body,
        signature: signRevalidationRequest(secret, request.timestamp, request.nonce, body),
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });
});
