import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "./database.types";
import { readSupabaseEnv } from "./env";

/** Request header the proxy uses to tell Server Components which path was requested. */
export const PATHNAME_HEADER = "x-fintechpulse-pathname";

export type SessionRefresh = {
  /** Response carrying any refreshed auth cookies. Return it, or copy its cookies onto a redirect. */
  readonly response: NextResponse;
  /** The verified subject of the access token, or null when there is no valid session. */
  readonly userId: string | null;
};

/**
 * Refreshes the Supabase session at the network edge of the app (plan section 12).
 *
 * `@supabase/ssr` writes rotated tokens through `setAll`, which must land on the response that is
 * actually returned — Server Components cannot set cookies, so without this the browser would keep
 * replaying an expired refresh token. The identity is read with `getClaims()`, which verifies the
 * token's signature rather than trusting the cookie's contents.
 */
export async function refreshSession(request: NextRequest): Promise<SessionRefresh> {
  const env = readSupabaseEnv();

  // Overwrite rather than append: a client must not be able to forge the path header.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, request.nextUrl.pathname);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient<Database>(env.url, env.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        // Rebuild the response so this render sees the rotated tokens too.
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Supabase supplies the no-store headers that keep a rotated session out of shared caches.
        for (const [key, headerValue] of Object.entries(headers)) {
          response.headers.set(key, headerValue);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const subject = data?.claims.sub;
  const userId = !error && typeof subject === "string" && subject.length > 0 ? subject : null;

  return { response, userId };
}

/** Moves refreshed auth cookies onto a different response, so a redirect never drops them. */
export function carryCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  return to;
}
