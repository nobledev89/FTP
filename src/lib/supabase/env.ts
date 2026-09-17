import { z } from "zod";

/**
 * Browser-safe Supabase settings (plan section 15).
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so they are read as static property accesses
 * rather than through a computed key. Parsing is lazy: `next build` must succeed on a machine with
 * no Supabase credentials, and every route that talks to Supabase is request-time anyway.
 *
 * The web app never reads the service-role key. See docs/SUPABASE.md.
 */
const supabaseEnvSchema = z.object({
  url: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_URL is required")
    .url("NEXT_PUBLIC_SUPABASE_URL must be an absolute URL"),
  publishableKey: z
    .string()
    .min(20, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required")
    // Publishable/anon keys are not secrets, but a service-role secret here would be, and it would
    // be shipped to browsers. Reject the shape outright.
    .refine((value) => !value.startsWith("sb_secret_"), {
      message: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must not be a service-role secret",
    }),
});

export type SupabaseEnv = z.infer<typeof supabaseEnvSchema>;

export class SupabaseEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseEnvError";
  }
}

export function readSupabaseEnv(
  input: { url?: string | undefined; publishableKey?: string | undefined } = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
): SupabaseEnv {
  const parsed = supabaseEnvSchema.safeParse({
    url: input.url ?? "",
    publishableKey: input.publishableKey ?? "",
  });
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new SupabaseEnvError(`Supabase is not configured: ${reasons}`);
  }
  return parsed.data;
}

/** True when Supabase credentials are present, so pages can render an honest setup notice. */
export function supabaseConfigured(): boolean {
  try {
    readSupabaseEnv();
    return true;
  } catch {
    return false;
  }
}
