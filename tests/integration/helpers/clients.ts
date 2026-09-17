import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";

import type { Database } from "@/lib/supabase/database.types";

import { localSupabase } from "./env";

export type Client = SupabaseClient<Database>;

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

export function anonClient(): Client {
  const env = localSupabase();
  return createClient<Database>(env.apiUrl, env.publishableKey, clientOptions);
}

/** The local worker's credential. Never used by browser code. */
export function serviceClient(): Client {
  const env = localSupabase();
  return createClient<Database>(env.apiUrl, env.secretKey, clientOptions);
}

let pool: pg.Pool | undefined;

/** Direct Postgres access as the database owner, for fixtures and assertions only. */
export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: localSupabase().dbUrl, max: 6 });
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export type TestUser = {
  id: string;
  email: string;
  client: Client;
};

/** Creates a confirmed auth user and returns a client signed in as that user. */
export async function signedInUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `Test-${randomUUID()}`;
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw error ?? new Error("createUser returned no user");
  }

  const client = anonClient();
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) {
    throw signIn.error;
  }
  return { id: data.user.id, email, client };
}

export async function siteId(): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    "select id from public.sites where slug = 'fintechpulse'",
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Seed site missing; run `pnpm supabase:reset`");
  }
  return row.id;
}

export async function adminUser(role: "owner" | "editor" | "viewer" = "editor"): Promise<TestUser> {
  const user = await signedInUser(role);
  await db().query("insert into public.admin_users (user_id, site_id, role) values ($1, $2, $3)", [
    user.id,
    await siteId(),
    role,
  ]);
  return user;
}

/**
 * Removes workflow data between test files. TRUNCATE bypasses the row-level history guards, which is
 * acceptable only for disposable local test databases.
 */
export async function resetWorkflowData(): Promise<void> {
  await db().query(`
    truncate table
      public.job_events, public.publishing_logs, public.originality_checks, public.article_slug_aliases,
      public.claim_sources, public.claims, public.sources, public.images, public.worker_instances
    cascade;
    truncate table public.article_jobs, public.articles, public.drafts, public.audits, public.research_packets,
      public.provider_runs cascade;
  `);
}
