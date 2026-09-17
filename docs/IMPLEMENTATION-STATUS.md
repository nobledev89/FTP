# FinTechPulse — Implementation Status

This is the authoritative live record of implementation progress. Update it immediately whenever a task, meaningful subtask, verification gate, phase, or milestone changes status.

## Current state

| Field                  | Value                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| Overall implementation | `IN_PROGRESS`                                                     |
| Current phase          | Phase 2 — Supabase schema and security (Phase 1 awaiting owner design sign-off) |
| Current task           | Initialize Supabase local configuration and ordered migrations    |
| Last updated           | 2026-09-17 18:52, Asia/Singapore                                  |
| Branch                 | `main` (local; not yet pushed to `origin`)                        |
| Relevant commit        | `a86d8d4` Phase 0; Phase 1 commit hash recorded in the next log entry |
| Active blockers        | None for Phase 2. Phase 1 exit needs the owner's design review of the fixture pages. |
| Next action            | Run `supabase init` and write the extensions/enums migration      |

## Status legend

- `NOT_STARTED`: no implementation work has begun.
- `IN_PROGRESS`: work has begun but its acceptance evidence is incomplete.
- `BLOCKED`: work cannot continue until a named dependency or decision is resolved.
- `DEFERRED`: intentionally moved out of the current delivery scope, with a reason recorded.
- `COMPLETE`: implementation and required verification are both complete.

## Phase summary

| Phase | Scope                                              | Status        | Progress | Completed | Evidence summary |
| ----: | -------------------------------------------------- | ------------- | -------: | --------- | ---------------- |
|     0 | Repository and architecture baseline               | `COMPLETE`    |     100% | 2026-09-17 | Local gate passed: frozen install, format, lint, typecheck, 4 unit tests, build. GitHub CI not yet run (not pushed). Commit `a86d8d4`. |
|     1 | Paperframe design lock                             | `IN_PROGRESS` |      90% | —         | Implemented; 29 unit tests and 40 Playwright checks pass at 375/768/1024/1440px; agent visual review done; production build 404s fixture routes. Owner design sign-off pending. |
|     2 | Supabase schema and security                       | `IN_PROGRESS` |       0% | —         | —                |
|     3 | Domain services and state machine                  | `NOT_STARTED` |       0% | —         | —                |
|     4 | Authentication and admin shell                     | `NOT_STARTED` |       0% | —         | —                |
|     5 | Local worker and queue safety                      | `NOT_STARTED` |       0% | —         | —                |
|     6 | Mock pipeline end to end                           | `NOT_STARTED` |       0% | —         | —                |
|     7 | Public publication                                 | `NOT_STARTED` |       0% | —         | —                |
|     8 | Manual provider workflows                          | `NOT_STARTED` |       0% | —         | —                |
|     9 | Subscription CLI providers                         | `NOT_STARTED` |       0% | —         | —                |
|    10 | Optional API adapters                              | `NOT_STARTED` |       0% | —         | —                |
|    11 | Publishing, scheduling, and verification hardening | `NOT_STARTED` |       0% | —         | —                |
|    12 | Operations, documentation, and release QA          | `NOT_STARTED` |       0% | —         | —                |

## Active phase checklist

### Phase 1 — Paperframe design lock

- [x] Write `docs/DESIGN-SYSTEM.md` with the section 6 rules, citing Paperframe `c4a9042` and recording deviations (D1–D13).
- [x] Split `src/app` into `(public)` and `(admin)` route groups with separate root layouts, fonts, and stylesheets.
- [x] Port/adapt public shell primitives: typography loading, header, mobile menu, footer, section heading, article image, stream list, rich-copy component map.
- [x] Build public fixture pages (home, archive, article) for desktop/mobile review without MDX.
- [x] Establish the admin token sheet and layout.
- [x] Enforce public/admin import separation with lint rules.
- [x] Add Paperframe MIT attribution to adapted files.
- [x] Run the gate and record design-review evidence at 375/768/1024/1440px.
- [ ] Owner design review of `/design-review`, `/design-review/archive`, `/design-review/article`, and `/admin/design-review` (run `pnpm test:e2e` for screenshots in `test-results/design-review/`). After sign-off, store approved baselines and mark Phase 1 `COMPLETE`.

