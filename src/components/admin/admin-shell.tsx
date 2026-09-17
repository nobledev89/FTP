import Link from "next/link";
import type { ReactNode } from "react";

export type AdminNavItem = {
  readonly label: string;
  readonly href: string;
};

export const adminNavigation: readonly AdminNavItem[] = [
  { label: "Dashboard", href: "/admin" },
  { label: "New article", href: "/admin/articles/new" },
  { label: "Prompts", href: "/admin/prompts" },
  { label: "Providers", href: "/admin/providers" },
  { label: "Logs", href: "/admin/logs" },
  { label: "Settings", href: "/admin/settings" },
];

type AdminShellProps = {
  children: ReactNode;
  title: string;
  currentHref?: string;
  actions?: ReactNode;
};

/** Persistent sidebar on desktop, disclosure navigation on mobile. No public chrome. */
export function AdminShell({ children, title, currentHref, actions }: AdminShellProps) {
  const links = adminNavigation.map((item) => {
    const current = item.href === currentHref;
    return (
      <li key={item.href}>
        <Link
          aria-current={current ? "page" : undefined}
          className={
            current
              ? "flex h-9 items-center rounded-control bg-neutral-bg px-3 font-medium text-text"
              : "flex h-9 items-center rounded-control px-3 text-text-muted hover:bg-neutral-bg hover:text-text"
          }
          href={item.href}
        >
          {item.label}
        </Link>
      </li>
    );
  });

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[14rem_1fr]">
      <aside className="hidden border-r border-border bg-panel lg:block">
        <div className="sticky top-0 flex h-dvh flex-col">
          <div className="flex h-14 items-center border-b border-border px-4 text-sm font-semibold">
            FinTechPulse <span className="ml-1.5 font-normal text-text-subtle">Admin</span>
          </div>
          <nav aria-label="Admin" className="flex-1 overflow-y-auto p-3">
            <ul className="space-y-0.5">{links}</ul>
          </nav>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-10 border-b border-border bg-panel">
          <div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-6">
            <details className="relative lg:hidden">
              <summary className="flex h-10 cursor-pointer list-none items-center rounded-control border border-border-strong px-3 text-sm font-medium">
                Menu
              </summary>
              <nav
                aria-label="Admin"
                className="absolute left-0 top-12 w-56 rounded-panel border border-border bg-panel p-2"
              >
                <ul className="space-y-0.5">{links}</ul>
              </nav>
            </details>
            <h1 className="truncate text-base font-semibold">{title}</h1>
            <div className="flex items-center gap-2">{actions}</div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
