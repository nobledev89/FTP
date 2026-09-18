import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { parsePublicSlug } from "./schema";

export const REVALIDATION_WINDOW_SECONDS = 300;
const MAX_BODY_BYTES = 1024;
const MAX_REQUESTS_PER_WINDOW = 120;

const requestSchema = z.object({ slug: z.string() }).strict();

type AcceptedRequest = Readonly<{ slug: string; timestamp: number; nonce: string }>;

const acceptedNonces = new Map<string, number>();
const acceptedAt: number[] = [];

function hexBuffer(value: string): Buffer | null {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return Buffer.from(value, "hex");
}

function prune(nowSeconds: number): void {
  const threshold = nowSeconds - REVALIDATION_WINDOW_SECONDS;
  for (const [nonce, timestamp] of acceptedNonces) {
    if (timestamp < threshold) acceptedNonces.delete(nonce);
  }
  while (acceptedAt.length > 0 && (acceptedAt[0] ?? 0) < threshold) acceptedAt.shift();
}

export function signRevalidationRequest(
  secret: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
}

/** Authenticates, bounds, and replay-protects one cache invalidation request. */
export function authenticateRevalidationRequest(input: {
  secret: string;
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
  body: string;
  now?: number;
}): { ok: true; request: AcceptedRequest } | { ok: false; status: number; message: string } {
  if (input.body.length > MAX_BODY_BYTES) {
    return { ok: false, status: 413, message: "Request body is too large" };
  }
  if (!/^\d{10}$/.test(input.timestamp ?? "")) {
    return { ok: false, status: 401, message: "Invalid signature" };
  }
  if (!/^[a-f0-9-]{36}$/i.test(input.nonce ?? "")) {
    return { ok: false, status: 401, message: "Invalid signature" };
  }

  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const timestamp = Number(input.timestamp);
  if (Math.abs(nowSeconds - timestamp) > REVALIDATION_WINDOW_SECONDS) {
    return { ok: false, status: 401, message: "Expired signature" };
  }

  const expected = Buffer.from(
    signRevalidationRequest(input.secret, input.timestamp!, input.nonce!, input.body),
    "hex",
  );
  const supplied = hexBuffer(input.signature ?? "");
  if (!supplied || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return { ok: false, status: 401, message: "Invalid signature" };
  }

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(JSON.parse(input.body));
  } catch {
    return { ok: false, status: 400, message: "Invalid request body" };
  }
  const slug = parsePublicSlug(parsed.slug);
  if (!slug) return { ok: false, status: 400, message: "Invalid article slug" };

  prune(nowSeconds);
  if (acceptedNonces.has(input.nonce!)) {
    return { ok: false, status: 409, message: "Request already used" };
  }
  if (acceptedAt.length >= MAX_REQUESTS_PER_WINDOW) {
    return { ok: false, status: 429, message: "Too many revalidation requests" };
  }
  acceptedNonces.set(input.nonce!, timestamp);
  acceptedAt.push(nowSeconds);
  return { ok: true, request: { slug, timestamp, nonce: input.nonce! } };
}
