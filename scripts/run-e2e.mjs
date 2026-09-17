// Builds the app and runs the Playwright suite. A Node script rather than an inline shell command
// so environment variables are set the same way on Windows and Linux.
//
// The admin suite needs the proxy (src/proxy.ts) to run, which it only does when Supabase is
// configured. `NEXT_PUBLIC_*` values are inlined at build time, so they have to be present for
// `next build`, not just for `next start`. Placeholder values are enough: with no session cookie
// the proxy redirects to the login page without ever contacting Supabase, which is exactly the
// behaviour these tests cover. Real credentials are never needed, and never used here.
//
// A local `.env.local` is left to win: a developer running the suite against their own Supabase
// stack should get their own values.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const hasLocalEnv = existsSync(path.join(root, ".env.local"));

const placeholders = {
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e_placeholder_0000000000",
};

if (!hasLocalEnv) {
  for (const [key, value] of Object.entries(placeholders)) {
    process.env[key] ??= value;
  }
} else {
  process.stdout.write("Using .env.local for the end-to-end build.\n");
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) {
    process.stderr.write(`${String(result.error.message)}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
const playwright = path.join(root, "node_modules", "@playwright", "test", "cli.js");

run(process.execPath, [next, "build"]);
run(process.execPath, [playwright, "test", ...process.argv.slice(2)]);
