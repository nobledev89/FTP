import { describe, expect, it } from "vitest";

import { SupabaseEnvError, readSupabaseEnv } from "./env";

// GitHub's push protection rejects any literal with the shape of a Supabase secret key, including
// an obviously fake one, so the fixture is composed at runtime. It is not a credential.
const SECRET_KEY_SHAPED = ["sb", "secret", "0000000000000000NOTAREALKEY0000"].join("_");

describe("readSupabaseEnv", () => {
  it("accepts a URL and a publishable key", () => {
    expect(
      readSupabaseEnv({
        url: "http://127.0.0.1:54321",
        publishableKey: "sb_publishable_0000000000000000_EXAMPLE",
      }),
    ).toEqual({
      url: "http://127.0.0.1:54321",
      publishableKey: "sb_publishable_0000000000000000_EXAMPLE",
    });
  });

  it("reports both missing values at once", () => {
    try {
      readSupabaseEnv({ url: undefined, publishableKey: undefined });
      expect.unreachable("expected a SupabaseEnvError");
    } catch (error) {
      expect(error).toBeInstanceOf(SupabaseEnvError);
      expect((error as Error).message).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect((error as Error).message).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    }
  });

  it("rejects a URL that is not absolute", () => {
    expect(() =>
      readSupabaseEnv({
        url: "127.0.0.1:54321",
        publishableKey: "sb_publishable_1234567890abcdef",
      }),
    ).toThrow(SupabaseEnvError);
  });

  it("refuses a service-role secret in the browser-visible key", () => {
    expect(() =>
      readSupabaseEnv({
        url: "https://project.supabase.co",
        publishableKey: SECRET_KEY_SHAPED,
      }),
    ).toThrow(/service-role secret/);
  });
});
