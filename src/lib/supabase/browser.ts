"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { readSupabaseEnv } from "./env";

let browserClient: SupabaseClient<Database> | undefined;

/** Browser client used for path-scoped direct Storage uploads; database writes still use RPCs. */
export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;
  const env = readSupabaseEnv();
  browserClient = createBrowserClient<Database>(env.url, env.publishableKey);
  return browserClient;
}
