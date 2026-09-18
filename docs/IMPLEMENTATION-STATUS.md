# FinTechPulse — Implementation Status

This is the authoritative live record of implementation progress. Update it immediately whenever a task, meaningful subtask, verification gate, phase, or milestone changes status.

## Current state

| Field                  | Value                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| Overall implementation | `IN_PROGRESS`                                                     |
| Current phase          | Phase 8 — Manual provider workflows (`COMPLETE`)                  |
| Current task           | Phase 9 ready: subscription CLI providers                         |
| Last updated           | 2026-09-18 12:37, Asia/Singapore                                  |
| Branch                 | `main`, tracking `origin/main` (`git@github.com:nobledev89/FTP.git`) |
| Relevant commit        | `beeb4c7` (Phases 6–8), pushed; GitHub Actions run 35307982789 passed |
| Active blockers        | Owner design sign-off (Phase 1) remains pending. The admin console has its own review screenshots and does not depend on it. Open before production: manual image uploads above about 4.4 MB exceed Vercel's function request limit (see decisions). |
| Next action            | Start Phase 9 by re-inspecting the installed Claude Code CLI (`claude --version`, `claude --help`, login status) before writing its adapter. |

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
|     2 | Supabase schema and security                       | `COMPLETE`    |     100% | 2026-09-17 | Fresh `supabase db reset` applies 7 migrations and seed; `db:lint` clean; 90 integration tests pass twice in a row (schema/grants, RLS matrix, queue concurrency and leases, state machine and publication boundary, Storage). Local only; GitHub CI job added but not run. |
|     3 | Domain services and state machine                  | `COMPLETE`    |     100% | 2026-09-17 | 163 unit tests and 93 integration tests pass; transition map is in exact database parity; format, lint, typecheck, and production build pass. |
|     4 | Authentication and admin shell                     | `COMPLETE`    |     100% | 2026-09-18 | 240 unit tests, 112 integration tests, 57 signed-out Playwright checks, and 10 authenticated Playwright checks pass; format, lint, typecheck, and production build pass. |
|     5 | Local worker and queue safety                      | `COMPLETE`    |     100% | 2026-09-18 | 258 unit tests and 113 integration tests pass; concurrent claims, lease renewal/loss/recovery, shutdown retry, duplicate settlement fencing, redaction, status, CLI smoke checks, schema lint, types, and build verified. |
|     6 | Mock pipeline end to end                           | `COMPLETE`    |     100% | 2026-09-18 | 269 unit tests, 121 integration tests, 57 signed-out/design Playwright checks, and 10 authenticated checks pass; a real mock job reaches `VERIFIED` through the production stores and RPC boundaries. |
|     7 | Public publication                                 | `COMPLETE`    |     100% | 2026-09-18 | 278 unit tests, 121 integration tests, 61 signed-out/design browser checks, and 12 authenticated/live-publication checks pass; a real rendered article clears all eight verifier checks. |
|     8 | Manual provider workflows                          | `COMPLETE`    |     100% | 2026-09-18 | 283 unit tests, 125 integration tests, 61 signed-out/design browser checks, and 14 authenticated checks pass; a job created in the console completes research, writing, a Gemini upload, and audit through manual handoffs and reaches `VERIFIED` with no CLI or API key. |
|     9 | Subscription CLI providers                         | `NOT_STARTED` |       0% | —         | —                |
|    10 | Optional API adapters                              | `NOT_STARTED` |       0% | —         | —                |
|    11 | Publishing, scheduling, and verification hardening | `NOT_STARTED` |       0% | —         | —                |
|    12 | Operations, documentation, and release QA          | `NOT_STARTED` |       0% | —         | —                |

## Active phase checklist

### Phase 8 — Manual provider workflows

- [x] Manual ChatGPT research and audit, and manual Claude draft and revision: the worker snapshots the exact prompt, releases its lease, and waits; the console validates the pasted JSON against the shared schema and imports it.
- [x] Manual Gemini: per-slot prompt, copy/open, upload with alt text, caption, and focal point, private storage, then continue once every requested slot is ready.
- [x] Authorized, atomic continuation functions that reuse the worker's stage completion, reject duplicates with the accepted artifact, and refuse paused, escalated, or foreign runs.
- [x] Schema examples, validation feedback that keeps the operator's input, and a complete audit trail (prompt snapshot, run, artifact version, events).
- [x] Private-to-public image lifecycle: manual uploads stay in `article-work` until the publishing service copies approved versions.
- [x] Provider defaults editable for implemented modes only; the new-article form offers only modes with an adapter.
- [x] Exit criterion: the full pipeline reaches `VERIFIED` through manual handoffs with no CLI or AI API key, in the database suite and in the browser.

### Phase 6 — Mock pipeline end to end

- [x] Implement deterministic mock research, draft, image, audit, revision, publish, and verification handlers.
- [x] Seed editable prompt templates and the shared editorial style guide from reviewable Markdown.
- [x] Exercise PASS, revision, failure, pause/resume, manual action, `NEEDS_HUMAN`, and scheduled publication branches.
- [x] Expose immutable prompt version creation, activation, and rollback in the authorized admin console.
- [x] Verify that artifacts, provider runs, publishing logs, and events are inspectable through the existing admin data paths.
- [x] Drive a mock job through real database and Storage services to `VERIFIED` and run the full Phase 6 gate.

### Phase 7 — Public publication

- [x] Add a server-only, Zod-validated public repository with strict publication eligibility.
- [x] Build the home, archive, article, alias, empty, and not-found routes from publication snapshots.
- [x] Render GFM Markdown without raw HTML and validate all rendered links and image origins.
- [x] Add canonical, Open Graph, Twitter, Article JSON-LD, share images, sitemap, robots, and RSS.
- [x] Add signed, narrow cache-tag revalidation and connect it to publication.
- [x] Prove draft isolation, malicious-Markdown safety, responsive/accessibility behaviour, and live verification.
- [x] Run the full Phase 7 verification gate and record its evidence.

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

### Phase 2 — Supabase schema and security (complete; kept for review)

- [x] Initialize Supabase local configuration and ordered migrations.
- [x] Create enums, all required/supporting tables, constraints, indexes, triggers, transition/publish/claim RPCs, and seed data.
- [x] Configure Auth assumptions and `admin_users` bootstrap instructions (`docs/SUPABASE.md`, `private.bootstrap_first_owner`).
- [x] Add RLS and Storage bucket policies.
- [x] Generate TypeScript database types (`pnpm db:types` for web and worker).
- [x] Add migration and RLS integration tests against local Supabase.
- [x] Verify a fresh reset applies all migrations and anonymous/admin/worker access tests pass.

