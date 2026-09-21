# FinTechPulse — Implementation Status

This is the authoritative live record of implementation progress. Update it immediately whenever a task, meaningful subtask, verification gate, phase, or milestone changes status.

## Current state

| Field                  | Value                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| Overall implementation | `IN_PROGRESS`                                                     |
| Current phase          | Phase 12 — Operations, documentation, and release QA (`IN_PROGRESS`) |
| Current task           | Hosted preview handoff: owner design sign-off and preview deployment. |
| Last updated           | 2026-09-21 11:00, Asia/Singapore                                     |
| Branch                 | `main`, tracking `origin/main` (`git@github.com:nobledev89/FTP.git`) |
| Relevant commit        | Phase 12 release candidate `6ff36bc` is pushed; GitHub Actions run `35548731358` on `5ac8322` (same code tree) passes. |
| Active blockers        | Owner design sign-off (Phase 1) remains pending. Preview/production deployment and Cloudflare changes require the owner's hosted accounts. |
| Next action            | Obtain owner design sign-off, then deploy and smoke-test a preview with the owner's hosted accounts. |

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
|     9 | Subscription CLI providers                         | `COMPLETE`    |     100% | 2026-09-18 | 335 unit tests, 129 integration tests, 61 signed-out/design and 14 authenticated browser checks pass; live Claude Code draft and live Codex research from the production prompts pass the artifact schemas; signed-out and usage-limited CLIs reach an actionable `NEEDS_HUMAN`. |
|    10 | Optional API adapters                              | `COMPLETE`    |     100% | 2026-09-18 | OpenAI, Anthropic, and Gemini adapters share the production prompts/schemas; 344 unit, 130 integration, 61 signed-out/design, and 15 authenticated browser checks pass, including a switched API stage through `VERIFIED`. |
|    11 | Publishing, scheduling, and verification hardening | `COMPLETE`    |     100% | 2026-09-21 | 357 unit, 147 integration (passed twice without a reset), 61 signed-out/design, and 15 authenticated browser checks pass; concurrent publish, slug/alias conflicts, DST-repeated schedule instants, missing public image copies, revalidation retry and logging, clamped verification retries, and the provider isolation boundary are all covered; a live signed revalidation and a real hero-image fetch clear end to end. |
|    12 | Operations, documentation, and release QA          | `IN_PROGRESS` |      85% | —         | GitHub Actions passes on the release candidate. Local release QA is clean: frozen install, environment/generated-contract checks, 364 unit, 147 integration, 61 signed-out/design and 15 authenticated browser checks, build, dependency audit, and tracked-secret scan pass. Hosted preview/production and owner sign-off remain. |

## Active phase checklist

### Phase 12 — Operations, documentation, and release QA

- [x] Separate the web and worker environment templates, validate them through the production
      schemas, reject misplaced secrets/placeholders, and prove shared origins/secrets agree.
- [x] Complete the README, clean-Windows bootstrap, Vercel/Supabase/Cloudflare deployment order,
      production smoke checks, rollback path, CLI sign-in, Hermes, and daemon documentation.
- [x] Replace the Server Action image-byte upload with a browser-to-private-Storage flow so the
      documented 10 MB limit works on Vercel, while preserving authorization and byte verification.
- [x] Run the complete clean database, security, accessibility, responsive, failure-recovery, and
      browser release-QA matrix and record screenshots/evidence.
- [x] Confirm the private GitHub Actions run for Phase 11 and the Phase 12 release candidate.
- [ ] Obtain owner design sign-off, deploy a preview, then production, and configure the exact
      Vercel-provided DNS values in Cloudflare.

### Phase 11 — Publishing, scheduling, and verification hardening

- [x] Finalize the atomic publishing service: storage copies use constrained, re-runnable public
      keys, and a failed copy is a transient stage failure that leaves nothing to clean up.
- [x] Finalize scheduled-job claiming: schedules are instants, a schedule beyond a one-year horizon
      is rejected, and claim eligibility and publication eligibility are checked independently.
- [x] Finalize signed revalidation: bounded retries with a fresh signature per attempt, no retry of
      a rejected signature, and every attempt recorded through `record_revalidation`.
- [x] Finalize verification retries: the worker supplies the `verify` stage backoff,
      `record_verification` clamps it to between now and an hour out, and an exhausted job names the
      checks that failed.
- [x] Make `hero_image_ok` resolve the rendered hero image over HTTP so a partially available page
      cannot verify.
- [x] Test simultaneous publish attempts, slug and alias conflicts, schedule timezone edges, storage
      failures, stale cache, and partially available public pages.
- [x] Prove provider modules cannot directly mark content published.
- [x] Run the complete database, type, unit, build, and browser verification gate.

### Phase 10 — Optional API adapters

- [x] Add credential-gated OpenAI research/audit and Anthropic draft/revision adapters using the
      existing prompts and normalized Zod schemas.
- [x] Add credential-gated Gemini image generation with the existing slot contracts and image
      artifact lifecycle.
- [x] Persist provider usage metadata, classify/redact API failures, and prove no automatic fallback.
- [x] Require a clear metered-cost warning and explicit confirmation before enabling an API mode.
- [x] Exercise a switched API stage through the production queue boundary with mocked HTTP responses.
- [x] Run the complete database, type, unit, build, and browser verification gate.

