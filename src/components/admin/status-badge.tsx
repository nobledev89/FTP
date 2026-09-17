import type { ReactNode } from "react";

import type { StatusTone } from "@/lib/admin/status-display";

export type { StatusTone };

const toneClass: Record<StatusTone, string> = {
  success: "bg-success-bg text-success border-success/25",
  warning: "bg-warning-bg text-warning border-warning/25",
  danger: "bg-danger-bg text-danger border-danger/25",
  info: "bg-info-bg text-info border-info/25",
  neutral: "bg-neutral-bg text-neutral border-neutral/20",
};

const toneDot: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-neutral",
};

type StatusBadgeProps = {
  tone: StatusTone;
  children: ReactNode;
};

/** Status is always conveyed by text; colour and the dot only reinforce it. */
export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-control border px-2 font-mono text-[11px] font-medium uppercase tracking-wide ${toneClass[tone]}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${toneDot[tone]}`} />
      {children}
    </span>
  );
}
