import { NextResponse, type NextRequest } from "next/server";

import {
  ADMIN_HOME,
  ADMIN_LOGIN,
  isPublicAdminPath,
  loginUrlFor,
  safeAdminDestination,
} from "@/lib/auth/redirect-target";
import { supabaseConfigured } from "@/lib/supabase/env";
import { carryCookies, refreshSession } from "@/lib/supabase/proxy-session";

/**
 * Proxy (Next.js 16's renamed Middleware) for the admin application.
 *
 * Two jobs, both deliberately cheap:
 *   1. refresh the Supabase session cookie so long-lived admin sessions do not expire mid-edit;
 *   2. an *optimistic* redirect of signed-out visitors to the login page.
 *
 * It is not the authorization boundary. Admin membership is never read here: that check belongs
 * next to the data, in `src/lib/auth/dal.ts`, and ultimately in the database functions and RLS
 * policies. Server Actions post to the route that renders them, so they pass through this proxy
 * too, but each one re-authorizes independently.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  // Without credentials there is nothing to refresh and no session to check. The login page renders
  // a configuration notice instead of a form, so passing through keeps the message visible.
  if (!supabaseConfigured()) {
    return NextResponse.next();
  }

  const { response, userId } = await refreshSession(request);
  const isLogin = pathname === ADMIN_LOGIN;

  if (!userId && !isPublicAdminPath(pathname)) {
    const target = new URL(loginUrlFor(`${pathname}${search}`), request.nextUrl);
    return carryCookies(response, NextResponse.redirect(target));
  }

  if (userId && isLogin) {
    const destination = safeAdminDestination(request.nextUrl.searchParams.get("next"));
    return carryCookies(
      response,
      NextResponse.redirect(new URL(destination || ADMIN_HOME, request.nextUrl)),
    );
  }

  // Admin responses are per-user. Keep them out of CDN and shared caches even when no token
  // rotation happened on this request.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  // Only the admin application needs a session. Public publication routes stay cacheable and are
  // never delayed by session work.
  matcher: ["/admin", "/admin/:path*"],
};
