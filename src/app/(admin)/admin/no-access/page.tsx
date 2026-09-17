import type { Metadata } from "next";

import { SignOutButton } from "@/components/admin/sign-out-button";
import { getVerifiedUser } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "No admin access",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Shown to a signed-in user with no active `admin_users` row. They are authenticated but see
 * exactly what an anonymous visitor sees (docs/SUPABASE.md), so the honest thing is to say so
 * rather than bounce them back to a login form they have already completed.
 */
export default async function AdminNoAccessPage() {
  const user = await getVerifiedUser();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center p-6">
      <div className="rounded-panel border border-border bg-panel p-6">
        <p className="font-mono text-xs text-text-subtle">No access</p>
        <h1 className="mt-2 text-xl font-semibold">This account has no admin access</h1>
        <p className="mt-2 text-sm text-text-muted">
          {user?.email ? (
            <>
              You are signed in as <span className="font-mono">{user.email}</span>, but this account
              has no active membership for the publication.
            </>
          ) : (
            <>This session has no active membership for the publication.</>
          )}
        </p>
        <p className="mt-2 text-sm text-text-muted">
          Ask the publication owner to add a membership, then sign out and back in.
        </p>
        <div className="mt-5">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
