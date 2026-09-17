// Article typography map (DESIGN-SYSTEM.md section 8). Styles adapted from Paperframe `mdxComponents`
// (MIT), see THIRD_PARTY_NOTICES.md. This is a plain component allowlist, not MDX (ADR 0001):
// Phase 7 passes it to a Markdown renderer with raw HTML disabled.
import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type Props<T extends keyof JSX.IntrinsicElements> = ComponentPropsWithoutRef<T>;

/** Returns link attributes for a Markdown href, or null when the link must render as text. */
export function resolveProseLink(
  href: string | undefined,
): { href: string; external: boolean } | null {
  if (!href) {
    return null;
  }
  const value = href.trim();
  if (value.startsWith("#")) {
    return { href: value, external: false };
  }
  if (value.startsWith("/") && !value.startsWith("//")) {
    return { href: value, external: false };
  }
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return { href: url.href, external: true };
    }
  } catch {
    // Relative paths without a leading slash and malformed URLs are not linked.
  }
  return null;
}

function ProseLink({ href, children }: { href?: string; children?: ReactNode }) {
  const link = resolveProseLink(href);
  if (!link) {
    return <span>{children}</span>;
  }
  return (
    <a
      className="border-b border-line text-inherit transition-colors hover:border-ink hover:text-ink"
      href={link.href}
      {...(link.external ? { rel: "noopener noreferrer nofollow", target: "_blank" } : {})}
    >
      {children}
      {link.external ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </a>
  );
}

export const proseComponents = {
  h2: ({ children, id }: Props<"h2">) => (
    <h2
      className="mt-12 font-serif text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl"
      id={id}
    >
      {children}
    </h2>
  ),
  h3: ({ children, id }: Props<"h3">) => (
    <h3 className="mt-10 font-serif text-2xl font-semibold leading-snug text-ink" id={id}>
      {children}
    </h3>
  ),
  h4: ({ children, id }: Props<"h4">) => (
    <h4 className="mt-8 text-lg font-semibold text-ink" id={id}>
      {children}
    </h4>
  ),
  p: ({ children }: Props<"p">) => <p className="mt-5 text-lg leading-8 text-muted">{children}</p>,
  ul: ({ children }: Props<"ul">) => (
    <ul className="mt-5 list-disc space-y-3 pl-5 text-lg leading-8 text-muted marker:text-subtle">
      {children}
    </ul>
  ),
  ol: ({ children, start }: Props<"ol">) => (
    <ol
      className="mt-5 list-decimal space-y-3 pl-5 text-lg leading-8 text-muted marker:text-subtle"
      start={start}
    >
      {children}
    </ol>
  ),
  li: ({ children }: Props<"li">) => <li className="pl-1">{children}</li>,
  a: ({ children, href }: Props<"a">) => <ProseLink href={href}>{children}</ProseLink>,
  blockquote: ({ children }: Props<"blockquote">) => (
    <blockquote className="mt-8 border-l border-line pl-6 font-serif text-2xl leading-10 text-ink [&>p]:mt-0 [&>p]:font-serif [&>p]:text-2xl [&>p]:leading-10 [&>p]:text-ink">
      {children}
    </blockquote>
  ),
  strong: ({ children }: Props<"strong">) => (
    <strong className="font-semibold text-ink">{children}</strong>
  ),
  em: ({ children }: Props<"em">) => <em className="italic">{children}</em>,
  code: ({ children }: Props<"code">) => (
    <code className="rounded-sm bg-wash px-1.5 py-0.5 font-mono text-[0.95em] text-ink">
      {children}
    </code>
  ),
  pre: ({ children }: Props<"pre">) => (
    <pre className="mt-6 overflow-x-auto border border-line-soft bg-wash p-4 font-mono text-sm leading-6 text-ink [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  hr: () => <hr className="mt-10 border-line-soft" />,
  table: ({ children }: Props<"table">) => (
    <div className="mt-8 overflow-x-auto" role="region" aria-label="Table" tabIndex={0}>
      <table className="w-full border-collapse text-left text-base leading-7 text-muted">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: Props<"thead">) => (
    <thead className="border-b border-line">{children}</thead>
  ),
  tbody: ({ children }: Props<"tbody">) => <tbody>{children}</tbody>,
  tr: ({ children }: Props<"tr">) => <tr className="border-b border-line-soft">{children}</tr>,
  th: ({ children, align }: Props<"th">) => (
    <th
      className={cn(
        "px-3 py-3 font-mono text-[11px] font-normal uppercase tracking-[0.18em] text-subtle first:pl-0",
        align === "right" && "text-right",
      )}
      scope="col"
    >
      {children}
    </th>
  ),
  td: ({ children, align }: Props<"td">) => (
    <td
      className={cn(
        "px-3 py-3 align-top first:pl-0",
        align === "right" && "text-right tabular-nums",
      )}
    >
      {children}
    </td>
  ),
} as const;

export type ProseElement = keyof typeof proseComponents;

type ProseProps = {
  children: ReactNode;
  className?: string;
};

/** Prose column capped at the 46rem measure. The first element never adds top margin. */
export function Prose({ children, className }: ProseProps) {
  return (
    <div className={cn("max-w-prose-measure [&>:first-child]:mt-0", className)}>{children}</div>
  );
}
