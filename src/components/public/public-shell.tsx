// Adapted from Paperframe `PublicSiteShell` (MIT), see THIRD_PARTY_NOTICES.md.
import type { ReactNode } from "react";

import { menuInertTargetProps } from "@/components/public/menu-inert";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import type { NavItem } from "@/lib/site/config";
import { siteConfig } from "@/lib/site/config";

type PublicShellProps = {
  children: ReactNode;
  navigation?: readonly NavItem[];
  footerLinks?: readonly NavItem[];
};

export function PublicShell({
  children,
  navigation = siteConfig.navigation,
  footerLinks = siteConfig.footerLinks,
}: PublicShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        className="fixed left-4 top-2 z-[60] -translate-y-20 bg-ink px-4 py-2 text-sm font-medium text-paper focus:translate-y-0"
        href="#main-content"
        {...menuInertTargetProps}
      >
        Skip to content
      </a>
      <SiteHeader navigation={navigation} />
      <main
        className="flex-1 pt-14 outline-none"
        id="main-content"
        tabIndex={-1}
        {...menuInertTargetProps}
      >
        {children}
      </main>
      <div {...menuInertTargetProps}>
        <SiteFooter links={footerLinks} year={new Date().getFullYear()} />
      </div>
    </div>
  );
}
