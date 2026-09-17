import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

const containerWidths = {
  shell: "max-w-5xl",
  article: "max-w-4xl",
  narrow: "max-w-3xl",
} as const;

type ContainerProps = {
  children: ReactNode;
  width?: keyof typeof containerWidths;
  className?: string;
};

export function Container({ children, width = "shell", className }: ContainerProps) {
  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", containerWidths[width], className)}>
      {children}
    </div>
  );
}

type SectionProps = {
  children: ReactNode;
  tone?: "paper" | "dark";
  divider?: boolean;
  labelledBy?: string;
  className?: string;
};

/** Editorial section: 56px / 64px / 80px vertical rhythm (DESIGN-SYSTEM.md section 3). */
export function Section({
  children,
  tone = "paper",
  divider = false,
  labelledBy,
  className,
}: SectionProps) {
  const dark = tone === "dark";
  return (
    <section
      aria-labelledby={labelledBy}
      className={cn(
        dark ? "bg-dark-surface text-dark-copy" : "bg-paper text-ink",
        divider && !dark && "border-t border-line-soft",
        className,
      )}
      data-surface={dark ? "dark" : undefined}
    >
      <Container className="py-14 sm:py-16 lg:py-20">{children}</Container>
    </section>
  );
}
