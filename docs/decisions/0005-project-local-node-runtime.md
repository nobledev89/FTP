# ADR 0005: Project-local Node 24 runtime via pnpm

- Status: Accepted
- Date: 2026-09-17

## Context

The plan's environment snapshot recorded Node 20.19.4. The owner's PC actually has Node 20.15.1 at
`D:\NodeJS`, with no version manager, and other projects on the machine depend on it. Node 20 reached
end of life in April 2026. Current tooling needs a newer runtime: ESLint 10 requires Node 20.19 or
later, and Vitest 5 requires Node 22.12 or later. Vercel supports Node 24.

## Decision

- The project targets Node 24 LTS (`24.21.0`, released 2026-09-07).
- `pnpm-workspace.yaml` sets `useNodeVersion: 24.21.0`. pnpm downloads that runtime and uses it for
  every `pnpm <script>`, without changing the system Node.
- `.nvmrc` and `package.json#engines` (`24.x`) record the same version for CI and Vercel.
- ESLint stays on version 9, the major version that the Next.js 16.3.5 scaffold pairs with
  `eslint-config-next`, until that config officially supports ESLint 10.
- TypeScript stays on 5.x because `typescript-eslint` does not yet support TypeScript 7.

## Consequences

- Always run tools through `pnpm` (for example `pnpm exec supabase`), not a global `node` or `npx`, so
  the pinned runtime is used.
- Editor extensions that start their own Node process (ESLint, TypeScript) still use the system Node.
  This affects only editor tooling, not builds or tests.
- Upgrading Node means changing three places: `pnpm-workspace.yaml`, `.nvmrc`, and `engines`.
