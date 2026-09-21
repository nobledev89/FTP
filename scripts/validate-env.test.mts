import { describe, expect, it } from "vitest";

import {
  EnvironmentValidationError,
  validateEnvironmentPair,
  validateWebEnv,
  validateWorkerEnv,
} from "./validate-env.mts";

const revalidationSecret = "r".repeat(32);
const web = {
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example_contract_value_000000",
  REVALIDATION_SECRET: revalidationSecret,
};
const worker = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  PUBLIC_SITE_URL: "http://localhost:3000",
  REVALIDATION_SECRET: revalidationSecret,
  WORKER_ID: "home-pc-1",
};

describe("deployment environment validation", () => {
  it("accepts matching web and worker environments through the production schemas", () => {
    expect(() =>
      validateEnvironmentPair(validateWebEnv(web), validateWorkerEnv(worker)),
    ).not.toThrow();
  });

  it("rejects worker secrets in the web environment", () => {
    expect(() =>
      validateWebEnv({ ...web, SUPABASE_SERVICE_ROLE_KEY: "must-not-reach-vercel" }),
    ).toThrow(/worker-only/);
  });

  it("rejects copied placeholders before startup", () => {
    expect(() =>
      validateWebEnv({
        ...web,
        REVALIDATION_SECRET: "replace-with-at-least-32-random-characters",
      }),
    ).toThrow(/placeholder/);
    expect(() =>
      validateWorkerEnv({
        ...worker,
        SUPABASE_SERVICE_ROLE_KEY: "replace-with-hosted-service-role-key",
      }),
    ).toThrow(/placeholder/);
  });

  it("reports every cross-environment mismatch without exposing secrets", () => {
    const secret = "s".repeat(32);
    try {
      validateEnvironmentPair(
        validateWebEnv(web),
        validateWorkerEnv({
          ...worker,
          SUPABASE_URL: "https://different.supabase.co",
          PUBLIC_SITE_URL: "https://preview.example.com",
          REVALIDATION_SECRET: secret,
        }),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      const message = (error as Error).message;
      expect(message).toContain("SUPABASE_URL");
      expect(message).toContain("PUBLIC_SITE_URL");
      expect(message).toContain("REVALIDATION_SECRET");
      expect(message).not.toContain(secret);
    }
  });
});
