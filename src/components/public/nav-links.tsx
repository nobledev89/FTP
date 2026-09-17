"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavItem } from "@/lib/site/config";

/** True when `pathname` is the nav target or one of its descendants. */
export function isCurrentSection(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

type NavLinksProps = {
  navigation: readonly NavItem[];
};

export function NavLinks({ navigation }: NavLinksProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
      {navigation.map((item) => {
        const current = isCurrentSection(pathname, item.href);
        return (
          <Link
            aria-current={current ? "page" : undefined}
            className="group inline-flex min-h-10 items-center"
            href={item.href}
            key={item.href}
          >
            <span
              className={
                current
                  ? "border-b border-ink pb-1 text-[11px] uppercase tracking-[0.18em] text-ink"
                  : "border-b border-transparent pb-1 text-[11px] uppercase tracking-[0.18em] text-subtle transition-colors group-hover:border-line group-hover:text-ink"
              }
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