### Phase 2 — Supabase schema and security

- [ ] Initialize Supabase local configuration and ordered migrations.
- [ ] Create enums, all required/supporting tables, constraints, indexes, triggers, transition/publish/claim RPCs, and seed data.
- [ ] Configure Auth assumptions and `admin_users` bootstrap instructions.
- [ ] Add RLS and Storage bucket policies.
- [ ] Generate TypeScript database types.
- [ ] Add migration and RLS integration tests against local Supabase.
- [ ] Verify a fresh reset applies all migrations and anonymous/admin/worker access tests pass.

## Blockers and decisions

- **Push to GitHub pending owner confirmation.** `origin` is configured and SSH authentication to GitHub works, but nothing has been pushed yet. The first push publishes the repository contents.
- **Decision: project-local Node 24.** The PC has Node 20.15.1 (not the 20.19.4 in the plan snapshot), and Node 20 is end-of-life. pnpm `useNodeVersion: 24.21.0` runs every script on Node 24 without changing the system Node. See `docs/decisions/0005-project-local-node-runtime.md`.
- **Decision: ESLint 9 and TypeScript 5.9.** Kept at the versions `create-next-app@16.3.5` pairs with `eslint-config-next`; ESLint 10 and TypeScript 7 are not yet supported by that config or by `typescript-eslint`.
- **Decision: `(public)` and `(admin)` route groups.** The admin lives at `src/app/(admin)/admin/**`, not `src/app/admin/**`, so each group has its own root layout (ADR 0004). URLs are unchanged.
- **Decision: design fixtures live at `/design-review/*` and `/admin/design-review`,** not at `/`, `/blog`, or `/blog/[slug]`. Real routes are built from Supabase in Phase 7, and `/` shows an honest empty state until then. Fixture routes return 404 when `VERCEL_ENV=production` (verified with a production build).
- **Decision: masthead mobile size is fluid (deviation D13).** At the plan's fixed 60px, "FinTechPulse" is 382px wide and overflowed the 343px column at 375px. It now uses `clamp(2.5rem, 14vw, 3.75rem)` below 640px; larger sizes are unchanged.
- **Decision: no automatic hyphenation in headings.** `hyphens: auto` split headline words mid-word at desktop widths; `overflow-wrap: break-word` alone prevents overflow.
- **Decision: `experimental.globalNotFound` enabled.** Needed for a styled 404 on unmatched URLs with two root layouts. It is an experimental Next.js flag; re-check on Next.js upgrades.

## Completion log

### 2026-09-17 — Phase 1 design lock implemented; owner sign-off pending

