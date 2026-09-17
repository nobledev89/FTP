import type { Metadata } from "next";

import { LoginForm } from "@/components/admin/login-form";
import { Notice } from "@/components/admin/panel";
import { safeAdminDestination, ADMIN_HOME } from "@/lib/auth/redirect-target";
import { supabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

// Sign-in reads and writes the session cookie, so it is never prerendered or cached.
export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeAdminDestination(Array.isArray(params.next) ? params.next[0] : params.next);
  const configured = supabaseConfigured();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center p-6">
      <div className="rounded-panel border border-border bg-panel p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-text-subtle">FinTechPulse</p>
        <h1 className="mt-1 text-xl font-semibold">Admin sign in</h1>
        <p className="mt-1 text-sm text-text-muted">
          Editorial operations for the publication. Accounts are created by the owner; there is no
          public sign-up.
        </p>

        <div className="mt-5">
          {configured ? (
            <LoginForm {...(next === ADMIN_HOME ? {} : { nextPath: next })} />
          ) : (
            <Notice tone="warning">
              Supabase is not configured for this deployment. Set{" "}
              <span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span> and{" "}
              <span className="font-mono">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</span>, then reload.
              See docs/SUPABASE.md.
            </Notice>
          )}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-text-subtle">
        This area is not indexed and is separate from the public publication.
      </p>
    </main>
  );
}
