import type { ReactNode } from "react";

/**
 * Form primitives shared by the admin forms. Purely presentational, so they render in both Server
 * and Client Components. Control heights and radii follow docs/DESIGN-SYSTEM.md section 10.
 */

export const controlClass =
  "h-8 w-full rounded-control border border-border-strong bg-panel px-2 text-sm text-text placeholder:text-text-subtle";

export const textAreaClass =
  "w-full rounded-control border border-border-strong bg-panel px-2 py-1.5 text-sm text-text placeholder:text-text-subtle";

export const primaryButtonClass =
  "flex h-8 items-center justify-center rounded-control bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60";

export const secondaryButtonClass =
  "flex h-8 items-center justify-center rounded-control border border-border-strong bg-panel px-3 text-sm font-medium hover:bg-neutral-bg disabled:opacity-60";

export const dangerButtonClass =
  "flex h-8 items-center justify-center rounded-control border border-danger/40 bg-panel px-3 text-sm font-medium text-danger hover:bg-danger-bg disabled:opacity-60";

type FieldProps = {
  label: string;
  htmlFor: string;
  hint?: string;
  /** Rendered next to the label, for example a character budget. */
  meta?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * Label, control, and help text. The hint is associated through `aria-describedby` by the caller,
 * which owns the control's id.
 */
export function Field({
  label,
  htmlFor,
  hint,
  meta,
  required = false,
  className = "",
  children,
}: FieldProps) {
  return (
    <div className={`grid gap-1 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-medium text-text-muted" htmlFor={htmlFor}>
          {label}
          {required ? (
            <span aria-hidden="true" className="ml-0.5 text-danger">
              *
            </span>
          ) : null}
        </label>
        {meta ? <span className="font-mono text-[11px] text-text-subtle">{meta}</span> : null}
      </div>
      {children}
      {hint ? (
        <p className="text-xs text-text-subtle" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type CheckboxFieldProps = {
  id: string;
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  required?: boolean;
};

export function CheckboxField({
  id,
  name,
  label,
  hint,
  defaultChecked,
  disabled,
  required,
}: CheckboxFieldProps) {
  return (
    <div className="flex items-start gap-2">
      <input
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 size-4 rounded-[2px] border-border-strong accent-accent"
        defaultChecked={defaultChecked}
        disabled={disabled}
        id={id}
        name={name}
        required={required}
        type="checkbox"
      />
      <div className="grid gap-0.5">
        <label className="text-sm font-medium" htmlFor={id}>
          {label}
        </label>
        {hint ? (
          <p className="text-xs text-text-subtle" id={`${id}-hint`}>
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type FormMessageProps = {
  /** `null` renders nothing, so a fresh form has no empty region reserved. */
  state: Readonly<{ ok: true; message: string } | { ok: false; error: string }> | null;
};

/**
 * Result of the last submission. `role="status"` announces both outcomes; `aria-live` is polite so
 * it does not interrupt a screen reader mid-sentence.
 */
export function FormMessage({ state }: FormMessageProps) {
  if (!state) return null;
  if (state.ok && state.message.length === 0) return null;

  const classes = state.ok
    ? "border-success/25 bg-success-bg text-success"
    : "border-danger/25 bg-danger-bg text-danger";

  return (
    <p
      aria-live="polite"
      className={`whitespace-pre-wrap rounded-panel border px-3 py-2 text-sm ${classes}`}
      role="status"
    >
      {state.ok ? state.message : state.error}
    </p>
  );
}
