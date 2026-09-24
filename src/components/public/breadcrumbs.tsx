import Link from "next/link";

import { JsonLd } from "@/components/public/json-ld";
import { breadcrumbList, type BreadcrumbItem } from "@/lib/site/structured-data";

type BreadcrumbsProps = {
  /** Home is added automatically; the last item is the current page. */
  items: readonly BreadcrumbItem[];
};

/** Visible trail plus matching `BreadcrumbList` markup, so the two can never disagree. */
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  const trail: readonly BreadcrumbItem[] = [{ name: "Home", href: "/" }, ...items];
  return (
    <>
      <JsonLd data={breadcrumbList(trail)} />
      <nav aria-label="Breadcrumb" className="mb-8">
        <ol className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
          {trail.map((item, index) => {
            const current = index === trail.length - 1;
            return (
              <li className="flex items-baseline gap-x-2" key={item.href}>
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                {current ? (
                  <span aria-current="page" className="max-w-[28ch] truncate text-muted">
                    {item.name}
                  </span>
                ) : (
                  <Link
                    className="inline-flex min-h-10 items-center border-b border-transparent transition-colors hover:border-line hover:text-ink sm:min-h-0"
                    href={item.href}
                  >
                    {item.name}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
