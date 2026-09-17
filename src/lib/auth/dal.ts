import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";

import { WorkflowError } from "@/lib/state-machine/errors";
import { SupabaseEnvError } from "@/lib/supabase/env";
import { PATHNAME_HEADER } from "@/lib/supabase/proxy-session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ADMIN_LOGIN, ADMIN_NO_ACCESS, loginUrlFor } from "./redirect-target";

/**
 * Data Access Layer for admin identity and authorization.
 *
 * Every read of "who is asking" goes through here, so the check cannot be forgotten at a call
 * site, and no layout is trusted to gate a nested segment. Two independent layers sit behind it:
 * RLS narrows what `authenticated` can select, and the admin RPCs re-authorize their own caller.
 * This module only decides what the console shows and which actions it offers.
 */

export const ADMIN_ROLES = ["owner", "editor", "viewer"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

const EDITING_ROLES: readonly AdminRole[] = ["owner", "editor"];

export type VerifiedUser = Readonly<{
  userId: string;
  email: string | null;
}>;

export type AdminSession = Readonly<{
  userId: string;
  email: string | null;
  siteId: string;
  role: AdminRole;
  displayName: string | null;
  canEdit: boolean;
  isOwner: boolean;
}>;

const membershipSchema = z
  .object({
    user_id: z.string().uuid(),
    site_id: z.string().uuid(),
    role: z.enum(ADMIN_ROLES),
    is_active: z.boolean(),
    display_name: z.string().nullable(),
  })
  .strict();

const rolePrecedence: Record<AdminRole, number> = { owner: 0, editor: 1, viewer: 2 };

/**
 * The signed-in user, established from a signature-verified access token.
 *
 * `getClaims()` is used rather than reading the cookie payload: the cookie is client-held storage
 * and its contents must not be trusted. Cached per request so a page and its components share one
 * verification.
 */
export const getVerifiedUser = cache(async (): Promise<VerifiedUser | null> => {
  let client;
  try {
    client = await createSupabaseServerClient();
  } catch (error) {
    if (error instanceof SupabaseEnvError) return null;
    throw error;
  }

  const { data, error } = await client.auth.getClaims();
  if (error || !data) return null;

  const { sub, email } = data.claims;
  if (typeof sub !== "string" || sub.length === 0) return null;
  return { userId: sub, email: typeof email === "string" ? email : null };
});

/**
 * The caller's active admin membership, or null for signed-out users and signed-in users with no
 * membership. A user with several memberships resolves to their most privileged one, matching
 * `private.admin_role()` and `private.require_editor()` in the database.
 */
export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  const user = await getVerifiedUser();
  if (!user) return null;

  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("admin_users")
    .select("user_id, site_id, role, is_active, display_name")
    .eq("user_id", user.userId)
    .eq("is_active", true);

  if (error) {
    throw new WorkflowError("DATABASE_ERROR", "Could not read the admin membership", {
      cause: error,
    });
  }

  const memberships = membershipSchema
    .array()
    .parse(data ?? [])
    .sort((left, right) => rolePrecedence[left.role] - rolePrecedence[right.role]);

  const membership = memberships[0];
  if (!membership) return null;

  return {
    userId: user.userId,
    email: user.email,
    siteId: membership.site_id,
    role: membership.role,
    displayName: membership.display_name,
    canEdit: EDITING_ROLES.includes(membership.role),
    isOwner: membership.role === "owner",
  };
});

/** The requested path, forwarded by `src/proxy.ts`, used to preserve the login destination. */
async function requestedPath(): Promise<string | null> {
  const headerList = await headers();
  return headerList.get(PATHNAME_HEADER);
}

/**
 * Gate for admin pages. Signed-out visitors go to the login page with their destination preserved;
 * signed-in users without a membership get an explanation rather than a silent redirect loop.
 * Never returns to a caller that is not authorized.
 */
export async function requireAdminSession(): Promise<AdminSession> {
  const user = await getVerifiedUser();
  if (!user) {
    redirect(loginUrlFor(await requestedPath()));
  }

  const session = await getAdminSession();
  if (!session) {
    redirect(ADMIN_NO_ACCESS);
  }
  return session;
}

export type ActionCapability = "read" | "write" | "own";

/**
 * Gate for Server Actions and Route Handlers. Throws instead of redirecting, so an action reports a
 * refusal to the form it came from. The matching database function performs the same check, so a
 * forged request that bypasses this still cannot write.
 */
export async function authorizeAdminAction(
  capability: ActionCapability = "write",
): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) {
    throw new WorkflowError("NOT_AUTHORIZED", "An active admin membership is required");
  }
  if (capability === "write" && !session.canEdit) {
    throw new WorkflowError(
      "NOT_AUTHORIZED",
      "This account has read-only access; an editor or owner is required",
    );
  }
  if (capability === "own" && !session.isOwner) {
    throw new WorkflowError("NOT_AUTHORIZED", "Only the publication owner can change this");
  }
  return session;
}

/** Login URL for the current request, used by the sign-out flow and by error states. */
export async function loginUrlForCurrentRequest(): Promise<string> {
  const path = await requestedPath();
  return path ? loginUrlFor(path) : ADMIN_LOGIN;
}
