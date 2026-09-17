import Link from "next/link";
import type { ReactNode } from "react";

import { pageHref, type Paged } from "@/lib/admin/pagination";

/**
 * Dense table primitives (36px rows, 13px text) and the server-rendered pager they use. Navigation
 * is plain links, so a filtered page is shareable and works without JavaScript.
 */

export function Table({
  children,
  minWidth = "48rem",
}: {
  children: ReactNode;
  minWidth?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ columns }: { columns: readonly string[] }) {
  return (
    <thead className="border-b border-border bg-canvas text-xs text-text-muted">
      <tr>
        {columns.map((column) => (
          <th className="h-9 px-4 font-medium whitespace-nowrap" key={column} scope="col">
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function TableRow({ children }: { children: ReactNode }) {
  return <tr className="border-b border-border last:border-0 hover:bg-canvas">{children}</tr>;
}

type CellProps = {
  children: ReactNode;
  /** `mono` for identifiers and timestamps, `muted` for secondary text. */
  variant?: "default" | "mono" | "muted" | "strong";
  nowrap?: boolean;
};

const CELL_VARIANTS = {
  default: "",
  mono: "font-mono text-xs text-text-muted",
  muted: "text-text-muted",
  strong: "font-medium",
} as const satisfies Record<NonNullable<CellProps["variant"]>, string>;

export function Cell({ children, variant = "default", nowrap = false }: CellProps) {
  return (
    <td
      className={`h-9 px-4 align-middle ${CELL_VARIANTS[variant]} ${nowrap ? "whitespace-nowrap" : ""}`}
    >
      {children}
    </td>
  );
}

type PagerProps = {
  basePath: string;
  params: Readonly<Record<string, string | undefined>>;
  result: Paged<unknown>;
  /** Plural noun for the count line, for example "jobs". */
  noun: string;
};

/** Previous/next pager with an explicit position, so the page is never a mystery. */
export function Pager({ basePath, params, result, noun }: PagerProps) {
  const { page, pageCount, total, pageSize, items } = result;
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = (page - 1) * pageSize + items.length;

  const linkClass =
    "flex h-8 items-center rounded-control border border-border-strong px-3 text-sm font-medium hover:bg-neutral-bg";
  const disabledClass =
    "flex h-8 items-center rounded-control border border-border px-3 text-sm font-medium text-text-subtle";

  return (
    <nav
      aria-label={`${noun} pagination`}
      className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3"
    >
      <p className="text-xs text-text-muted">
        {total === null
          ? `Showing ${items.length} ${noun}`
          : `${firstRow}–${lastRow} of ${total} ${noun}`}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={linkClass} href={pageHref(basePath, params, page - 1)} rel="prev">
            Previous
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>
            Previous
          </span>
        )}
        <span className="font-mono text-xs text-text-subtle">
          {page} / {pageCount}
        </span>
        {page < pageCount ? (
          <Link className={linkClass} href={pageHref(basePath, params, page + 1)} rel="next">
            Next
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>
            Next
          </span>
        )}
      </div>
    </nav>
  );
}

type FilterTabsProps = {
  label: string;
  basePath: string;
  params: Readonly<Record<string, string | undefined>>;
  paramName: string;
  options: ReadonlyArray<readonly [value: string, label: string]>;
  current: string;
};

/** Filter selection as links: `aria-current` marks the active one for assistive technology. */
export function FilterTabs({
  label,
  basePath,
  params,
  paramName,
  options,
  current,
}: FilterTabsProps) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-1.5">
        {options.map(([value, optionLabel]) => {
          const active = value === current;
          const search = new URLSearchParams();
          for (const [key, entry] of Object.entries(params)) {
            if (key !== paramName && key !== "page" && entry) search.set(key, entry);
          }
          if (value) search.set(paramName, value);
          const query = search.toString();
          return (
            <li key={value || "all"}>
              <Link
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "flex h-8 items-center rounded-control border border-border-strong bg-neutral-bg px-3 text-xs font-medium text-text"
                    : "flex h-8 items-center rounded-control border border-border px-3 text-xs font-medium text-text-muted hover:bg-neutral-bg hover:text-text"
                }
                href={query ? `${basePath}?${query}` : basePath}
              >
                {optionLabel}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