### Phase 9 — Subscription CLI providers

- [x] Re-inspect the installed CLIs: Claude Code 2.1.275 and codex-cli 0.146.0 help, sign-in status,
      structured output, and their real signed-out, API-key, usage-limit, and 401 outputs.
- [x] Claude Code first (draft and revision): `-p --output-format json --json-schema`, no tools, safe
      mode, no user settings or MCP, editorial system prompt, prompt on stdin.
- [x] Codex through `codex exec` (research and audit): ignored user config, strict config, read-only
      sandbox, ephemeral, output schema and last-message file, live web search for research only.
- [x] Capability probes before every prompt (version, required options, sign-in); billable sign-ins
      refused; probe results in the heartbeat, `worker:status`, and the console Providers page.
- [x] Safe process isolation: no shell (npm shims resolved to their targets), allowlisted
      environment, empty scratch directory, timeouts, cancellation, output limits, process-tree kill.
- [x] Error classification and redaction: auth, usage limit, rate limit, transient, invalid output,
      permanent configuration; auth and usage limits go to an editor and never fall back to an API.
- [x] Selectable per stage: registry, console, and `admin_update_provider_setting` accept
      `claude_code` and `codex_cli`.
- [x] Exit criterion, locally: CLI output is normalized by the same Zod contracts as mock and manual
      output, and a signed-out CLI produces an actionable `NEEDS_HUMAN` state (database suite).
- [x] Live Claude Code draft from the production prompt and schema.
- [x] Live Codex research run from the production prompt and schema.

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
- **Superseded in Phase 12: the admin proxy buffered up to 11 MB.** That matched the old 11 MB image
  Server Action, but Vercel caps function requests below the application's 10 MB image contract.
  Images no longer enter Next.js request bodies, so the proxy override is removed and Server Actions
  are capped at 2 MB for the one-million-character manual JSON input.
- **Resolved in Phase 12: manual images bypass Vercel's 4.5 MB request limit.** After an authorized
  preflight, the browser uploads to a signed, immutable private Storage path constrained to the live
  manual job/run/slot. The finalize action downloads and inspects the object and supplies only
  derived type, dimensions, size, and hash to `admin_import_manual_image`, which checks Storage
  metadata again. A 5,000,068-byte browser fixture completes the full manual pipeline to `VERIFIED`
  while every Next Server Action request stays below 1 MB.
- **Decision: subscription CLIs run with no shell and an allowlisted environment (ADR 0007).** npm
  installs both CLIs as `.cmd` shims; the worker resolves a shim to its real target (Claude Code's
  `claude.exe`, Codex's `codex.js` under the worker's Node) and never passes arguments through
  `cmd.exe`, which matters because `--json-schema` takes inline JSON only. The worker's own
  `process.env` holds the service-role key loaded from `.env.local`, so a child gets a fresh
  allowlisted environment instead; API keys are excluded by construction.
- **Decision: a CLI is probed before every prompt, and a billable sign-in is refused.** The probe is
  version, required options (cached per version), and the CLI's offline sign-in report. Claude Code is
  accepted only with `authMethod` `claude.ai` or `oauth_token` on `firstParty`; Codex only with
  "Logged in using ChatGPT". An API-key sign-in is an `auth` failure (console: "CLI sign-in needed"),
  never a quiet switch to per-request billing. The probe also spares a signed-out Codex its minute of
  401 retries.
- **Decision: CLI runs ignore the owner's own configuration.** Claude Code runs with `--safe-mode`,
  `--setting-sources ""`, `--strict-mcp-config`, no tools, and a short editorial system prompt, which
  also cut its prompt-cache creation from about 9.8k to 1.1k tokens. Codex runs with
  `--ignore-user-config`, so the owner's `config.toml` model (`gpt-5.6-sol`, `xhigh`) does not apply;
  `CODEX_MODEL` and `CODEX_REASONING_EFFORT` set them for the worker explicitly.
- **Decision: research gets live web search; the audit gets none.** Research must cite real, current
  sources. The audit judges the draft against the research packet. `--strict-config` makes Codex
  reject a mistyped `web_search` value rather than ignore it (verified against `bogus`).
- **Decision: the CLI schema is a strict-mode projection; Zod stays the authority.** Zod's JSON Schema
  includes keywords OpenAI strict mode rejects (including `format: "starts_with"`). The CLI receives
  types, properties, enums, and nullability with every property required; lengths, patterns, and
  cross-field rules are enforced afterwards by the same Zod schema as every other mode.
- **Decision: subscription usage is usage, not cost.** A CLI run records tokens, turns, CLI version,
  and `billing: "subscription"`; the cost columns stay empty. Claude Code's list-price figure is kept
  as `list_price_estimate_usd` for comparison only.
- **Decision: invalid CLI output keeps an excerpt, not the whole reply.** `provider_runs` has no raw
  output column, so a rejected reply is summarized (redacted excerpt plus the first Zod issues) in the
  run's error summary and the job's action message. A valid reply is retained as its artifact.
  Adding a bounded raw-output column is a candidate for Phase 11 if editors need the full text.
