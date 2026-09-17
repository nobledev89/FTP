import type { ReactNode } from "react";

import { Eyebrow } from "@/components/public/meta";

type EmptyStateProps = {
  eyebrow: string;
  title: string;
  children?: ReactNode;
};

/** A restrained empty state: typography and a rule, no illustration or card. */
export function EmptyState({ eyebrow, title, children }: EmptyStateProps) {
  return (
    <div className="border-t border-line pt-8">
      <Eyebrow>{eyebrow}</Eyebrow>
      <p className="mt-4 max-w-2xl font-serif text-3xl leading-snug text-ink">{title}</p>
      {children ? (
        <div className="mt-4 max-w-2xl text-base leading-7 text-muted">{children}</div>
      ) : null}
    </div>
  );
}
