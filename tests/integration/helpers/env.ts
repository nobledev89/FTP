import { spawnSync } from "node:child_process";
import path from "node:path";

export type LocalSupabase = {
  apiUrl: string;
  dbUrl: string;
  publishableKey: string;
  secretKey: string;
};

let cached: LocalSupabase | undefined;

/**
 * Reads connection details from the running local Supabase stack. Values come from
 * `supabase status`, so tests never need real credentials or a committed `.env` file.
 */
export function localSupabase(): LocalSupabase {
  if (cached) {
    return cached;
  }

  const cli = path.join(process.cwd(), "node_modules", "supabase", "dist", "supabase.js");
  const result = spawnSync(process.execPath, [cli, "status", "-o", "json"], { encoding: "utf8" });
  const jsonStart = result.stdout.indexOf("{");
  if (result.status !== 0 || jsonStart < 0) {
    throw new Error(
      `Local Supabase is not running. Start it with \`pnpm supabase:start\`.\n${result.stderr ?? ""}`,
    );
  }

  const status = JSON.parse(result.stdout.slice(jsonStart)) as Record<string, string | undefined>;
  const read = (key: string) => {
    const value = status[key];
    if (!value) {
      throw new Error(`supabase status did not report ${key}`);
    }
    return value;
  };

  cached = {
    apiUrl: read("API_URL"),
    dbUrl: read("DB_URL"),
    publishableKey: read("PUBLISHABLE_KEY"),
    secretKey: read("SECRET_KEY"),
  };
  return cached;
}