- **Decision: auth and usage-limit runs are recorded as not retryable.** The provider run's
  `retryable` flag now matches the queue outcome: those classes go to an editor and are never retried
  automatically. The `cli_auth` action label became "CLI sign-in needed", since it now also covers a
  missing CLI and a billable sign-in.
- **Decision: cache invalidation failure cannot undo publication.** Revalidation runs after the
  publication transaction and reports a safe boolean. The live verifier remains the correctness
  boundary and uses the existing bounded retry path if the rendered page is stale or unavailable.

## Completion log

### 2026-09-21 — Phase 12 release candidate passes GitHub Actions

Date/time: 2026-09-21 11:00, Asia/Singapore

Phase/task: Phase 12 — confirm private GitHub Actions

Status change: Phase 12 remains `IN_PROGRESS`, progress 80% -> 85%. The CI checklist item is complete.

What changed: Installed GitHub CLI 2.101.0 and signed in as `nobledev89` (SSH protocol), so private
Actions runs can now be inspected from this environment. No product files changed.

Files/migrations affected: `docs/IMPLEMENTATION-STATUS.md` only.

Verification performed: `gh run list` and `gh run view` on `nobledev89/FTP`. Phase 11 run
`35546977903` on `557a63b` completed `success`. Run `35548697053` on `6ff36bc` was cancelled after
46–52s by the workflow's `ci-refs/heads/main` concurrency group when `5ac8322` was pushed. `git diff
6ff36bc 5ac8322` changes only `docs/IMPLEMENTATION-STATUS.md`, so run `35548731358` on `5ac8322`
tests the release-candidate code: all three jobs passed — "Lint, typecheck, test, build" (1m14s),
"Design review (Playwright)" (1m42s, 61 passed, 15 skipped), and "Supabase schema, RLS, and queue"
(3m40s, including 15 authenticated browser checks). The only annotation is GitHub's notice that
`ubuntu-latest` migrates to Ubuntu 26 from 2026-10-19.

Result: Passed. The release candidate is confirmed in a clean hosted environment.

Commit/PR: `5ac8322` (CI evidence for `6ff36bc`).

Next action: Owner design sign-off, then a preview deployment and smoke test with the owner's
Vercel, Supabase, and Cloudflare accounts. Re-check CI after the Ubuntu 26 runner migration.

### 2026-09-21 — Phase 12 release candidate pushed

Date/time: 2026-09-21 08:45, Asia/Singapore

Phase/task: Phase 12 — release-candidate publication

Status change: Phase 12 remains `IN_PROGRESS` at 80%. The fully verified local release candidate is
now available on the tracked remote branch; private hosted CI and deployment gates remain open.

What changed: Committed the Phase 12 environment contracts, operator documentation, direct private
Storage upload flow, migration, security hardening, and release-QA evidence as `6ff36bc`, then pushed
the commit to `origin/main`.

Files/migrations affected: No product files changed after the verified release-candidate commit;
this entry records its publication evidence.

Verification performed: `git push origin main` completed successfully and advanced the remote from
`557a63b` to `6ff36bc`. The local `main` branch then reported clean and aligned with `origin/main`.

Result: Passed. The Phase 12 release candidate is committed and pushed without altering the clean
local-QA result recorded below.

Commit/PR: `6ff36bc` (`feat: prepare phase 12 release operations`), pushed to `origin/main`.

Next action: Confirm the private GitHub Actions result for `6ff36bc`, then use the owner-controlled
Vercel, Supabase, and Cloudflare accounts to deploy and smoke-test a preview.

### 2026-09-21 — Phase 12 local release QA complete

Date/time: 2026-09-21 08:44, Asia/Singapore

Phase/task: Phase 12 — clean release-candidate verification

Status change: Phase 12 remains `IN_PROGRESS`, progress 55% -> 80%. Local release QA is complete;
hosted CI confirmation, owner design sign-off, preview/production deployment, and Cloudflare DNS
remain open.

What changed: Ran the complete documented preflight from the current tree. The tracked-secret scan
found two credential-shaped but synthetic Anthropic/Google strings in a redaction unit test; those
fixtures are now assembled at runtime, preserving the redaction check without leaving token-shaped
source text that can trip push protection. No product logic changed in this final QA step.

Files/migrations affected: `local-worker/src/logging/redact.test.ts`; this status record. The release
candidate also includes all files listed in the two Phase 12 entries below.

Verification performed: `pnpm install --frozen-lockfile` succeeds from the pinned lockfile.
`pnpm env:check:examples`, `pnpm prompts:seed --check`, and `pnpm contracts:sync --check` pass.
`pnpm db:types` regenerates both TypeScript files with no diff. The fresh database evidence from the
direct-upload task applies all 15 migrations and both seeds; `pnpm db:lint` is clean.
`pnpm test:integration` passes 147 tests again without a reset after the authenticated browser runs,
covering RLS/access matrices, concurrent claims, lease expiry/recovery, stage failure branches,
manual/API/mock pipelines, publishing races, signed revalidation, and live verification.
`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (364 tests in 43 files), and
`pnpm build` pass. `pnpm audit --prod --audit-level high` reports no known vulnerabilities. The final
tracked-file scan finds no provider- or Supabase-secret-shaped values. `pnpm test:e2e` passes 61
checks (15 authenticated checks correctly skipped without credentials): signed-out authorization,
same-origin actions, no data leakage, labelled login, noindex, mobile fit, all public/admin review
screens at 375/768/1024/1440 px, keyboard menu containment, reduced motion, and the 404. The separate
`pnpm test:e2e:admin` run passes 15 checks against local Supabase, including the 5 MB direct upload,
full manual pipeline, live publication, real revalidation, real hero fetch, access boundaries,
optimistic-lock race, metered confirmation, sign-out, and 375/1440 px overflow checks. Screenshots
are in `test-results/`.

