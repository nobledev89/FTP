"use client";

import { useActionState } from "react";

import { signInAction } from "@/lib/auth/actions";
import { initialSignInState } from "@/lib/auth/sign-in-state";

import { Field, FormMessage, controlClass } from "./form";
import { SubmitButton } from "./submit-button";

/**
 * Admin sign-in. Email and password only (plan section 12); accounts are created by the owner, so
 * there is no sign-up or self-service reset link to offer.
 */
export function LoginForm({ nextPath }: { nextPath?: string }) {
  const [state, formAction] = useActionState(signInAction, initialSignInState);

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      {state.error ? <FormMessage state={{ ok: false, error: state.error }} /> : null}

      <Field htmlFor="email" label="Email address" required>
        <input
          autoComplete="username"
          className={controlClass}
          defaultValue={state.email}
          id="email"
          inputMode="email"
          name="email"
          required
          type="email"
        />
      </Field>

      <Field hint="At least 12 characters." htmlFor="password" label="Password" required>
        <input
          aria-describedby="password-hint"
          autoComplete="current-password"
          className={controlClass}
          id="password"
          name="password"
          required
          type="password"
        />
      </Field>

      {nextPath ? <input name="next" type="hidden" value={nextPath} /> : null}

      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
