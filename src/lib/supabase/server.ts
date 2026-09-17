import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "./database.types";
import { readSupabaseEnv } from "./env";

export type ServerSupabaseClient = SupabaseClient<Database>;

/**
 * Request-scoped Supabase client for Server Components, Server Actions, and Route Handlers.
 *
 * A new client is created per call because `@supabase/ssr` binds the session to this request's
 * cookies; sharing one across requests would leak sessions between users. Server Components cannot
 * write cookies, so `setAll` is best-effort there and `src/proxy.ts` performs the refresh that
 * actually persists. Reads go through RLS as the signed-in user: the publishable key carries no
 * privileges of its own.
 */
export async function createSupabaseServerClient(): Promise<ServerSupabaseClient> {
  const env = readSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Rendering a Server Component: cookies are read-only. The proxy already refreshed the
          // session for this request, so dropping the write here is safe and expected.
        }
      },
    },
  });
}