Result: Passed locally. The tree meets the local Phase 12 release-candidate gate with no known
production dependency vulnerability or credential-shaped tracked value. External deployment and
human design approval are not claimed.

Commit/PR: not yet committed.

Next action: Commit and push the Phase 12 release candidate, then confirm GitHub Actions.

### 2026-09-21 — Phase 12 direct manual-image uploads

Date/time: 2026-09-21 08:38, Asia/Singapore

Phase/task: Phase 12 — remove the Vercel manual-image request-size blocker

Status change: Phase 12 remains `IN_PROGRESS`, progress 30% -> 55%. The production request-size
blocker is resolved; the current task moves to the clean release-QA matrix.

What changed: Replaced the image-bearing Server Action with a two-action, direct-Storage protocol.
The preflight re-authorizes editor access, proves the job is waiting on that manual Gemini run and
slot, generates an immutable UUID path, and returns Supabase's short-lived path-scoped upload token.
The browser uploads the file directly to `article-work`, then sends only the path and editorial
metadata to the finalize action. Finalization re-authorizes and re-reads the run, constrains the path,
downloads the private object, identifies PNG/JPEG/WebP/AVIF from magic bytes, derives dimensions,
size and SHA-256, checks the extension, and calls the existing atomic import RPC. The database RPC
still verifies Storage's size/MIME metadata. A new Storage policy allows editor inserts only when the
path names the exact live `manual_gemini` job/run/requested slot; generic existing-job paths, stale
runs, unrequested slots, viewers, outsiders, overwrites, and deletes are refused. Reduced the Server
Action body cap from 11 MB to 2 MB and removed the proxy buffer override. Updated the console,
architecture, Supabase, and deployment docs.

Files/migrations affected: new
`supabase/migrations/20260921110000_direct_manual_image_uploads.sql`; `next.config.ts`;
`src/lib/admin/manual-actions.ts`, `action-result.ts`, `image-file.ts`, new `image-file.test.ts`;
new `src/lib/supabase/browser.ts`; `src/components/admin/manual-action-panel.tsx`;
`tests/integration/storage.test.ts`, `schema.test.ts`, `mock-pipeline.test.ts`;
`tests/e2e/admin-session.spec.ts`; `docs/ADMIN-CONSOLE.md`, `ARCHITECTURE.md`, `SUPABASE.md`, and
`DEPLOYMENT.md`.

Verification performed: A fresh `pnpm supabase:reset` applied all 15 migrations and both seeds.
`pnpm db:lint` reports no schema errors. `pnpm test:integration` passes 147 tests after updating the
exact private-helper grant snapshot; the first run had 146 behavioural passes and only that stale
snapshot failure. `pnpm test` passes 364 tests in 43 files, including byte-derived metadata, disguised
non-image rejection, and pre-read size rejection. `pnpm lint`, `pnpm typecheck`, and
`git diff --check` pass. `pnpm test:e2e:admin` passes all 15 checks: the manual workflow uploads a
5,000,068-byte PNG directly to the local Supabase Storage endpoint, records the server-inspected byte
size, keeps all Next action requests below 1 MB, publishes the copy, fetches it live, and reaches
`VERIFIED`. An initial evidence assertion expected Playwright to expose multipart bytes through
`postDataBuffer()` (it reports zero for that request); the product flow succeeded, and the final test
uses direct request destination + stored server-derived size + bounded action requests instead.

Result: Passed. The documented 10 MB image contract no longer depends on Vercel's function request
limit, and direct upload authority is narrower than the prior editor Storage policy.

Commit/PR: not yet committed.

Next action: Run the complete clean database, security, accessibility, responsive,
failure-recovery, and browser release-QA matrix.

### 2026-09-21 — Phase 12 environment and operations baseline

Date/time: 2026-09-21 08:22, Asia/Singapore

Phase/task: Phase 12 — clean-environment contracts and operator/release documentation

Status change: Phase 12 `NOT_STARTED` -> `IN_PROGRESS` (30%). Phase 11 commit `557a63b` was pushed to
`origin/main`; its private GitHub Actions result remains unconfirmed because this environment has no
GitHub CLI or available authenticated browser.

