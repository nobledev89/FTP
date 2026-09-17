import Link from "next/link";

type PaginationProps = {
  page: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
};

/** Text-link archive pagination: newer on the left, older on the right. */
export function Pagination({ page, totalPages, hrefForPage }: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const linkClass =
    "group inline-flex min-h-10 items-center font-mono text-[11px] uppercase tracking-[0.24em] text-muted";
  const labelClass =
    "border-b border-line pb-1 transition-colors group-hover:border-ink group-hover:text-ink";

  return (
    <nav
      aria-label="Pagination"
      className="mt-10 flex items-center justify-between gap-4 border-t border-line pt-6"
    >
      <div className="min-w-24">
        {page > 1 ? (
          <Link className={linkClass} href={hrefForPage(page - 1)} rel="prev">
            <span className={labelClass}>Newer</span>
          </Link>
        ) : null}
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
        Page {page} of {totalPages}
      </p>
      <div className="flex min-w-24 justify-end">
        {page < totalPages ? (
          <Link className={linkClass} href={hrefForPage(page + 1)} rel="next">
            <span className={labelClass}>Older</span>
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
