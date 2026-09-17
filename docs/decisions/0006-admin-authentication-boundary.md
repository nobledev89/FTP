# ADR 0006: Where the admin authentication boundary lives

- Status: Accepted
- Date: 2026-09-18

## Context

The plan (section 12) requires that "middleware/server layout redirects unauthenticated requests, but
every server action and route handler independently authorizes", and that admin membership comes from
`admin_users` rather than a claim the browser can edit.

Next.js 16 renames the `middleware.ts` convention to `proxy.ts` and runs it on the Node.js runtime by
default. Next.js also warns that a layout is not an authorization boundary: layouts do not re-render
on client-side navigation, and they do not control whether nested segments render or appear in the
RSC payload. Server Actions are reachable as POSTs to the route that renders them, so a matcher
change could silently remove proxy coverage from one.

## Decision

Four independent layers, in this order:

1. **`src/proxy.ts`** refreshes the Supabase session cookie and performs an _optimistic_ redirect of
   signed-out visitors to `/admin/login`. It reads no membership and makes no authorization decision.
   Matcher: `/admin` and `/admin/:path*` only, so public pages stay cacheable and are not delayed by
   session work.
2. **`src/lib/auth/dal.ts`** is the only place that answers "who is asking". `requireAdminSession()`
   gates pages; `authorizeAdminAction()` gates Server Actions and throws rather than redirecting.
   Identity comes from `getClaims()`, which verifies the access token's signature, never from the
   cookie's contents.
3. **Row Level Security** limits what the `authenticated` role can select at all, so a missed check in
   the application cannot widen a query.
4. **`SECURITY DEFINER` RPCs** re-derive the caller's membership. `authenticated` holds no table write
   privileges, so every admin write is a function call that authorizes itself and enforces the state
   machine and `lock_version`.

No admin layout performs an auth check. Each page calls the DAL itself.

A signed-in user with no active membership is redirected to `/admin/no-access`, which names the
account and offers a sign-out, rather than being bounced back to a login form they have already
completed. `unauthorized()` and `forbidden()` would give a 401/403 status instead, but they need the
experimental `authInterrupts` flag and a per-root-layout `unauthorized.tsx`; the admin is already
`noindex`, so the status code buys nothing here.

The login destination (`?next=`) is normalized by `safeAdminDestination`, which accepts only paths
inside `/admin`. It is the one piece of this boundary that takes an attacker-controlled value, so it
is a pure function with its own test file.

## Consequences

- Adding an admin page means calling `requireAdminSession()` in the page. Forgetting to is caught by
  RLS returning no rows, not by a silent leak, but the page would render an empty shell — so the
  authenticated end-to-end suite visits every route.
- Adding an admin mutation means adding a database function; there is no path that writes a table
  directly from the web app.
- The proxy matcher must keep covering any new admin route. Server Actions post to the route that
  renders them, so a route outside the matcher would lose session refresh — but not authorization,
  which the action and the database still perform.
- Session refresh happens only on `/admin/*`. An admin who leaves a public page open does not keep
  their session warm; that is intended.
