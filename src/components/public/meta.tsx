import type { ReactNode } from "react";

import { formatLongDate, formatShortDate, toIsoString } from "@/lib/format/date";
import { cn } from "@/lib/utils/cn";

type Tone = "paper" | "dark";

const toneColour: Record<Tone, string> = {
  paper: "text-subtle",
  dark: "text-dark-subtle",
};

type MetaProps = {
  children: ReactNode;
  tone?: Tone;
  className?: string;
};

/** Section and category label: mono 11px uppercase, 0.24em tracking. */
export function Eyebrow({ children, tone = "paper", className }: MetaProps) {
  return (
    <div
      className={cn(
        "font-mono text-[11px] uppercase tracking-[0.24em]",
        toneColour[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Inline metadata: mono 11px uppercase, 0.18em tracking. */
export function MetaText({ children, tone = "paper", className }: MetaProps) {
  return (
    <span
      className={cn(
        "font-mono text-[11px] uppercase tracking-[0.18em]",
        toneColour[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type DateTextProps = {
  value: string;
  format?: "short" | "long";
  className?: string;
};

export function DateText({ value, format = "short", className }: DateTextProps) {
  return (
    <time className={className} dateTime={toIsoString(value)}>
      {format === "long" ? formatLongDate(value) : formatShortDate(value)}
    </time>
  );
}