Date/time: 2026-09-17 18:52, Asia/Singapore  
Phase/task: Phase 1 — Paperframe design lock  
Status change: Phase 1 `IN_PROGRESS` 0% → `IN_PROGRESS` 90% (implementation and automated/agent review complete; owner sign-off pending); Phase 2 `NOT_STARTED` → `IN_PROGRESS`  
What changed: Wrote `docs/DESIGN-SYSTEM.md` (typography scale, widths, colour tokens with measured contrast, images, navigation, motion, article typography map, page composition, admin tokens, verification checklist, deviations D1–D13 from Paperframe `c4a9042`). Replaced the scaffold root layout with `(public)` and `(admin)` route groups, each with its own root layout, fonts, and Tailwind entry that scans only its own sources; added `global-not-found.tsx`. Built public components adapted from Paperframe with MIT attribution headers: shell with skip link, header without blur, accessible mobile menu (inert background, Escape, focus management, scroll lock, closes on navigation and at 768px), footer with publication disclosure, section heading, article image (16:9, 4:5, 3:2, placeholder), stream list, featured story, masthead, latest stream, page header, article header with byline and dates, disclosure note, structured source list, related cards, pagination, empty state, 404 content, and a Markdown-ready prose component map with a link allowlist. Public Tailwind theme removes the default palette, shadows, blur, and radii above 4px. Added fixture pages at `/design-review`, `/design-review/archive`, and `/design-review/article` (with `?state=empty`, `?page=2`, `?hero=3-2`, `?hero=none` variants) and the admin token sheet at `/admin/design-review`; all are noindex and 404 in Vercel production. Added `siteConfig` (en-GB, Europe/London, GBP, canonical origin) and UK date formatting. Added ESLint `no-restricted-imports` regex rules that block public↔admin imports (alias, deep relative, and sibling relative). Added a design guard test, admin token contrast test, mobile menu jsdom tests, prose link and nav tests, Playwright design-review checks, a Playwright CI job, and `pnpm test:e2e`. Replaced the Next.js favicon with a FinTechPulse icon.  
Files/migrations affected: `docs/DESIGN-SYSTEM.md`, `src/app/(public)/**`, `src/app/(admin)/**`, `src/app/global-not-found.tsx`, `src/app/icon.svg` (removed `src/app/layout.tsx`, `page.tsx`, `globals.css`, `favicon.ico`), `src/components/public/**`, `src/components/admin/**`, `src/lib/design/contrast.ts`, `src/lib/format/date.ts`, `src/lib/site/config.ts`, `src/lib/utils/cn.ts`, `src/styles/**`, `public/design-review/*.svg`, `tests/e2e/design-review.spec.ts`, `playwright.config.ts`, `next.config.ts`, `eslint.config.mjs`, `.github/workflows/ci.yml`, `package.json`, `pnpm-lock.yaml`, `.prettierignore`; no migrations.  
Verification performed: `pnpm install --frozen-lockfile` (ok); `pnpm format:check` (clean); `pnpm lint` (0 problems); deliberate boundary violations in admin and public files produced 4 `no-restricted-imports` errors, then were removed; `pnpm typecheck` (clean); `pnpm test` (7 files, 29 tests passed); `pnpm test:e2e` (production build plus 40 Playwright checks passed: no horizontal overflow, 56px fixed header, serif H1 font, header clearance, admin without public chrome at 375/768/1024/1440px; mobile menu keyboard and inert behaviour; inline navigation from 768px; reduced motion; unmatched URL returns 404). The first e2e run found 23px horizontal overflow at 375px from the masthead; fixed (D13) and re-verified. Agent visual review of screenshots (home 375/1440, article 375/1440, mobile menu open 375, admin 1440) found mid-word headline hyphenation (fixed) and confirmed the settled menu overlay is opaque. `VERCEL_ENV=production pnpm build` plus `next start`: `/` 200; `/design-review`, `/design-review/article`, `/admin/design-review`, and an unmatched URL all 404.  
Result: Passed locally. Phase 1 exit criterion ("design-system review confirms…") still needs the owner's review.  
Commit/PR: Local commit `feat: phase 1 paperframe design lock` on `main`; Phase 0 commit is `a86d8d4`. Not pushed.  
Next action: Initialize Supabase local configuration and write ordered migrations (Phase 2).

### 2026-09-17 — Phase 0 repository and architecture baseline complete