What changed: Split the mixed `.env.example` into a web-only root template and a worker-only
`local-worker/.env.example`. Added `pnpm env:check`, `env:check:web`, `env:check:worker`, and
`env:check:examples`: the validator reuses the web and worker production schemas, rejects worker/API
secrets in the Vercel file, rejects unfilled placeholders, checks minimum secret length and bounded
worker timing rules, and proves the two processes point at the same Supabase/site origins and share
the exact revalidation secret without printing values. Added four validator tests and made the safe
example-contract check a CI step. Added a clean Windows setup guide and a deployment runbook covering
release preflight, hosted Supabase, Vercel preview/production, exact-value environment configuration,
Cloudflare DNS-only validation, production smoke tests, worker activation, rollback, and credential
rotation. Reconciled README, architecture, Supabase, worker, and Hermes docs with the new contracts;
removed the unused web `SUPABASE_URL` from the documented Vercel surface.

Files/migrations affected: `.env.example`, new `local-worker/.env.example`, `.gitignore`, new
`scripts/validate-env.mts` and `validate-env.test.mts`, `package.json`, `tsconfig.json`,
`vitest.config.mts`, `.github/workflows/ci.yml`, new `docs/WINDOWS-SETUP.md` and
`docs/DEPLOYMENT.md`, plus `README.md`, `docs/ARCHITECTURE.md`, `SUPABASE.md`, `LOCAL-WORKER.md`, and
`HERMES.md`. No migration.

Verification performed: Read the installed Next.js 16.3.5 deployment, environment-variable,
production, and TypeScript guides before changing the contracts. `pnpm env:check:examples` passes.
`pnpm format:check` and `pnpm lint` pass. `pnpm typecheck` passes for the web and worker. `pnpm test`
passes 361 tests in 42 files (four new environment/deployment tests). `pnpm build` completes the
production build. `git diff --check` passes. The first build correctly exposed explicit `.ts` import
extensions missing from the root compiler options; enabling `allowImportingTsExtensions` aligned the
Node 24 script with the no-emit typecheck, after which both typecheck and build passed.

Result: Passed locally. A clean operator now has separate least-privilege templates, can validate
both processes before startup, and has one ordered path from checkout through DNS and worker release.
Hosted deployment and full release QA remain open.

Commit/PR: not yet committed. Phase 11 commit `557a63b` pushed successfully to `origin/main`.

Next action: Replace Server Action image-byte uploads with an authorized direct-to-Storage flow that
retains server-side object verification and works up to the documented 10 MB limit on Vercel.

### 2026-09-21 — Phase 11 complete

Date/time: 2026-09-21 07:20, Asia/Singapore

Phase/task: Phase 11 — publishing, scheduling, and verification hardening

Status change: Phase 11 `NOT_STARTED` -> `COMPLETE`. Current task moves to Phase 12.

What changed:

- Live verification now proves the hero image resolves. `hero_image_ok` previously passed on any
  `<img>` carrying alt text, so an article whose public Storage copy never landed verified as
  correct. `heroImageUrl` takes the URL the page actually rendered and the verification service
  fetches it (`HEAD`, falling back to `GET` on `405`/`501`), failing the check unless it answers
  `2xx` with an `image/*` content type. A hero that cannot be resolved fails rather than being
  omitted, because `record_verification` requires all eight names.
- Cache revalidation is retried and recorded. `CacheRevalidationClient` retries transport failures,
  `429`, and `5xx` up to three times with a fresh timestamp, nonce, and signature per attempt so
  replay protection never rejects a legitimate retry; a rejected signature is not retried. A new
  `record_revalidation` RPC gives the previously unused `revalidate` log kind a writer, so a failed
  invalidation is visible in `publishing_logs` instead of silent. Publication has already committed
  by then, so neither the request nor the log entry can throw.
- Verification retries use the stage backoff. The verify handler passes
  `retryAt("verify", attempt, "transient")` instead of leaving the database to apply a flat two
  minutes, and `record_verification` clamps whatever it is given to between now and one hour out so
  a bad clock or argument cannot park a job. An exhausted job now names the failing checks in
  `action_required_message` and in the `verification.exhausted` event.
- Publishing storage copies are constrained. `publicImagePath` derives the public key from the slug
  and the working file name and strips anything outside `[A-Za-z0-9._-]`, so the key is always
  inside the `articles/` prefix `publish_article` requires and a repeated publish overwrites the
  same object. Storage download and upload failures are now raised as transient `WorkerStageError`s,
  so a failed copy retries rather than escalating an article that is otherwise ready.
- Schedules are bounded. A new `article_jobs_schedule_horizon` trigger rejects a
  `desired_publish_at` more than a year out with `FT005`, which catches a mistyped year that would
  otherwise sit in the queue claimable-never.

Files/migrations affected: `supabase/migrations/20260921100000_publishing_hardening.sql` (new:
`private.guard_schedule_horizon`, `public.record_revalidation`, replaced
`public.record_verification`); `local-worker/src/verification/checks.ts`, `verify.ts`,
`local-worker/src/publishing/publish.ts`, `revalidate.ts`, `local-worker/src/pipeline/handlers.ts`,
`local-worker/src/cli/main.ts`; regenerated `database.types.ts` for both packages; new
`local-worker/src/publishing/publish.test.ts` and `tests/integration/publishing.test.ts`; updated
`checks.test.ts`, `revalidate.test.ts`, `tests/integration/mock-pipeline.test.ts`,
`tests/e2e/admin-session.spec.ts`; docs `SUPABASE.md`, `STATE-MACHINE.md`, `PUBLICATION.md`,
`LOCAL-WORKER.md`.

