import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ADR 0004: public and admin share no components or styles.
// Matches alias, deep relative, and sibling-relative imports of the other system.
const publicModules = String.raw`(^|/)components/public(/|$)|(^|/)styles/public|^(\.\./)+public(/|$)`;
const adminModules = String.raw`(^|/)components/admin(/|$)|(^|/)styles/admin|^(\.\./)+admin(/|$)`;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/(admin)/**", "src/components/admin/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: publicModules,
              message:
                "Admin code must not import public publication components or styles (ADR 0004).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/(public)/**", "src/app/global-not-found.tsx", "src/components/public/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: adminModules,
              message: "Public code must not import admin components or styles (ADR 0004).",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Project ignores.
    ".reference/**",
    "coverage/**",
    "local-worker/dist/**",
    "playwright-report/**",
    "test-results/**",
    "src/lib/supabase/database.types.ts",
  ]),
]);

export default eslintConfig;
