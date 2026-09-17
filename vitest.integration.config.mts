import { defineConfig } from "vitest/config";

// Integration tests run against the local Supabase stack (`pnpm supabase:start`). Files share one
// database, so they run sequentially and each file resets workflow data first.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: "integration",
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
