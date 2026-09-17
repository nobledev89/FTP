/**
 * Segment-wide loading state. Admin pages are request-time reads against Supabase, so the shell
 * appears immediately while the data resolves. Skeleton blocks are static: no animation, to respect
 * `prefers-reduced-motion` without a media query.
 */
export default function AdminLoading() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[14rem_1fr]">
      <aside className="hidden border-r border-border bg-panel lg:block">
        <div className="flex h-14 items-center border-b border-border px-4 text-sm font-semibold">
          FinTechPulse <span className="ml-1.5 font-normal text-text-subtle">Admin</span>
        </div>
      </aside>
      <div>
        <header className="border-b border-border bg-panel">
          <div className="flex h-14 items-center px-4 lg:px-6">
            <p className="text-base font-semibold text-text-muted" role="status">
              Loading…
            </p>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl p-4 lg:p-6">
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <div
                  className="h-[4.5rem] rounded-panel border border-border bg-panel"
                  key={index}
                />
              ))}
            </div>
            <div className="h-64 rounded-panel border border-border bg-panel" />
          </div>
        </main>
      </div>
    </div>
  );
}
