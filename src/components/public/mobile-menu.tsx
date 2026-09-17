"use client";

// Adapted from Paperframe `MobileMenu` (MIT), see THIRD_PARTY_NOTICES.md.
// Adds keyboard and assistive-technology support (DESIGN-SYSTEM.md deviation D3).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { MENU_INERT_TARGET } from "@/components/public/menu-inert";
import { isCurrentSection } from "@/components/public/nav-links";
import type { NavItem } from "@/lib/site/config";
import { siteConfig } from "@/lib/site/config";
import { cn } from "@/lib/utils/cn";

const DESKTOP_QUERY = "(min-width: 48rem)";

type MobileMenuProps = {
  navigation: readonly NavItem[];
};

export function MobileMenu({ navigation }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const pathname = usePathname();
  const [menuPathname, setMenuPathname] = useState(pathname);

  // Close when navigation completes (render-time state adjustment, no effect needed).
  if (pathname !== menuPathname) {
    setMenuPathname(pathname);
    setOpen(false);
  }

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      toggleRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";

    const inertTargets = Array.from(
      document.querySelectorAll<HTMLElement>(`[${MENU_INERT_TARGET}]`),
    );
    for (const element of inertTargets) {
      element.inert = true;
    }

    firstLinkRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onViewportChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        close(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onViewportChange);

    return () => {
      root.style.overflow = previousOverflow;
      for (const element of inertTargets) {
        element.inert = false;
      }
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onViewportChange);
    };
  }, [open, close]);

  const bar =
    "block h-0.5 w-6 bg-current transition-transform duration-300 motion-reduce:transition-none";

  return (
    <>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        className={cn(
          "relative z-50 -mr-2 flex h-11 w-11 flex-col items-center justify-center gap-1.5 md:hidden",
          open ? "text-white" : "text-ink",
        )}
        onClick={() => setOpen((value) => !value)}
        ref={toggleRef}
        type="button"
      >
        <span aria-hidden="true" className={cn(bar, open && "translate-y-2 rotate-45")} />
        <span aria-hidden="true" className={cn(bar, "transition-opacity", open && "opacity-0")} />
        <span aria-hidden="true" className={cn(bar, open && "-translate-y-2 -rotate-45")} />
      </button>

      <div
        aria-hidden={!open}
        aria-label="Site menu"
        className={cn(
          "fixed inset-0 z-40 bg-dark-surface transition-opacity duration-300 motion-reduce:transition-none md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        data-surface="dark"
        id={panelId}
        inert={!open}
        role="dialog"
        aria-modal={open}
      >
        <div className="flex h-14 items-center px-4 sm:px-6">
          <Link
            className="inline-flex min-h-10 items-center font-serif text-lg font-semibold tracking-tight text-white"
            href="/"
            onClick={() => close(false)}
          >
            {siteConfig.name}
          </Link>
        </div>
        <nav
          aria-label="Primary"
          className="flex h-[calc(100%-3.5rem)] flex-col overflow-y-auto px-6 pb-12 pt-10"
        >
          <div className="mb-6 font-mono text-[11px] uppercase tracking-[0.24em] text-dark-subtle">
            Menu
          </div>
          <ul className="space-y-2">
            {navigation.map((item, index) => (
              <li key={item.href}>
                <Link
                  aria-current={isCurrentSection(pathname, item.href) ? "page" : undefined}
                  className="group flex min-h-14 items-baseline justify-between gap-4 border-b border-dark-line py-4 transition-colors hover:border-dark-subtle"
                  href={item.href}
                  onClick={() => close(false)}
                  ref={index === 0 ? firstLinkRef : undefined}
                >
                  <span className="font-serif text-3xl text-dark-copy transition-colors group-hover:text-white">
                    {item.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className="font-mono text-[10px] uppercase tracking-[0.24em] text-dark-subtle"
                  >
                    Open
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
