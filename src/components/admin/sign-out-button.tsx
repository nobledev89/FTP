"use client";

import { signOutAction } from "@/lib/auth/actions";

import { secondaryButtonClass } from "./form";
import { SubmitButton } from "./submit-button";

/** Sign-out is a POST, so it cannot be triggered by a link, a prefetch, or an embedded image. */
export function SignOutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form action={signOutAction}>
      {compact ? (
        <button className={`${secondaryButtonClass} h-8 px-2 text-xs`} type="submit">
          Sign out
        </button>
      ) : (
        <SubmitButton pendingLabel="Signing out…" variant="secondary">
          Sign out
        </SubmitButton>
      )}
    </form>
  );
}
