// Adapted from Paperframe `SiteHeader` (MIT), see THIRD_PARTY_NOTICES.md.
// No backdrop blur (DESIGN-SYSTEM.md deviation D1); 40px navigation targets (D6).
import Link from "next/link";

import { menuInertTargetProps } from "@/components/public/menu-inert";
import { MobileMenu } from "@/components/public/mobile-menu";
import { NavLinks } from "@/components/public/nav-links";
import type { NavItem } from "@/lib/site/config";
import { siteConfig } from "@/lib/site/config";

type SiteHeaderProps = {
  navigation: readonly NavItem[];
};

export function SiteHeader({ navigation }: SiteHeaderProps) {
  const accentWord = "Pulse";
  const brandPrefix = siteConfig.name.endsWith(accentWord)
    ? siteConfig.name.slice(0, -accentWord.length)
    : siteConfig.name;

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-line-soft bg-paper/95">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-signal" />
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          aria-label={siteConfig.name}
          className="inline-flex min-h-10 items-center font-serif text-lg font-semibold tracking-tight text-ink transition-colors hover:text-muted"
          href="/"
          {...menuInertTargetProps}
        >
          <span aria-hidden="true">{brandPrefix}</span>
          {brandPrefix !== siteConfig.name ? (
            <span aria-hidden="true" className="text-signal">
              {accentWord}
            </span>
          ) : null}
        </Link>
        <NavLinks navigation={navigation} />
        <MobileMenu navigation={navigation} />
      </div>
    </header>
  );
}
