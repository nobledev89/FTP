// Adapted from Paperframe `SiteFooter` (MIT), see THIRD_PARTY_NOTICES.md.
import Link from "next/link";

import type { NavItem } from "@/lib/site/config";
import { siteConfig } from "@/lib/site/config";

type SiteFooterProps = {
  links: readonly NavItem[];
  year: number;
};

export function SiteFooter({ links, year }: SiteFooterProps) {
  return (
    <footer className="border-t border-line-soft bg-paper">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="font-serif text-2xl font-semibold text-ink">{siteConfig.name}</div>
            <p className="mt-3 max-w-xl text-sm leading-7 text-muted">{siteConfig.description}</p>
          </div>
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              {links.map((item) => (
                <li key={item.href}>
                  <Link
                    className="inline-flex min-h-10 items-center font-mono text-[11px] uppercase tracking-[0.24em] text-subtle transition-colors hover:text-ink"
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mt-10 flex flex-col gap-3 border-t border-line-soft pt-6 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8">
          <p className="max-w-2xl text-xs leading-5 text-muted">{siteConfig.disclosure}</p>
          <p className="shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-subtle">
            © {year} {siteConfig.name}
          </p>
        </div>
      </div>
    </footer>
  );
}
