"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

type LiveRefreshProps = {
  /** A changing server timestamp lets the control announce when fresh data arrived. */
  serverUpdatedAt: string;
  intervalMs?: number;
};

/**
 * Keeps an operations view fresh without replacing the document or losing local client state.
 * Refreshing pauses with the tab so an unattended dashboard does not create background traffic.
 */
export function LiveRefresh({ serverUpdatedAt, intervalMs = 5_000 }: LiveRefreshProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  const [refreshing, startRefresh] = useTransition();

  const refresh = useCallback(() => {
    if (document.visibilityState === "hidden" || refreshing) return;

    startRefresh(() => router.refresh());
  }, [refreshing, router]);

  useEffect(() => {
    if (!enabled) return;

    const interval = window.setInterval(refresh, intervalMs);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [enabled, intervalMs, refresh]);

  const seconds = Math.max(1, Math.round(intervalMs / 1_000));
  const status = refreshing ? "Updating" : enabled ? `Live · ${seconds}s` : "Updates paused";

  return (
    <div
      className="inline-flex h-8 items-center overflow-hidden rounded-control border border-border bg-panel"
      title={`Latest server update: ${serverUpdatedAt}`}
    >
      <button
        aria-label={enabled ? "Pause live updates" : "Resume live updates"}
        className="flex h-full items-center gap-2 px-2.5 text-xs font-medium text-text-muted hover:bg-neutral-bg hover:text-text"
        onClick={() => setEnabled((current) => !current)}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ${enabled ? "bg-success" : "bg-text-subtle"}`}
        />
        <span aria-live="polite">{status}</span>
      </button>
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      <button
        aria-label="Refresh now"
        className="flex size-8 items-center justify-center text-text-muted hover:bg-neutral-bg hover:text-text disabled:cursor-wait disabled:opacity-60"
        disabled={refreshing}
        onClick={refresh}
        title="Refresh now"
        type="button"
      >
        <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16">
          <path
            d="M13.25 5.5A5.75 5.75 0 1 0 13.5 9M13.25 2v3.5h-3.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        </svg>
      </button>
    </div>
  );
}