Verification performed: `pnpm supabase:reset` applied all 14 migrations and both seeds from scratch.
`pnpm db:types` regenerated both type files. `pnpm db:lint` (`plpgsql_check`, fail on warning): no
schema errors. `pnpm format`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` are clean. `pnpm test`:
41 files, 357 tests pass (was 344). `pnpm test:integration`: 9 files, 147 tests pass (was 130), then
pass again without a reset. `pnpm test:e2e`: 61 signed-out/design checks pass. `pnpm test:e2e:admin`:
15 authenticated checks pass, including the live publication that now signs a real revalidation
request against the running site, has it accepted, refuses the unsigned one, and fetches the real
hero image from Supabase Storage before reaching `VERIFIED`.

The new integration suite covers: two transactions publishing the same job (one article, second call
`FT001`, one `job.published` event); a replayed publish on a settled lease; a slug reserved by an
alias (`FT006`); a slug collision escalating to `publish_conflict` with the approved draft intact;
two schedules inside the repeated Europe/London hour of 2026-10-25 staying distinct instants, with
only the passed one becoming claimable; a rescheduled job with a live lease still refusing to publish
early (`FT005`); a schedule past the one-year horizon rejected at both `create_article_job` and
`admin_transition_job`; a public image path outside `articles/` rejected (`22023`) and a repeated
path treated as a no-op; publication refused while a requested image has no public copy, then
retried back to `APPROVED`; a failed revalidation logged without touching the published article;
`record_revalidation` refused for an unpublished job and for a non-worker caller; a partially
available page (hero 404) staying `PUBLISHED` with a backed-off retry and unable to pass by skipping
the hero; a far-future retry clamped to an hour and a past retry pulled forward to now; exhausted
attempts naming both failed checks with the article still `published`; and the isolation boundary —
`complete_stage` to `PUBLISHED`, a direct `article_jobs` status write, a forged `articles` insert,
and a foreign worker's `publish_article` all refused, with no article written.

Result: Passed. Two workers cannot publish the same job twice, a scheduled article publishes only at
its instant, a cache failure is recorded rather than lost, and an article whose page or hero image is
not actually available to a reader stays `PUBLISHED` and never reaches `VERIFIED`.

Commit/PR: committed on `main`; not yet pushed.

Next action: Push the Phase 11 commit, confirm GitHub Actions, then start Phase 12 operations,
documentation, and release QA.

### 2026-09-18 — Phase 10 pushed; GitHub CI passes

Date/time: 2026-09-18 17:14, Asia/Singapore

Phase/task: Phase 10 — clean-environment verification after the requested push

Status change: No phase change; Phase 10 remains `COMPLETE`. Its local evidence is now confirmed by
GitHub Actions, and the current task moves to Phase 11.

What changed: Pushed the Phase 10 implementation commit `cd51658` and completion record `3c13d0c` to
`origin/main`.

Files/migrations affected: No implementation change in this follow-up; this status entry records the
remote verification result.

Verification performed: GitHub Actions run `35328011150` on `3c13d0c` completed with all three jobs
`success`: **Lint, typecheck, test, build**, **Design review (Playwright)**, and **Supabase schema,
RLS, and queue**. The database job applied the new API-mode migration from a fresh reset and ran the
integration and authenticated-browser suites in the clean Linux runner.

Result: Passed locally and in GitHub CI.

Commit/PR: `cd51658` and `3c13d0c` on `main`; this documentation-only evidence commit follows them.

Next action: Start Phase 11 publishing, scheduling, and verification hardening.

### 2026-09-18 — Phase 10 optional API adapters complete

Date/time: 2026-09-18 17:08, Asia/Singapore

Phase/task: Phase 10 — credential-gated API execution, metered usage records, and explicit billing
confirmation

Status change: Phase 10 `IN_PROGRESS` (85%) → `COMPLETE`. Current task moves to Phase 11.

What changed: Added bounded, cancellable HTTP adapters for OpenAI Responses research/audit,
Anthropic Messages draft/revision, and Gemini image generation. Each adapter reuses the production
prompt builder and the same Zod normalization contract as mock, manual, and CLI modes. Research alone
gets OpenAI web search; Gemini runs once per image slot, validates supported image bytes and
dimensions, hashes them, and hands them to the existing private artifact store. Provider/model,
response IDs, token/cache/tool counts, request counts, and `billing: "metered_api"` are stored as run
usage; mutable provider list prices are deliberately not converted into a monetary cost. HTTP
failures use the existing auth, usage-limit, rate-limit, transient, invalid-output, and configuration
classes, with response caps and centralized redaction. The worker boots without optional keys in
free modes, validates keys for API providers selected at startup, and refuses a dynamically selected
mode without its key rather than falling back. Added a migration and admin flow that require a
metered-cost checkbox, store the confirming editor/time, keep draft/revision aligned, and clear the
confirmation on a free mode. Updated environment and operator documentation.

Files/migrations affected: `local-worker/src/providers/api/**`, the provider registry, pipeline,
worker configuration/startup, image store, manual image prompt helper, provider admin action/form,
provider pages/mode allowlists, `20260918150000_api_provider_modes.sql`, generated database types,
API unit/integration/browser tests, `.env.example`, README, and provider/worker/admin/Supabase/
architecture documentation.

Verification performed: A fresh `pnpm supabase:reset` applied all twelve migrations and seed;
`pnpm db:lint` returned no warnings; `pnpm db:types` regenerated both clients with no drift.
`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and the Next.js 16.3.5 production build passed.
`pnpm test` passed 344 tests in 40 files. `pnpm test:integration` passed 130 tests in 8 files,
including one confirmed OpenAI research stage proceeding through the real queue, artifact, publish,
and verification boundaries to `VERIFIED` while every other stage stayed mock. `pnpm test:e2e`
passed 61 signed-out/design checks; `pnpm test:e2e:admin` passed 15 authenticated checks, including
the required confirmation, recorded identity/timestamp, new-job availability, and clearing consent.
Provider calls in automated tests use injected HTTP responses, so verification incurred no external
AI charge. `git diff --check` is clean.

Result: Passed. The Phase 10 exit criterion is met: adding the selected key and confirming one stage
is sufficient, with no pipeline redesign and no fallback behavior.

Commit/PR: Phase 10 implementation commit `cd51658`; the documentation commit containing this entry
follows it on `main`.

Next action: Commit and push Phase 10, confirm GitHub Actions, then begin Phase 11 hardening.

### 2026-09-18 — Phase 9 committed for GitHub CI

Date/time: 2026-09-18 14:28, Asia/Singapore

Phase/task: Phase 9 — owner-authorized commit and push

Status change: No phase change; Phase 9 remains `COMPLETE`. The verified implementation moves from
the working tree to `main` for clean-environment CI.

What changed: Committed the complete Phase 9 implementation as `c84b67b`
(`feat: add subscription CLI providers`). This status update follows that implementation commit in
the same push.

Files/migrations affected: `docs/IMPLEMENTATION-STATUS.md` only in this follow-up; the implementation
files and migration are listed in the Phase 9 entry below.

Verification performed before commit: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
`pnpm build`, 335 unit tests, and 129 integration tests passed. `git diff --check` was clean. The live
Claude Code and Codex runs described below passed their production artifact schemas.

Result: Passed locally; GitHub CI is the next verification boundary.

Commit/PR: Phase 9 implementation commit `c84b67b`; the documentation commit containing this entry
follows it on `main`.

Next action: Confirm the GitHub Actions result for this push, then begin Phase 10.

### 2026-09-18 — Phase 9 subscription CLI providers complete

Date/time: 2026-09-18 14:07, Asia/Singapore

Phase/task: Phase 9 — live Codex verification and phase exit

Status change: Phase 9 `IN_PROGRESS` (95%) → `COMPLETE`. Current task moves to Phase 10.

What changed: No code changed. The live Codex run recorded as pending in the previous entry was
executed once the ChatGPT usage limit reset.

Files/migrations affected: `docs/IMPLEMENTATION-STATUS.md` only.

Verification performed: At 14:02 `codex login status` reported "Logged in using ChatGPT". The
production `codex_cli` research adapter then ran `prompts/research.md` with the editorial style guide
(9,746 characters) through the real resolver, allowlisted environment, capability probe, and
`codex exec` arguments, with the projected `research-1` schema as `--output-schema`. OpenAI's strict
structured outputs accepted the schema, and the reply passed the full `research-1` Zod contract,
including unique keys and evidence references to existing sources, in 196 seconds: 18 sources (FCA,
PSR, HM Treasury, Open Banking Limited, CMA, legislation.gov.uk), 12 claims, 14 facts, 4
contradictions, and an 8-section recommended structure, from 4 live web searches. Usage was recorded
as `billing: "subscription"` (166,758 input tokens, 118,272 cached, 8,030 output). Together with the
live Claude Code draft in the previous entry, both CLIs have produced schema-valid artifacts from the
production prompts, and the Phase 9 exit criterion is met: each CLI is selectable per stage, its
output is normalized by the same contracts as mock and manual output, and a signed-out CLI produces
an actionable `NEEDS_HUMAN` state.

Result: Passed. Phase 9 is complete locally.

Commit/PR: Not committed. The base is `627ebd8` on `origin/main`.

Next action: Owner review, then commit and push Phase 9 so GitHub CI verifies it in a clean
environment. Phase 10 then adds the optional API adapters behind explicit configuration and cost
confirmation.

### 2026-09-18 — Phase 9 subscription CLI providers implemented; live Codex run pending

Date/time: 2026-09-18 13:25, Asia/Singapore

Phase/task: Phase 9 — Claude Code and Codex adapters, capability probes, process isolation, error
classification, console selection, and documentation

Status change: Phase 9 `NOT_STARTED` → `IN_PROGRESS` (95%). It moves to `COMPLETE` once the live
Codex research run is recorded.

What changed: Re-inspected both installed CLIs and captured their real success, signed-out, API-key,
usage-limit, and 401 outputs as test fixtures. Added `local-worker/src/providers/cli/`: a no-shell
command resolver that maps npm `.cmd` shims to their executable or Node entry point; an allowlisted
child environment; a bounded process runner with timeout, output cap, cancellation, and process-tree
kill; a strict-mode JSON Schema projection of the Zod contracts and a single bounded JSON repair; a
shared probe (version, required options, sign-in) run before every prompt; the Claude Code client
(draft, revision) and the Codex client (research with live web search, audit without); stage adapters
that reuse the reviewed prompt preparation and validate with the shared Zod schemas; a capability
monitor that puts CLI state in the worker heartbeat and `worker:status`; and a scripted fake CLI for
tests. The registry, pipeline handlers, worker entry point, and environment contract (`CLAUDE_MODEL`,
`CODEX_MODEL`, `CODEX_REASONING_EFFORT`, `CLI_TIMEOUT_MS`) were extended. Migration
`20260918140000_subscription_cli_modes.sql` lets editors select both CLI modes as defaults; the
console offers them on New article and Providers, and the Providers page gained a Subscription CLIs
panel read from the heartbeat. Wrote `docs/PROVIDERS.md` and ADR 0007, and updated the worker,
console, and architecture guides, README, and `.env.example`. Fixed a race in the no-membership
browser test (it read a response body after a later navigation), which failed once locally.

Files/migrations affected: `supabase/migrations/20260918140000_subscription_cli_modes.sql`;
`local-worker/src/providers/cli/**` (new), `local-worker/src/providers/{registry.ts,
manual/adapters.test.ts}`, `local-worker/src/pipeline/handlers.ts`, `local-worker/src/cli/main.ts`,
`local-worker/src/queue/{runner.ts,runner.test.ts}`, `local-worker/src/config/env.ts`;
`src/lib/admin/{cli-capability.ts,cli-capability.test.ts,provider-modes.ts,configuration.ts,
status-display.ts,status-display.test.ts}`, `src/components/admin/provider-setting-form.tsx`, the
Providers page; `tests/integration/mock-pipeline.test.ts`, `tests/e2e/admin-session.spec.ts`;
`docs/{PROVIDERS,LOCAL-WORKER,ADMIN-CONSOLE,ARCHITECTURE}.md`,
`docs/decisions/{0007-subscription-cli-process-boundary.md,README.md}`, `README.md`,
`.env.example`.

Verification performed: A fresh `pnpm supabase:reset` applies all twelve migrations and both seed
files; `pnpm db:lint` reports no schema errors; `pnpm db:types` is unchanged. `pnpm format:check`,
`pnpm lint`, `pnpm typecheck`, `pnpm prompts:seed --check`, and `pnpm contracts:sync --check` pass.
`pnpm test` passes 335 tests in 38 files, including shim resolution from the real npm shims, the
environment allowlist, real child processes for argv/stdin, timeout, output-limit, cancellation, and
missing-binary cases, classification of every captured CLI output, the strict schema projection, and
fake-CLI adapter runs asserting the exact arguments, the prompt, and that no secret or API key reached
any invocation. `pnpm test:integration` passes 129 tests in 8 files, including four new database
scenarios: Codex research and audit with Claude Code writing reach `VERIFIED` through the real stores,
Storage, publication, and verifier, with each CLI receiving exactly its snapshotted prompt and usage
recorded as subscription with no cost; a signed-out Claude Code reaches `NEEDS_HUMAN` with `cli_auth`
before any prompt is sent and keeps its mode; a Codex usage limit reaches `NEEDS_HUMAN` with
`usage_limit`, no retry, and no mode change; and schema-invalid CLI output reaches `invalid_output`
with the failing field named. The provider-default test now accepts both CLI modes and still refuses
every API mode. `pnpm build` completes. `pnpm test:e2e` passes 61 checks (14 database checks skipped
by design). `pnpm test:e2e:admin` passes all 14 checks, including the CLI modes offered on New article
and Providers and the Providers page at 375 and 1440 px without overflow; its first run failed once
in the unrelated no-membership test (the race fixed above) and passed on the rerun and after the fix.
Live, against the owner's subscriptions: the Claude Code probe reports 2.1.275 signed in to a
subscription; a trivial structured run succeeded with the production arguments; and a real draft
from `prompts/draft.md`, the style guide, and the projected draft schema returned a 769-word
explainer in 81 seconds that passed the full `draft-1` Zod contract (one 16:9 hero brief, source keys
drawn from the packet). The Codex probe reports 0.146.0 signed in with ChatGPT, and `pnpm
worker:status` with a temporary local environment (removed afterwards) reported both CLIs ready. A
live Codex prompt was not possible: the ChatGPT account reported "You've hit your usage limit … try
again at 2:00 PM"; that real message is now a test fixture.

Result: Passed locally, except the live Codex run, which is pending.

Commit/PR: Not committed. The base is `627ebd8` on `origin/main`.

Next action: Run and record the live Codex research run at 14:02, then owner review, commit, and push
so CI verifies Phase 9 in a clean environment.

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
