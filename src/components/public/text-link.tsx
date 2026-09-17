import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type TextLinkProps = {
  href: string;
  children: ReactNode;
  tone?: "paper" | "dark";
  className?: string;
};

/** Primary public call to action: uppercase label with a bottom rule, 40px hit area. */
export function TextLink({ href, children, tone = "paper", className }: TextLinkProps) {
  const dark = tone === "dark";
  return (
    <Link className={cn("group inline-flex min-h-10 items-center", className)} href={href}>
      <span
        className={cn(
          "border-b pb-1 font-mono text-[11px] uppercase tracking-[0.24em] transition-colors",
          dark
            ? "border-dark-line text-dark-copy group-hover:border-dark-copy group-hover:text-white"
            : "border-line text-muted group-hover:border-ink group-hover:text-ink",
        )}
      >
        {children}
      </span>
    </Link>
  );
}

type ButtonLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
};

/** Rectangular bordered link for the rare case a button shape is needed. Inverts on hover. */
export function ButtonLink({ href, children, className }: ButtonLinkProps) {
  return (
    <Link
      className={cn(
        "inline-flex min-h-10 items-center border border-line px-4 text-sm font-medium text-ink transition-colors hover:border-ink hover:bg-ink hover:text-paper",
        className,
      )}
      href={href}
    >
      {children}
    </Link>
  );
}
