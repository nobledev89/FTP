"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Segment error boundary. The message is Next.js's redacted production digest, not the underlying
 * database error: admin errors can quote provider output and worker paths, which stay on the
 * server. `digest` is the handle for finding the full entry in the server log.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("admin route error", { digest: error.digest });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center p-6">
      <div className="rounded-panel border border-border bg-panel p-6">
        <p className="font-mono text-xs text-text-subtle">Error</p>
        <h1 className="mt-2 text-xl font-semibold">This page could not be loaded</h1>
        <p className="mt-2 text-sm text-text-muted">
          The request failed before the page finished rendering. Nothing was changed.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-text-subtle">digest {error.digest}</p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            className="flex h-8 items-center rounded-control bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"
            onClick={reset}
            type="button"
          >
            Try again
          </button>
          <Link
            className="flex h-8 items-center rounded-control border border-border-strong bg-panel px-3 text-sm font-medium hover:bg-neutral-bg"
            href="/admin"
          >
            Back to the dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
