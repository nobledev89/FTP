import type { ReactNode } from "react";

/**
 * Admin surface primitives. Flat panels with a 1px border and a 6px radius; no shadows, no blur
 * (docs/DESIGN-SYSTEM.md section 10).
 */

type PanelProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  /** Renders the body without padding, for tables that reach the panel edge. */
  flush?: boolean;
  children: ReactNode;
};

export function Panel({ title, description, actions, flush = false, children }: PanelProps) {
  return (
    <section className="overflow-hidden rounded-panel border border-border bg-panel">
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 xl:grid-cols-2">{children}</div>;
}

type StatTileProps = {
  label: string;
  value: string;
  hint?: string;
  href?: string;
};

/** A single number with its label. The number is never the only thing that carries the meaning. */
export function StatTile({ label, value, hint }: StatTileProps) {
  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-text-muted">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-control border border-dashed border-border px-3 py-6 text-center text-sm text-text-muted">
      {children}
    </p>
  );
}

type NoticeProps = {
  tone: "info" | "warning" | "danger" | "success";
  children: ReactNode;
};

const NOTICE_CLASSES = {
  info: "border-info/25 bg-info-bg text-info",
  warning: "border-warning/25 bg-warning-bg text-warning",
  danger: "border-danger/25 bg-danger-bg text-danger",
  success: "border-success/25 bg-success-bg text-success",
} as const satisfies Record<NoticeProps["tone"], string>;

export function Notice({ tone, children }: NoticeProps) {
  return (
    <p className={`rounded-panel border px-3 py-2 text-xs ${NOTICE_CLASSES[tone]}`}>{children}</p>
  );
}

type DefinitionListProps = {
  items: ReadonlyArray<readonly [string, ReactNode]>;
  columns?: 1 | 2 | 3;
};

const COLUMN_CLASSES = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
} as const satisfies Record<NonNullable<DefinitionListProps["columns"]>, string>;

export function DefinitionList({ items, columns = 2 }: DefinitionListProps) {
  return (
    <dl className={`grid gap-3 ${COLUMN_CLASSES[columns]}`}>
      {items.map(([term, value]) => (
        <div key={term}>
          <dt className="text-xs font-medium uppercase tracking-wide text-text-subtle">{term}</dt>
          <dd className="mt-0.5 text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Pre-formatted JSON for artifacts and log summaries. Scrolls rather than stretching the layout. */
export function JsonBlock({ value, label }: { value: unknown; label?: string }) {
  return (
    <figure>
      {label ? (
        <figcaption className="mb-1 text-xs font-medium uppercase tracking-wide text-text-subtle">
          {label}
        </figcaption>
      ) : null}
      <pre className="max-h-96 overflow-auto rounded-control border border-border bg-canvas p-3 font-mono text-[11px] leading-relaxed text-text-muted">
        {JSON.stringify(value, null, 2)}
      </pre>
    </figure>
  );
}
