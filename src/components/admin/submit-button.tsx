"use client";

import { useFormStatus } from "react-dom";

import { dangerButtonClass, primaryButtonClass, secondaryButtonClass } from "./form";

/**
 * Submit control that reports the form's pending state. `useFormStatus` reads the status of the
 * enclosing form, so one component covers every action without prop drilling.
 */

type SubmitButtonProps = {
  children: string;
  /** Pending label. Defaults to the idle label plus an ellipsis. */
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  /** Value submitted for the `action` field, when several buttons share one form. */
  name?: string;
  value?: string;
  disabled?: boolean;
  /** Native confirmation before a destructive or irreversible action. */
  formNoValidate?: boolean;
};

const VARIANTS = {
  primary: primaryButtonClass,
  secondary: secondaryButtonClass,
  danger: dangerButtonClass,
} as const satisfies Record<NonNullable<SubmitButtonProps["variant"]>, string>;

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  name,
  value,
  disabled = false,
  formNoValidate = false,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-disabled={pending || disabled ? "true" : undefined}
      className={VARIANTS[variant]}
      disabled={pending || disabled}
      formNoValidate={formNoValidate}
      name={name}
      type="submit"
      value={value}
    >
      {pending ? (pendingLabel ?? `${children}…`) : children}
    </button>
  );
}