### Phase 4 — Authentication and admin shell (complete; kept for review)

- [x] Build Supabase SSR auth clients, login/logout, protected routing, admin authorization, and session refresh.
- [x] Build admin navigation, responsive shell, accessible components, loading/error/empty states.
- [x] Add Dashboard, New Article, Article Detail, Prompts, Providers, Logs, and Settings routes with real database reads.
- [x] Implement validated server actions for create/pause/resume/retry/approve/schedule/settings.
- [x] Add the database functions the console needs (`admin_dashboard`, `admin_update_site_settings`, `admin_update_site_identity`).
- [x] Verify the exit criterion in a browser: an authenticated admin creates and inspects an `IDEA`; unauthenticated and non-admin users reach neither data nor actions.

### Phase 3 — Domain services and state machine (complete; kept for review)

- [x] Implement Zod schemas and repository/service boundaries.
- [x] Implement the pure TypeScript transition map, with a parity test against `private.job_transitions`.
- [x] Implement event append, artifact version helpers, optimistic concurrency, and pause/resume/retry/human-resolution clients over the Phase 2 functions.
- [x] Add table-driven tests for every allowed and rejected transition.
- [x] Write `docs/STATE-MACHINE.md`.

- **Decision: the authentication boundary is four independent layers, and a layout is not one of them.**
  `src/proxy.ts` (Next.js 16's renamed Middleware) refreshes the session and optimistically redirects
  signed-out visitors; `src/lib/auth/dal.ts` is the only place that establishes identity and
  membership; RLS narrows what `authenticated` can select; and the admin RPCs re-derive the caller's
  membership. Every page calls the DAL itself, because a layout does not control whether nested
  segments render. See ADR 0006.
- **Decision: `getClaims()`, not the cookie's contents.** Identity comes from a signature-verified
  access token. The session cookie is client-held storage and is never trusted as a source of truth.
- **Decision: a signed-in non-admin sees `/admin/no-access`, not a login form.** They have already
  authenticated; bouncing them back to sign in would be misleading. `unauthorized()`/`forbidden()`
  would give 401/403 but need the experimental `authInterrupts` flag, and the admin is already
  `noindex`, so the status code buys nothing here.
- **Decision: the proxy matcher covers `/admin` only.** Public pages stay cacheable and are never
  delayed by session work. Server Actions post to the route that renders them, so admin actions are
  still covered; each one re-authorizes regardless.
- **Decision: "approve" is a resolution, not a separate action.** There is no `AUDIT_PASSED` to
  `APPROVED` admin transition: `AUDITING` to `APPROVED` is the worker's normal path. An admin approves
  by resolving a `NEEDS_HUMAN` job to `APPROVED`, which the database allows only after an audit and
  only when the latest valid draft carries the latest audit.
- **Decision: the console aggregates in the database, not the browser's session.** `admin_dashboard`
  returns one authorized `jsonb` summary instead of a dozen count queries. Every other read is a plain
  RLS-filtered select with explicit columns, server-side filters, and `range` pagination.
- **Decision: site identity is owner-only and narrower than the table.** `admin_update_site_identity`
  exposes name, description, disclosure, and timezone. `canonical_origin` is stored in the canonical
  URL of every published article, so it is a migration decision; `locale` and `currency` are
  deployment-level too.
- **Decision: worker-originated text is redacted before it reaches a browser.** Credentials, tokens,
  local Windows paths, and email addresses are masked and long output truncated in provider errors,
  failure summaries, publishing errors, event notes, and JSON summaries. The unredacted text stays in
  the database.
- **Decision: `datetime-local` values are converted explicitly.** A scheduling input carries no
  offset, so `zonedLocalToUtcIso` resolves it against the publication timezone. Ambiguous autumn times
  take the earlier occurrence and non-existent spring times move forward, matching Temporal's
  "compatible" disambiguation.
- **Decision: the authenticated end-to-end suite is separate.** `pnpm test:e2e` runs with placeholder
  Supabase values and covers the signed-out paths with no database. `pnpm test:e2e:admin` builds
  against the local stack and drives the real console; CI runs it in the database job, which already
  has Supabase up.
- **Deferred to later phases, with reasons.** `/admin/articles/[jobId]/edit` remains deferred to the
  validated manual workflow: creating an `admin_edit` row also needs an atomic rule for invalidating
  images and forcing re-audit, otherwise an old approval could point at stale material. Provider-mode
  changes arrive with the adapters that make the alternatives real (Phases 8-10); a new job can
  already override a mode for its own run. Membership management stays a SQL-editor task in version 1.

## Blockers and decisions

- **Resolved: push to GitHub.** The owner confirmed on 2026-09-17; `main` was pushed to `origin` and the first CI run passed (see the completion log).
- **Decision: project-local Node 24.** The PC has Node 20.15.1 (not the 20.19.4 in the plan snapshot), and Node 20 is end-of-life. pnpm `useNodeVersion: 24.21.0` runs every script on Node 24 without changing the system Node. See `docs/decisions/0005-project-local-node-runtime.md`.
- **Decision: ESLint 9 and TypeScript 5.9.** Kept at the versions `create-next-app@16.3.5` pairs with `eslint-config-next`; ESLint 10 and TypeScript 7 are not yet supported by that config or by `typescript-eslint`.
- **Decision: `(public)` and `(admin)` route groups.** The admin lives at `src/app/(admin)/admin/**`, not `src/app/admin/**`, so each group has its own root layout (ADR 0004). URLs are unchanged.
- **Decision: design fixtures live at `/design-review/*` and `/admin/design-review`,** not at `/`, `/blog`, or `/blog/[slug]`. Real routes are built from Supabase in Phase 7, and `/` shows an honest empty state until then. Fixture routes return 404 when `VERCEL_ENV=production` (verified with a production build).
- **Decision: masthead mobile size is fluid (deviation D13).** At the plan's fixed 60px, "FinTechPulse" is 382px wide and overflowed the 343px column at 375px. It now uses `clamp(2.5rem, 14vw, 3.75rem)` below 640px; larger sizes are unchanged.
- **Decision: no automatic hyphenation in headings.** `hyphens: auto` split headline words mid-word at desktop widths; `overflow-wrap: break-word` alone prevents overflow.
- **Decision: `experimental.globalNotFound` enabled.** Needed for a styled 404 on unmatched URLs with two root layouts. It is an experimental Next.js flag; re-check on Next.js upgrades.
- **Decision: the database enforces the state machine, not just the worker.** A trigger rejects direct status, lease, and workflow-column edits from every role (including the service role) and any status pair missing from `private.job_transitions`. `PUBLISHED` and `VERIFIED` are reachable only inside `publish_article` and `record_verification`, and `articles` rows can be written only there. Phase 3's TypeScript map must mirror `private.job_transitions`.
- **Decision: internal linkage lives on `article_jobs`, not `articles`.** `articles` holds only publication-safe columns (including hero-image and source snapshots with private sources excluded), so a plain RLS row filter is enough for public reads.
- **Decision: `claim_next_job` also claims publishing and verification.** Due `SCHEDULED` jobs, auto-publish `APPROVED` jobs, and `PUBLISHED` jobs with a due verification are claimed with leases like other stages, so publishing cannot run twice.
- **Decision: revision cycles count on completion.** `revision_count` increments when `REVISING → RE_AUDIT_PENDING` completes, so network retries never consume one of the two automatic cycles.
- **Decision: admin writes go through `create_article_job` and `admin_transition_job`.** `authenticated` has no table write privileges. Settings, prompt, and manual-import functions arrive with the phases that need them (4, 6, 8).
- **Decision: public sign-up disabled; email provider enabled.** Setting `[auth.email] enable_signup = false` also disables email login, so sign-up is blocked with the global `[auth] enable_signup = false` instead (found by the RLS tests).
- **Decision: explicit function grants only.** PostgreSQL ignores per-schema default-privilege revokes of the global `PUBLIC EXECUTE` default, so the foundation migration revokes it globally. The grants migration then grants API roles only the functions they need. A schema test found and now guards this.
- **Decision: mock branch controls live on the job.** `mock:audit`, `mock:fail`, `mock:fail-always`,
  `mock:manual`, and `mock:slow` keywords make exceptional paths reproducible from the admin without
  environment switches or alternate queue code. They change adapter output only; the same stores,
  gates, leases, retry policy, publication boundary, and verifier are used.
- **Decision: prompt edits are immutable versions.** Editors save a new row and can activate an old
  row to roll back. The database serializes version allocation and keeps each provider run's prompt
  snapshot, so activation never rewrites history.
- **Decision: the Phase 6 live-page fixture is injected only at the HTTP boundary.** Phase 7 has not
  built `/blog/[slug]` yet. The integration suite supplies representative rendered HTML to the real
  verifier, which still executes all eight checks and calls the real `record_verification` RPC.
- **Decision: public web reads use the publishable key and publication RLS.** A sessionless,
  server-only client reads only `articles` and aliases. Strict DTO parsing rejects unexpected status,
  canonical, image, or source values before rendering; no service credential exists in the web app.
- **Decision: provider Markdown cannot supply HTML or images.** GFM renders through an explicit
  component map, raw HTML and Markdown images are dropped, links use a protocol/path allowlist, and
  all article images and sources come from structured publication snapshot fields.
- **Decision: publication invalidates data tags with a signed narrow request.** The worker signs the
  raw slug body with HMAC-SHA256 plus a timestamp and nonce. The route applies clock, constant-time,
  replay, rate, body, and slug checks, then expires only the article-list and exact-slug tags.
- **Decision: manual continuation is a database boundary, not a worker callback.** The worker
  prepares and snapshots the prompt and releases its lease; `admin_import_manual_result`,
  `admin_import_manual_image`, and `admin_complete_manual_images` re-authorize the editor, lock the
  job and run, store the artifact, finish the run, and complete the stage through the same
  `complete_stage_core` the worker uses. Manual text adapters reuse the mock adapters' prompt
  preparation, so every mode renders the same reviewed templates.
- **Decision: provider-run idempotency keys include the claim version.** Admin retry and resolution
  reset `attempt_count`, so a redone stage produced the same `job:stage:cycle:attempt` key as its
  earlier, finished run; reopening that immutable run cost a spurious failed attempt (a latent Phase 6
  defect, reproduced with a manual redo). The key now ends with the job's `lock_version` at claim.
- **Decision: an abandoned manual run is cancelled, not left waiting.** A trigger marks the run
  `cancelled` when the job's `action_required_run_id` moves away without an import. Pausing keeps
  the run, so resume shows the same prompt.
- **Decision: a draft must brief every requested image slot.** Otherwise the image stage could never
  complete. The manual import and the worker's draft and revision stages both enforce it.
- **Decision: the console offers only modes with a worker adapter.** A job snapshotted onto a mode
  without one fails permanently at that stage. The seeded writing default stays Claude Code (the
  plan's version 1 default, arriving in Phase 9); until then it is shown as unavailable and new jobs
  must choose a writing mode explicitly, which the create action re-checks on the server.
- **Decision: the admin proxy buffers up to 11 MB.** Next.js buffers proxied request bodies to 10 MB
  by default and silently drops the rest, which would corrupt the largest uploads the 11 MB Server
  Action limit admits. `experimental.proxyClientMaxBodySize` now matches it.
- **Open item for production: Vercel caps function request bodies at 4.5 MB.** Manual images are
  uploaded through a Server Action, so on Vercel a file above about 4.4 MB will be refused before the
  application sees it, even though the console, Storage, and database accept 10 MB. Recommended fix
  before production (Phase 11 or 12): upload from the browser straight to `article-work` under the
  existing editor Storage policy, then have the Server Action verify the stored object's bytes before
  calling `admin_import_manual_image`. Local and CI runs are unaffected.
- **Decision: cache invalidation failure cannot undo publication.** Revalidation runs after the
  publication transaction and reports a safe boolean. The live verifier remains the correctness
  boundary and uses the existing bounded retry path if the rendered page is stale or unavailable.

## Completion log

### 2026-09-18 — Phases 6–8 committed; GitHub CI passes

Date/time: 2026-09-18, Asia/Singapore

Phase/task: Phases 6–8 — commit, push, and clean-environment CI

Status change: The Phase 6, 7, and 8 work moves from an uncommitted working tree to `main`. No phase
status changes.

What changed: Committed the verified Phase 6, 7, and 8 work as one commit, `beeb4c7`, because the
three phases share the worker handlers, the pipeline test suite, the generated types, and this record,
so no split would leave each intermediate commit buildable and tested. Pushed `main` to `origin`.
Before committing, the staged diff was checked for environment files and key-shaped strings; none
were present.

Files/migrations affected: `docs/IMPLEMENTATION-STATUS.md` (this entry); no code or migrations.

Verification performed: GitHub Actions run 35307982789 on `beeb4c7` completed with all three jobs
`success`: "Lint, typecheck, test, build"; "Design review (Playwright)"; and "Supabase schema, RLS,
and queue", which applies all eleven migrations, lints the schema, checks generated-type drift, and
runs the integration and authenticated admin suites, including the manual-provider flow to
`VERIFIED`.

Result: Passed. Phases 6–8 are confirmed in a clean environment.

Commit/PR: `beeb4c7` on `main`, pushed; this status update is committed separately.

Next action: Start Phase 9 by re-inspecting the installed Claude Code CLI before writing its adapter.

### 2026-09-18 — Phase 8 manual provider workflows complete

Date/time: 2026-09-18 12:37, Asia/Singapore

Phase/task: Phase 8 — manual ChatGPT, Claude, and Gemini workflows, their continuation boundary, and
the console run panel

Status change: Phase 8 `NOT_STARTED` → `IN_PROGRESS` → `COMPLETE`. Current task moves to Phase 9.

What changed: Added manual adapters for research, draft, revision, and audit (prompt preparation
shared with the reviewed templates; execution requests operator input) and a Gemini adapter that
prepares one prompt section per requested slot. Added migration
`20260918130000_manual_workflows.sql` with the authorized, single-transaction import functions for
text artifacts and per-slot images, the image completion function, an implemented-modes-only provider
default function, and a trigger that cancels a manual run abandoned by escalation. The imports reject
duplicates with `FT004`, refuse paused or escalated waits, require every requested image slot to be
briefed, and check that an uploaded object's stored size and type match the recorded ones. Added the
article-page run panel (prompt snapshot, copy, open provider, JSON example, validated paste that keeps
rejected input, per-slot image upload with metadata, continue), server actions that re-check the wait
before any upload, byte-level image inspection, editable provider defaults, and new-article mode
options limited to implemented adapters. Fixed a latent Phase 6 idempotency defect: a stage redone
after admin retry or resolution reopened its earlier finished run; keys now include the claim version.
Matched the admin proxy's body buffer to the Server Action limit. Documented the workflow in the
admin, worker, state-machine, and Supabase guides and the README.

Files/migrations affected: `supabase/migrations/20260918130000_manual_workflows.sql`; generated web
and worker database types; `local-worker/src/providers/{contract,registry}.ts`,
`local-worker/src/providers/manual/**`, the mock adapters' key calls, and
`local-worker/src/pipeline/handlers.ts`; `src/lib/admin/{manual-actions,manual-validation,image-file,
provider-actions,provider-modes,actions,jobs}.ts`; `src/components/admin/{manual-action-panel,
provider-setting-form,new-article-form,form}.tsx`; the article, new-article, and providers pages;
`next.config.ts`; `tests/integration/{mock-pipeline,schema}.test.ts` and helpers;
`tests/e2e/admin-session.spec.ts`; `docs/{ADMIN-CONSOLE,LOCAL-WORKER,STATE-MACHINE,SUPABASE}.md`;
`README.md`.

Verification performed: A fresh `pnpm supabase:reset` applies all eleven migrations and both seed
files; `pnpm db:lint` reports no schema errors; `pnpm db:types` regenerates both clients.
`pnpm contracts:sync --check` and `pnpm prompts:seed --check` report no drift. `pnpm format:check`,
`pnpm lint`, and `pnpm typecheck` pass. `pnpm test` passes 283 tests in 31 files, including the
manual adapter's prepared prompt, run key, and operator-input request, and pasted-response parsing.
`pnpm test:integration` passes 125 tests in 8 files: a job completes research, draft, a private
upload, image completion, and audit through the import functions and reaches `VERIFIED` with four
succeeded manual runs; a second import fails `FT004`; a redo after escalation opens a fresh run and
cancels the abandoned one (this scenario reproduced the idempotency defect before the fix); imports
are refused for a draft missing an image brief, a viewer, a paused job, a misreported upload size, an
unrequested slot, and early completion; provider defaults accept only implemented modes and keep
revision aligned with writing; grants list the new functions exactly. `pnpm test:e2e` passes 61
signed-out/design checks with the 14 database-dependent checks skipped. `pnpm test:e2e:admin` builds
the app and passes all 14 local-stack checks: the new-article form shows the unavailable writing
default as disabled; a provider default is changed and restored; and a job created in the browser
with all four manual modes shows the exact prompt and provider link, keeps rejected JSON and
schema-invalid responses in place with their errors, has no horizontal overflow at 375 px, imports
research from a fenced response, a draft, a Gemini upload with a caption, and an audit, then is
published and live-verified to `VERIFIED`. Agent review of the captured panel screenshots found no
layout problem. The stand-in responses are schema-valid artifacts from the mock builders; no real
ChatGPT, Claude, or Gemini session was used.

Result: Passed. The Phase 8 exit criterion is met locally. The Vercel request-size limit on image
uploads is recorded as an open production item.

Commit/PR: Not committed in this working tree. Phases 6, 7, and 8 remain together on base `f11de0f`
pending owner review; GitHub CI has not run them.

Next action: Owner review, then commit and push the Phase 6–8 work so CI verifies it in a clean
environment. Phase 9 then starts by re-inspecting the installed Claude Code and Codex CLIs.

### 2026-09-18 — Phase 7 public publication complete

Date/time: 2026-09-18 09:38, Asia/Singapore

Phase/task: Phase 7 — Supabase-backed public routes, safe Markdown, SEO/feed surfaces, signed cache
invalidation, and real-page verification

Status change: Phase 7 `IN_PROGRESS` → `COMPLETE`. Current task moves to Phase 8.

What changed: Replaced the public empty-only home with a publication feature and latest stream;
added the paginated `/blog` archive and `/blog/[slug]` article page with public alias redirects,
empty/invalid/not-found handling, responsive published images, byline and dates, disclosure,
structured sources, related articles, and a narrow server-only repository. Public rows and nested
JSON are strictly Zod-validated and read through a sessionless publishable-key client, leaving RLS as
the eligibility boundary. Added GFM rendering through the existing prose component map with raw HTML
and Markdown images disabled and link protocols constrained. Added per-article canonical, Open Graph,
Twitter, Article JSON-LD, generated branded share cards, sitemap, robots, RSS, and the canonical `www`
redirect. Added five-minute article/list data tags and a signed `POST /api/revalidate` contract with
HMAC-SHA256, timestamp, nonce, constant-time comparison, replay/rate bounds, exact body/slug
validation, and no arbitrary tags or paths. The worker now calls it after publication without
rolling back an already committed article on transport failure. Added conditional local-only Next
image access to the fixed Supabase development port while hosted builds retain the private-network
guard. Documented the public publication contract and updated worker operations.

Files affected: `src/lib/publication/**`; `src/app/(public)/{page,layout,blog/**,opengraph-image,
twitter-image}`; `src/app/{api/revalidate,feed.xml,robots,sitemap}`; the safe Markdown component and
public image DTO; worker publishing/revalidation integration; public and authenticated Playwright
coverage; `next.config.ts`; `package.json`/lockfile; `.env.example`, README, publication/worker/status
documentation, and CI-covered test surfaces. No database migration was required because the
publication snapshot, aliases, public Storage, indexes, grants, and due-publication RLS already
existed.

Verification performed: Reviewed the bundled Next.js 16.3.5 data, cache, revalidation, route,
metadata, image, not-found, JSON-LD, sitemap, robots, Open Graph, and redirect contracts before
implementation. `pnpm prompts:seed --check` and `pnpm contracts:sync --check` report no drift.
`pnpm db:lint` reports no schema errors; `pnpm db:types` regenerates both clients. `pnpm lint` and
`pnpm typecheck` pass. `pnpm test` passes 278 tests in 29 files, including malicious Markdown,
publication DTO, HMAC/replay, and worker signing cases. `pnpm test:integration` passes 121 tests in 8
files. `pnpm build` completes with the intended five-minute public routes and generated metadata
routes. `pnpm test:e2e` passes 61 signed-out/design checks at 375, 768, 1024, and 1440 px with 12
database-dependent checks intentionally skipped. `pnpm test:e2e:admin` passes all 12 local-stack
checks: a deterministic job publishes a real PNG, calls signed invalidation, renders the actual
article, clears all eight live checks to `VERIFIED`, exposes canonical/social/JSON-LD/RSS/sitemap/
robots surfaces, permanently redirects an alias, hides an unpublished slug, loads the optimized
image, and has no horizontal overflow in captured real home/archive/article pages at 375 and 1440
px. Agent review of those screenshots found no layout, crop, typography, footer, or public/admin
separation regression.

Result: Passed. Public pages expose only eligible publication snapshots, render untrusted Markdown
without executable content, are SEO/feed complete, and the production verifier now checks the real
rendered route rather than the Phase 6 boundary fixture.

Commit/PR: Not committed in this working tree. Phase 6 and Phase 7 changes remain together on base
`f11de0f`.

Next action: Start Phase 8 with manual ChatGPT research prompt export and schema-validated response
import, reusing the artifact/run contracts proven by the mock pipeline.

### 2026-09-18 — Phase 6 mock pipeline end to end complete

Date/time: 2026-09-18 09:04, Asia/Singapore

Phase/task: Phase 6 — deterministic mock providers, artifact persistence, publication, verification,
prompt versions, and exceptional workflow branches

Status change: Phase 6 `NOT_STARTED` → `COMPLETE`. Current task moves to Phase 7.

What changed: Added the worker copy of the shared strict artifact contracts and drift checker;
deterministic research, drafting, revision, PNG image, and audit adapters; job-keyword branch controls;
the provider registry; prompt preparation and immutable provider-run snapshots; artifact persistence
for research/source/claim graphs, drafts, audits, images, and Storage; internal publishing and
eight-check live verification services; and real CLI handler registration. Publishing copies the
latest ready image per slot from `article-work` to `article-public` before the existing atomic
`publish_article` boundary. Verification evaluates the served status, canonical, title, body, hero,
metadata, JSON-LD, and placeholders before the existing `record_verification` boundary. Added six
reviewable Markdown prompts, generated idempotent SQL seed data, immutable prompt-version creation
and activation RPCs, and the editor/owner prompt UI. CI now rejects prompt-seed or worker-contract
drift. The existing admin detail/timeline queries display every resulting version, run, event, and
publishing log.

Files/migrations affected: `local-worker/src/{contracts,db,pipeline,providers,publishing,verification}/**`;
worker CLI/runner/store integration; `prompts/*.md`;
`scripts/{generate-prompt-seed,sync-worker-contracts}.mjs`;
`supabase/migrations/20260918120000_mock_pipeline.sql`; `supabase/seeds/prompts.sql`; generated
database types; prompt admin action/UI/configuration; pipeline and grant integration tests; root
scripts, Supabase seed configuration, CI, README, and operations/admin/Supabase documentation.

Verification performed: A fresh `pnpm supabase:reset` applies all ten migrations and both seed files;
`pnpm db:lint` reports no schema errors; `pnpm db:types` regenerates both clients; and
`pnpm prompts:seed --check` plus `pnpm contracts:sync --check` report no drift. `pnpm format:check`,
`pnpm lint`, and `pnpm typecheck` pass. `pnpm test` passes 269 tests in 25 files.
`pnpm test:integration` passes 121 tests in 8 files, including a real service-role job through
research, draft, private PNG upload, audit, public Storage copy, publication, all eight verification
checks, and `VERIFIED`; it also covers revision convergence, terminal failure, manual action,
editorial escalation, an in-flight pause with stale-lease fencing and safe resume, due scheduling,
prompt seed, immutable edit/activation/rollback, and viewer denial. `pnpm build` completes on Next.js
16.3.5. `pnpm test:e2e` passes 57 checks (10 authenticated checks intentionally skipped in that
no-database suite), and `pnpm test:e2e:admin` passes all 10 authenticated checks, including 375px and
1440px overflow review. A temporary local-environment CLI smoke run also shows `worker:once` claiming
and completing a mock stage through the registered handlers, followed by a healthy `worker:status`
report with all seven stages advertised.

Result: Passed. The exit job reaches `VERIFIED` without bypassing artifact validation, queue leases,
Storage, the publication RPC, the verifier, or the verification RPC; every intermediate version and
event remains queryable by the admin.

Commit/PR: Not committed in this working tree. Local verification is complete on base `f11de0f`.

Next action: Start Phase 7 and replace the current public empty state with Supabase-backed home,
archive, and article routes so operational live verification can fetch the real rendered page.

### 2026-09-18 — Phase 5 local worker and queue safety complete

Date/time: 2026-09-18 07:44, Asia/Singapore

Phase/task: Phase 5 — Windows-compatible local worker, CLI, queue safety, and operations

Status change: Phase 5 `IN_PROGRESS` → `COMPLETE`. Current task moves to Phase 6.

What changed: Added root and package `worker:once`, `worker:start`, and `worker:status` commands; a fixed-path worker-only `.env.local` loader and bounded environment contract; a typed service-role Supabase store; the handler-gated `WorkerRunner`; active heartbeat and lease renewal; expired-lease recovery; single-settlement fencing; graceful signal cancellation; retry classification with jittered stage-specific exponential backoff; structured JSON logging with field and free-text redaction; and a validated worker-status report. Added the service-role-only, read-only `worker_status` RPC, which returns exact queue counts, heartbeat state inputs, thresholds, delayed work, failures, and action requirements without heartbeat, claim, or recovery side effects. Added `docs/LOCAL-WORKER.md` and `docs/HERMES.md` with manual, Hermes, and Windows Task Scheduler contracts. Phase 5 deliberately registers no provider handlers: it passes an empty stage allowlist and cannot consume work before Phase 6 installs the mock adapters.

Files/migrations affected: `local-worker/src/{cli,config,db,logging,queue,status}/**`; `supabase/migrations/20260918110000_worker_status.sql`; generated web/worker database types; `tests/integration/{queue,schema}.test.ts`; root and worker `package.json`; `.env.example`; `README.md`; `docs/{ARCHITECTURE,SUPABASE,LOCAL-WORKER,HERMES}.md`; `pnpm-lock.yaml`.

Verification performed: A fresh `pnpm supabase:reset` applied all nine migrations and seed data. `pnpm db:lint` reports no schema errors; `pnpm db:types` is stable on regeneration. `pnpm format:check`, `pnpm lint`, and `pnpm typecheck` pass. `pnpm test` passes 258 tests in 23 files, including 21 worker tests for environment safety margins, secret/path/email redaction, JSON-line logging, error classification, capped jittered backoff, handler-gated claims, two concurrent runners processing one claim once, active lease renewal, graceful-shutdown retry, lease-loss abandonment, duplicate settlement fencing, and heartbeat-state classification. `pnpm test:integration` passes 113 tests in 7 files, including the existing overlapping-transaction `SKIP LOCKED` claim test, concurrent distribution, renewal without a lock-version bump, killed-worker expiry recovery and stale-token fencing, final-attempt failure, and the new read-only status snapshot. `pnpm build` completes the Next.js 16.3.5 production build. Against local Supabase, `pnpm worker:once` heartbeated/recovered and exited idle without claiming unsupported work; `pnpm worker:status` reported the worker online with exact queue counts; and `pnpm worker:start` launched the polling daemon. GitHub Actions retry run 35288496845 on the unchanged Phase 5 tree completed with all three jobs `success`: lint/typecheck/unit/build, the 57-check design-review suite, and the Supabase job with schema lint, generated-type drift detection, 113 integration tests, and 10 authenticated admin checks. The initial run 35288243622 had already passed the first two jobs but failed before database setup at `pnpm supabase:start`; the explicit empty retry commit `1819a3d` confirmed that was transient runner/container startup rather than a code or migration failure.

Result: Passed. Two workers cannot process the same stage, a killed worker's lease is safely recovered, stale completion is fenced with `FT003`, and the worker runtime does not claim any stage without a registered handler.

Commit/PR: `b2afc62` (`feat: add phase 5 local worker runtime`) on `main`; clean-environment CI passed on retry commit `1819a3d`.

Next action: Start Phase 6 with deterministic mock handlers and drive a mock job through every artifact and state transition to `VERIFIED`.

### 2026-09-18 — Phase 5 local worker and queue safety started

Date/time: 2026-09-18 07:23, Asia/Singapore

Phase/task: Phase 5 — Windows-compatible worker runtime, CLI, queue safety, and operations

Status change: Phase 5 `NOT_STARTED` → `IN_PROGRESS`.

What changed: Reconciled the Phase 5 acceptance criteria with the existing queue, lease, state-machine, and service-role contracts. The worker will claim only stages for which a handler is registered, so the Phase 5 CLI cannot consume provider work before Phase 6 installs the mock pipeline handlers.

Verification performed: Repository and Phase 4 handoff reviewed; implementation is in progress.

Next action: Implement the worker store/runtime, CLI commands, retry and logging contracts, database status surface, safety tests, and Windows operations documentation.

### 2026-09-18 - Phase 4 authentication and admin shell complete

Date/time: 2026-09-18 00:20, Asia/Singapore

Phase/task: Phase 4 - Supabase SSR authentication, the authorization boundary, and the admin console

Status change: Phase 4 `NOT_STARTED` to `IN_PROGRESS` to `COMPLETE`. Current task moves to Phase 5. Phase 1 owner design sign-off remains separately pending.

What changed: Added the Phase 4 migration `20260918100000_admin_console.sql`: `private.require_admin` and `private.require_owner`, `public.admin_dashboard` (one authorized `jsonb` summary of status and stage counts, totals, and bounded lists of awaiting-input, blocked, in-progress, upcoming, and recently published jobs, plus worker heartbeats classified against the configured thresholds), `public.admin_update_site_settings` (editor or owner), and `public.admin_update_site_identity` (owner only), with grants to `authenticated`. Added the Supabase SSR layer: a lazily parsed browser-safe environment contract that rejects a service-role secret, a request-scoped server client, and a proxy client that writes rotated tokens and their no-store headers onto the returned response. Added `src/proxy.ts` (Next.js 16's renamed Middleware convention) matching `/admin` only, which refreshes the session, optimistically redirects signed-out visitors, and forwards the requested path as a header. Added the Data Access Layer (`getVerifiedUser` via `getClaims()`, `getAdminSession`, `requireAdminSession`, `authorizeAdminAction`), the `next` destination normalizer, and sign-in/sign-out actions with one message for every rejected attempt. Added the admin console: dashboard with a queue summary and a filtered, paginated queue; new article with per-stage provider modes and billable-mode warnings; article detail with every artifact version, sources, provider runs, publishing logs, the paginated timeline, and the workflow controls; prompts, providers, logs, and settings; plus segment loading and error states, a no-access page, and shell identity with sign-out. Added server actions for create, start, pause, resume, retry, escalate, resolve (including approval), schedule, settings, and identity, each authorizing before validating and carrying `lock_version`. Added redaction of worker-originated text, server-side pagination and filter parsing, the exhaustive status vocabulary, admin formatting, and timezone-correct `datetime-local` conversion. Moved `@supabase/supabase-js` to runtime dependencies and added `@supabase/ssr` and `server-only`. Wrote `docs/ADMIN-CONSOLE.md` and ADR 0006, and updated the architecture, Supabase, and README documentation.

Files/migrations affected: `supabase/migrations/20260918100000_admin_console.sql`; `src/proxy.ts`; `src/lib/supabase/{env,server,proxy-session,database.types}.ts`; `src/lib/auth/**`; `src/lib/admin/**`; `src/lib/format/timezone.ts`; `src/lib/state-machine/transitions.ts` (added `stageRank`); `src/app/(admin)/admin/**`; `src/components/admin/**`; `tests/e2e/{admin-auth,admin-session}.spec.ts`; `tests/integration/{admin-console.test.ts,schema.test.ts}`; `scripts/{run-e2e,run-e2e-admin}.mjs`; `.github/workflows/ci.yml`; `docs/{ADMIN-CONSOLE,ARCHITECTURE,SUPABASE}.md`; `docs/decisions/{0006-admin-authentication-boundary.md,README.md}`; `README.md`; `package.json`; `pnpm-lock.yaml`; `local-worker/src/db/database.types.ts`.

Verification performed: `pnpm supabase:reset` applied all eight migrations and seed from scratch; `pnpm db:lint` clean; `pnpm db:types` regenerated for web and worker. `pnpm format:check`, `pnpm lint`, and `pnpm typecheck` pass. `pnpm test` passes 240 unit tests in 19 files (up from 163), covering destination normalization against absolute, protocol-relative, encoded, control-character, and fragment inputs; pagination and page links; redaction of Supabase and provider keys, JWTs, bearer headers, URL credentials, Windows and POSIX paths, and email addresses; queue filter parsing and stage intersection; control availability cross-checked against the Phase 3 planner for all 22 statuses; resolution destinations against the database's skip-ahead, approval, and revision-cycle rules; timezone conversion across both daylight-saving edges with a round trip; and the environment contract. `pnpm test:integration` passes 112 tests in 7 files (up from 93), including that `admin_dashboard` refuses anonymous, non-admin, and deactivated callers, that its counts and lists follow a job through creation and escalation, that worker health tracks the configured thresholds, that an editor creates and reads back an `IDEA` while a viewer and a non-admin cannot, that anonymous and non-admin sessions see no editorial row, that a stale `lock_version` is rejected, and that the settings and identity functions enforce their roles, clear optional values, and keep the table constraints. `pnpm build` completes the Next.js 16.3.5 production build with the proxy registered. `pnpm test:e2e` passes 57 checks including every admin route redirecting when signed out, destination preservation, hostile `next` values being discarded, no queue data in the redirect response, the login form's labels and autocomplete, `noindex`, no public chrome, and the 375px layout. `pnpm test:e2e:admin` passes 10 checks against the local stack: signing in to a deep link, a rejected password showing one generic message, creating an `IDEA` and inspecting it, start/pause/resume with the expected `lock_version`, a raced second admin producing the stale-version message, saving settings, signing out and being locked out again, a signed-in non-admin reaching only `/admin/no-access`, and every screen rendering at 375px and 1440px without horizontal overflow. Screenshots are in `test-results/admin-review/`. Findings fixed during verification: a `"use server"` module exporting a constant broke the production build (that state now lives in separate modules); two form fields both labelled "Images"; a redaction rule that left a bearer token behind; ambiguous autumn times resolving to the later occurrence; and an end-to-end cleanup that silently failed against append-only history. GitHub Actions run 35285971856 on `576b4e1` completed with all three jobs `success`: "Lint, typecheck, test, build", "Design review (Playwright)", and "Supabase schema, RLS, and queue", the last now also running `pnpm test:e2e:admin` against the local stack. The first push was rejected by GitHub's secret scanning because two unit tests used the local Supabase demo key as a fixture; both fixtures are now composed at runtime, so no key-shaped literal is in the repository.

Result: Passed. The Phase 4 exit criterion is met, in the database and in a browser.

Commit/PR: `576b4e1` on `main`, pushed; this status update is committed separately.

Next action: Start Phase 5 with the Windows-compatible worker package and CLI, atomic claim and lease renewal, expiry recovery, heartbeat, retry and backoff, graceful shutdown, and structured redacted logging.


### 2026-09-17 — Phase 3 domain services and state machine complete

Date/time: 2026-09-17 21:18, Asia/Singapore

Phase/task: Phase 3 — typed domain contracts, state-machine parity, repositories, and clients

Status change: Phase 3 `NOT_STARTED` → `IN_PROGRESS` → `COMPLETE`. The owner's instruction to continue accepted the completed Phase 0–2 contracts for this non-visual work; Phase 1 visual sign-off remains separately pending.

What changed: Added strict Zod schemas for database job/event DTOs and normalized research, draft, audit, and image artifacts, including evidence-reference, image-role/readiness, and audit-finding cross-field rules. Added the pure TypeScript lifecycle model with all 22 statuses, seven stages, 99 allowed transition pairs, exceptional-path classification, stage/pending helpers, and deterministic admin planning for optimistic locking, pause normalization, retry, escalation, resolution, and scheduling. Added typed error normalization for database SQLSTATEs. Added separate authenticated-admin and service-role worker workflow clients over the Phase 2 RPCs. Added editorial-read and worker-write repository capabilities, validated event append restricted to non-transition events, and optimistic immutable artifact version allocation with concurrent unique-conflict handling. Added exhaustive transition tests, artifact/schema tests, real-client integration tests, and exact TypeScript/Postgres transition parity. Wrote `docs/STATE-MACHINE.md` and linked it from the architecture and README. Added Zod as a web runtime dependency.

Files/migrations affected: `src/lib/state-machine/**`, `src/lib/validation/**`, `src/lib/content/**`, `tests/integration/domain-services.test.ts`, `tests/integration/schema.test.ts`, `docs/STATE-MACHINE.md`, `docs/ARCHITECTURE.md`, `README.md`, `package.json`, and `pnpm-lock.yaml`. No database migration changed.

Verification performed: `pnpm format:check` passed; `pnpm lint` passed; `pnpm typecheck` passed for the Next.js and worker packages; `pnpm test` passed 163 tests in 11 files; `pnpm test:integration` passed 93 tests in 6 files against local Supabase; `pnpm build` completed the Next.js 16.3.5 production build; `git diff --check` passed. The unit matrix executes all 99 allowed and all 385 rejected status pairs. The integration parity assertion compares every row of `private.job_transitions`, and the existing artifact-immutability and publication-boundary tests remain green.

Result: Passed. Phase 3 exit criteria are met.

Commit/PR: Included in this session's Phase 3 commit on `main`; not yet pushed.

Next action: Start Phase 4 with Supabase SSR clients, session refresh, protected admin authorization, and login/logout flows.

### 2026-09-17 — First slice pushed; GitHub CI passes

Date/time: 2026-09-17 19:32, Asia/Singapore  
Phase/task: Phases 0–2 — publish to the canonical repository and run CI  
Status change: The push blocker is resolved. The GitHub CI evidence gap for Phases 0 and 2 is closed. Phase 1 stays `IN_PROGRESS` pending owner design sign-off.  
What changed: After owner confirmation, pushed `main` (`a86d8d4`, `9aa044e`, `4668ee3`) to the empty repository `git@github.com:nobledev89/FTP.git` and set upstream tracking. The working tree was clean before the push, and `git ls-remote` confirmed `refs/heads/main` at `4668ee3`.  
Files/migrations affected: `docs/IMPLEMENTATION-STATUS.md` (this entry); no code or migrations.  
Verification performed: GitHub Actions run 35215838618 on `4668ee3` completed with all three jobs `success`: "Lint, typecheck, test, build" (frozen install, format check, lint, typecheck, unit tests, build); "Design review (Playwright)" (production build plus 40 checks on Ubuntu); and "Supabase schema, RLS, and queue" (local stack start, `db:lint`, generated types current, 90 integration tests). This is the first clean-environment confirmation of the local results.  
Result: Passed.  
Commit/PR: Pushed `4668ee3`; this status update is committed separately.  
Next action: Owner reviews the design fixtures and the Phase 0–2 contracts, then approves Phase 3.

### 2026-09-17 — Phase 2 Supabase schema and security complete

Date/time: 2026-09-17 19:24, Asia/Singapore  
Phase/task: Phase 2 — Supabase schema and security  
Status change: Phase 2 `IN_PROGRESS` → `COMPLETE`. Current task moves to owner review of the first slice (plan section 25) before Phase 3.  
What changed: Initialized `supabase/config.toml` (project `fintechpulse`, public sign-up disabled, 12-character minimum password, edge runtime and analytics off, 10 MiB uploads). Wrote seven ordered migrations. **Foundation:** `private` schema, global and per-schema privilege hardening, 22 enums, and immutable helpers. **Identity and config:** `sites`, `admin_users`, `prompt_templates`, `site_settings`, `provider_settings` (API modes require confirmation; secret-looking keys rejected), `worker_instances`, and authorization helpers. **Content and artifacts:** `article_jobs` with lease, state, and linkage constraints; `provider_runs`; `research_packets`; `sources`; `claims`; `claim_sources`; `drafts`; `audits`; `images`; `articles`; `article_slug_aliases`; `job_events`; `publishing_logs`; `originality_checks`. These use composite same-job foreign keys, immutability triggers, and append-only history. **State machine and queue:** `private.job_transitions` (22 normal transitions plus pause, resume, failure, escalate, resolve, retry, and recovery), a guard trigger on jobs and articles, and service-role functions `heartbeat_worker`, `claim_next_job` (`FOR UPDATE SKIP LOCKED`, recovers expired leases first), `renew_lease`, `complete_stage` (stage gates plus automatic follow-on transitions), `request_manual_action`, `fail_stage`, `publish_article` (publication boundary, plan section 8.3), `record_verification`, and `recover_expired_leases`. Admin functions `create_article_job` and `admin_transition_job` (start, pause, resume, retry, mark_needs_human, resolve, schedule) check `lock_version`. Added the owner bootstrap `private.bootstrap_first_owner`, which no API role can run. **RLS and grants:** RLS on all 20 public tables, explicit grants, public reads limited to `sites` and due published articles, admin-only editorial reads. **Storage:** private `article-work` (editor uploads under existing `jobs/<id>/`, immutable) and public-read `article-public` (service role writes only), images only. **Indexes:** claim, lease expiry, action required, dashboard status, public article list, provider runs, event timeline, audit verdict, publishing logs, worker heartbeat, and artifact lookups. Seed data: the UK site row, site settings, and non-billable provider defaults. Added `pnpm supabase:start|stop|reset`, `db:lint`, `db:types` (Node script, Windows-safe), and `test:integration`. Generated database types for web and worker. Added integration tests and a CI `database` job. Wrote `docs/SUPABASE.md` covering local workflow, schema rules, access matrix, function reference, error codes, Storage, auth assumptions, and hosted setup with owner bootstrap.  
Files/migrations affected: `supabase/config.toml`, `supabase/seed.sql`, `supabase/migrations/20260917100000_foundation.sql`, `…100100_identity_and_config.sql`, `…100200_content_and_artifacts.sql`, `…100300_state_machine_and_queue.sql`, `…100400_rls_and_grants.sql`, `…100500_storage.sql`, `…100600_indexes.sql`, `scripts/generate-db-types.mjs`, `src/lib/supabase/database.types.ts`, `local-worker/src/db/database.types.ts`, `tests/integration/**`, `vitest.integration.config.mts`, `docs/SUPABASE.md`, `README.md`, `.github/workflows/ci.yml`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `eslint.config.mjs`, `.prettierignore`.  
Verification performed: `pnpm supabase:reset` from scratch applied all seven migrations and seed. `pnpm db:lint` (`plpgsql_check`, fail on warning): no issues; it had earlier found an unused variable and a missing enum cast, both fixed. `pnpm test:integration`: 5 files, 90 tests passed, then passed again without a reset. The tests cover: RLS on every table; exact anon and authenticated table and function grants; private helper grants; an owner bootstrap that runs once; the transition map; seed defaults; API-mode and secret constraints; anon, non-admin, viewer, editor, and service-role access across all 17 editorial tables; self-promotion blocked; deactivation revokes access; two overlapping transactions cannot claim the same job; 12 concurrent claims over 5 jobs claim each job exactly once; lease renewal fencing without a `lock_version` bump; crash recovery with a stale worker fenced off; a final-attempt lease expiry fails the job; retry backoff; auth and usage-limit errors cannot retry; manual waits release the lease; stale `lock_version` rejected; pause releases a running lease; direct status, lease, and history edits rejected for the service role; stage gates; image readiness; exactly two revision cycles, then human escalation with a required note; resolution cannot skip ahead; a full lifecycle to `VERIFIED` through publish and failed, skipped, and successful verification attempts with log counts; forged articles and `PUBLISHED` transitions rejected; slug conflict `FT006`; scheduled publication waits; artifact immutability with review metadata allowed; cross-job references rejected; Storage bucket policies for each role, overwrite and delete protection, public URL serving, and MIME restriction. Query plans with 5,000 jobs, in a rolled-back transaction, use `article_jobs_claim_idx`, `article_jobs_lease_expiry_idx`, and `article_jobs_site_status_idx`. `pnpm format:check`, `pnpm lint`, and `pnpm typecheck` are clean. `pnpm test` passes 29 tests. `pnpm test:e2e` builds and passes 40 checks (no UI regression). Findings fixed during verification: the email login config, the mock-run provider constraint, a PUBLIC EXECUTE grant on a private helper, and bulk-insert null defaults in the test fixtures (a note for the Phase 5 worker).  
Result: Passed locally. The Phase 2 exit criterion is met. GitHub CI has not run.  
Commit/PR: Local commit `feat: phase 2 supabase schema and security` on `main`; Phase 1 is `9aa044e`. Not pushed.  
Next action: Owner reviews the design fixtures and the Phase 0–2 contracts and confirms the push. Then Phase 3 begins with the TypeScript transition map and a parity test against `private.job_transitions`.

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
