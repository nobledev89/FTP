"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { SupabaseEnvError } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ADMIN_LOGIN, ADMIN_NO_ACCESS, safeAdminDestination } from "./redirect-target";
import type { SignInState } from "./sign-in-state";

/**
 * Sign-in and sign-out. Supabase email authentication is the only method in v1, and public sign-up
 * is disabled in `supabase/config.toml`, so accounts exist only because an owner created them.
 *
 * A `"use server"` module may export async functions only, so the state type and its initial value
 * live in `./sign-in-state`.
 */

/**
 * One message for every rejected attempt. Distinguishing "no such account" from "wrong password"
 * would turn the form into an account-existence oracle, and sign-up is closed, so there is nothing
 * a legitimate user could do with the difference.
 */
const REJECTED = "Those sign-in details were not recognised.";

const credentialsSchema = z.object({
  email: z.string().trim().min(3).max(320).email(),
  password: z.string().min(1).max(200),
  next: z.string().max(512).optional(),
});

export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const submitted = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    next: formData.get("next") ? String(formData.get("next")) : undefined,
  };
  const echo = submitted.email.trim().slice(0, 320);

  const parsed = credentialsSchema.safeParse(submitted);
  if (!parsed.success) {
    return { error: "Enter an email address and password.", email: echo };
  }

  let client;
  try {
    client = await createSupabaseServerClient();
  } catch (error) {
    if (error instanceof SupabaseEnvError) {
      return { error: "Sign-in is unavailable: Supabase is not configured.", email: echo };
    }
    throw error;
  }

  const { data, error } = await client.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // Supabase applies its own rate limiting to this endpoint; the class of failure is kept on the
    // server and never reflected to the browser.
    console.warn("admin sign-in rejected", { reason: error?.code ?? "no_user" });
    return { error: REJECTED, email: echo };
  }

  // Membership is read with the client that just signed in, so it uses the new session rather than
  // a request-cached one from before the cookie was written.
  const membership = await client
    .from("admin_users")
    .select("user_id")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1);

  if (membership.error) {
    console.error("admin membership lookup failed after sign-in", {
      code: membership.error.code,
    });
    return { error: "Signed in, but the admin membership could not be read.", email: echo };
  }

  // `redirect` throws, so it stays outside every try block above.
  if (membership.data.length === 0) {
    redirect(ADMIN_NO_ACCESS);
  }
  redirect(safeAdminDestination(parsed.data.next));
}

export async function signOutAction(): Promise<void> {
  try {
    const client = await createSupabaseServerClient();
    await client.auth.signOut();
  } catch (error) {
    if (!(error instanceof SupabaseEnvError)) throw error;
  }
  redirect(ADMIN_LOGIN);
}
