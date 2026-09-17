// Builds the app against the running local Supabase stack and runs the authenticated admin
// end-to-end suite. Separate from `pnpm test:e2e` because it needs a database and the service-role
// key, which only ever exists on a developer machine or inside the CI database job.
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();

function supabaseStatus() {
  const cli = path.join(root, "node_modules", "supabase", "dist", "supabase.js");
  const result = spawnSync(process.execPath, [cli, "status", "-o", "json"], {
    cwd: root,
    encoding: "utf8",
  });
  const start = result.stdout.indexOf("{");
  if (result.status !== 0 || start < 0) {
    process.stderr.write(result.stderr || "");
    process.stderr.write("Local Supabase is not running. Start it with `pnpm supabase:start`.\n");
    process.exit(1);
  }
  return JSON.parse(result.stdout.slice(start));
}

const status = supabaseStatus();

// Build-time values: NEXT_PUBLIC_* are inlined by `next build`, so they have to be set here.
process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3100";
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY;
process.env.SUPABASE_URL = status.API_URL;

// Test-only values. The service-role key is read by the Playwright fixture to create the accounts
// under test; it is never given to the application, which uses the publishable key alone.
process.env.E2E_SUPABASE_URL = status.API_URL;
process.env.E2E_SUPABASE_SERVICE_KEY = status.SECRET_KEY;
process.env.E2E_SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) {
    process.stderr.write(`${String(result.error.message)}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
const playwright = path.join(root, "node_modules", "@playwright", "test", "cli.js");

run(process.execPath, [next, "build"]);
run(process.execPath, [
  playwright,
  "test",
  "tests/e2e/admin-session.spec.ts",
  ...process.argv.slice(2),
]);
