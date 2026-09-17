import Link from "next/link";

export default function AdminNotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-6">
      <p className="font-mono text-xs text-text-subtle">404</p>
      <h1 className="mt-2 text-xl font-semibold">Admin page not found</h1>
      <p className="mt-2 text-sm text-text-muted">
        This admin route does not exist or you do not have access to it.
      </p>
      <Link className="mt-4 text-sm font-medium text-accent hover:underline" href="/admin">
        Go to the dashboard
      </Link>
    </div>
  );
}