Date/time: 2026-09-17 18:13, Asia/Singapore  
Phase/task: Phase 0 — Repository and architecture baseline  
Status change: Phase 0 `NOT_STARTED` → `COMPLETE`; Phase 1 `NOT_STARTED` → `IN_PROGRESS`; overall `NOT_STARTED` → `IN_PROGRESS`  
What changed: Initialized Git on `main` with `origin` set to `git@github.com:nobledev89/FTP.git`. Scaffolded Next.js 16.3.5 (App Router, TypeScript, Tailwind 4, ESLint, `src/`, React Compiler) with `create-next-app@16.3.5`. Created the pnpm workspace (root app plus `@fintechpulse/local-worker`). Pinned Node 24.21.0 through pnpm `useNodeVersion`, `.nvmrc`, and `engines`. Added `.gitignore` (excludes `.env*` except `.env.example`, `.reference/`, and Supabase local state), `.gitattributes` (LF), `.editorconfig`, Prettier, a `next typegen`-backed typecheck, and Vitest projects for web and worker. Added a Zod-validated worker environment contract (plan section 15) with unit tests. Added GitHub Actions CI (frozen install, format check, lint, typecheck, test, build). Added `ARCHITECTURE.md`, ADRs 0001–0005, `THIRD_PARTY_NOTICES.md` (Paperframe MIT text), `LICENSE`, `README.md`, and an annotated `.env.example`. Cloned Paperframe at `c4a904200dc39fbffd8adaac5c726886d8893ac9` into the git-ignored `.reference/paperframe` for the design lock.  
Pinned versions: pnpm 10.32.1; Node 24.21.0; next 16.3.5; react/react-dom 19.2.8; tailwindcss 4.3.3; typescript 5.9.3; eslint 9.39.5; eslint-config-next 16.3.5; vitest 5.0.1; prettier 3.9.7; zod 4.6.5; tsx 4.23.13; @types/node 24.13.5. Exact resolutions are in `pnpm-lock.yaml`.  
Files/migrations affected: `.editorconfig`, `.env.example`, `.gitattributes`, `.github/workflows/ci.yml`, `.gitignore`, `.nvmrc`, `.prettierignore`, `.prettierrc.json`, `AGENTS.md`, `CLAUDE.md`, `LICENSE`, `README.md`, `THIRD_PARTY_NOTICES.md`, `docs/ARCHITECTURE.md`, `docs/decisions/*`, `eslint.config.mjs`, `local-worker/**`, `next.config.ts`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `postcss.config.mjs`, `src/app/*`, `tsconfig.json`, `vitest.config.mts`; no migrations.  
Verification performed: `pnpm install --frozen-lockfile` (ok); `pnpm format:check` (all files formatted); `pnpm lint` (0 problems); `pnpm typecheck` (route types generated; web and worker `tsc --noEmit` clean); `pnpm test` (1 file, 4 tests passed); `pnpm build` (compiled, static `/` and `/_not-found`). `git status` reviewed before staging: no `.env*` files, credentials, `.next`, `node_modules`, or `.reference` content staged. GitHub CI has not run because nothing has been pushed.  
Result: Passed locally.  
Commit/PR: Local commit `chore: phase 0 repository and architecture baseline` on `main`; not pushed.  
Next action: Write `docs/DESIGN-SYSTEM.md` from the frozen Paperframe snapshot.

### 2026-09-17 — UK publication identity and domain locked

Date/time: 2026-09-17, Asia/Singapore  
Phase/task: Pre-implementation product planning  
Status change: Publication positioning and production-domain requirements completed; implementation remains `NOT_STARTED`  
What changed: Defined FinTechPulse as a UK-first financial and fintech publication, set `https://fintechpulse.co.uk` as the canonical origin, and added UK locale, timezone, currency, sourcing, trust, disclosure, SEO, Vercel, and Cloudflare requirements.  
Files/migrations affected: `docs/IMPLEMENTATION-PLAN.md`, `docs/IMPLEMENTATION-STATUS.md`  
Verification performed: Confirmed the plan contains the production domain, `en-GB`, `Europe/London`, GBP, canonical-domain handling, UK-first editorial remit, authoritative-source guidance, and financial-information safeguards.  
Result: Passed; product scope is documented and no implementation work has started.  
Commit/PR: None; the local workspace is not yet a Git repository.  
Next action: Start Phase 0 by reviewing exclusions, initializing Git, and scaffolding the pinned pnpm/Next.js baseline.

### 2026-09-17 — Planning records created

Date/time: 2026-09-17, Asia/Singapore  
Phase/task: Pre-implementation planning  
Status change: Planning documentation completed; implementation remains `NOT_STARTED`  
What changed: Created the full implementation plan, recorded Paperframe as the public design baseline, added the canonical GitHub repository, and created this live status tracker.  
Files/migrations affected: `docs/IMPLEMENTATION-PLAN.md`, `docs/IMPLEMENTATION-STATUS.md`  
Verification performed: Confirmed the required plan sections, statuses, entities, provider modes, repository URL, and status-tracking instructions are present.  
Result: Passed; no application, database, or worker implementation has started.  
Commit/PR: None; the local workspace is not yet a Git repository.  
Next action: Start Phase 0 by reviewing exclusions, initializing Git, and scaffolding the pinned pnpm/Next.js baseline.

## Entry template

Copy this block for each subsequent completion or status change:

```text
### YYYY-MM-DD — Short task name

Date/time:
Phase/task:
Status change:
What changed:
Files/migrations affected:
Verification performed:
Result:
Commit/PR:
Next action:
```
