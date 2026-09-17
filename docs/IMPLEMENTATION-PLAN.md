# FinTechPulse — Full Implementation Plan

Status: implementation-ready plan; application code has not yet been created  
Prepared: 2026-09-17  
Primary public-design reference: [Afeng01/paperframe](https://github.com/Afeng01/paperframe)  
Reference snapshot reviewed: commit `c4a904200dc39fbffd8adaac5c726886d8893ac9` (`v0.2.0`, 2026-06-21)  
Canonical project repository: [nobledev89/FTP](https://github.com/nobledev89/FTP)  
Git remote: `git@github.com:nobledev89/FTP.git`  
Production domain: [fintechpulse.co.uk](https://fintechpulse.co.uk)  
License: MIT; preserve Paperframe's copyright and license notice for reused code

## 1. Outcome

Build a production-capable first version of an automated editorial publishing platform with:

- FinTechPulse as a UK-first financial and fintech publication intended to become a trusted go-to source for the UK market;
- a public, content-first publication hosted on Vercel;
- a separate authenticated admin application hosted in the same Next.js project;
- Supabase Postgres, Auth, and Storage as the shared cloud data layer;
- a TypeScript worker running only on the owner's Windows PC;
- Hermes invoking the worker through stable shell commands;
- provider modes that work with mock data, manual subscription workflows, supported subscription-authenticated CLIs, or optional APIs;
- a strict, auditable article state machine with versioned artifacts;
- no inbound connection to the local PC;
- no required paid AI API keys in version 1.

The first release is complete only when a job can travel through the full mock pipeline, be reviewed in the admin dashboard, publish to the public site, and pass post-publish verification.

## 2. Fixed product decisions

These decisions are constraints, not optional suggestions:

1. The root project is one Next.js App Router application deployed to Vercel.
2. `/local-worker` is a separate Node/TypeScript package in the same pnpm workspace and is never deployed to Vercel.
3. The local worker initiates all network traffic. No local port, Cloudflare Tunnel, webhook receiver, or Vercel-to-PC connection is required.
4. Supabase is the queue boundary and source of truth for jobs, artifacts, events, publication state, and worker health.
5. AI providers cannot publish. Only the publishing service may execute the `PUBLISHING -> PUBLISHED` transition.
6. API mode is opt-in per stage and disabled by default. The system never silently falls back from a subscription/manual mode to a billable API.
7. Public and admin interfaces use separate route layouts and separate visual systems.
8. Paperframe is the public visual baseline. Its MDX loader is not the production content source.
9. Database article bodies are Markdown, not executable MDX. Raw HTML is disabled in version 1.
10. Every provider result, prompt snapshot, draft, audit, image brief, publish attempt, and important state change is retained.
11. Expected manual work is represented as a stage waiting for input, not as a failure. `NEEDS_HUMAN` is reserved for exceptional intervention.
12. Version 1 supports one site/publication but uses `site_id` where it avoids an expensive future migration.
13. `docs/IMPLEMENTATION-STATUS.md` is the live execution record. It must be updated immediately whenever a task, test gate, phase exit criterion, or milestone is completed.
14. The canonical production origin is `https://fintechpulse.co.uk`; use the apex domain and redirect `www` to it unless a later deployment decision explicitly reverses that direction.

### 2.1 Publication identity and UK editorial remit

FinTechPulse is not a generic technology blog or SaaS marketing site. It is a UK-focused financial publication covering the intersection of finance, financial technology, institutions, regulation, products, infrastructure, markets, and consumer/business impact.

Initial content types should support news, analysis, explainers, practical guides, company/product coverage, and interviews. The exact launch taxonomy must be validated during editorial setup, but likely top-level beats include banking, payments and open banking, lending, wealth and investing technology, insurance technology, digital assets, regulation and policy, and fintech companies. Do not create empty categories merely to fill navigation.

Publication defaults:

| Setting | Required default |
|---|---|
| Brand | FinTechPulse |
| Canonical origin | `https://fintechpulse.co.uk` |
| Primary market | United Kingdom |
| Language/locale | English (United Kingdom), `en-GB` |
| Editorial timezone | `Europe/London` |
| Default currency | GBP (`£`) |
| Date style | UK-readable day-month-year formatting |
| Public positioning | A trusted UK go-to source for financial and fintech information |

Research and editorial prompts must prefer authoritative UK primary sources when relevant, including the FCA, Prudential Regulation Authority/Bank of England, HM Treasury, Payment Systems Regulator, Competition and Markets Authority, Companies House, Office for National Statistics, UK Parliament and legislation, official company filings, and first-party product documentation. Claims must retain jurisdiction and effective dates so US or global rules are not accidentally presented as UK rules.

Version 1 publishes general editorial information, not personalised financial, investment, tax, credit, insurance, or legal advice. Pages must distinguish reporting from guidance, avoid promises of returns or outcomes, identify material conflicts/sponsorship, and carry appropriate publication-level and article-level disclosures. Any future calculators, comparisons, lead generation, affiliate placements, or regulated recommendations require a separate legal/compliance review before implementation.

Trust features are product requirements: visible author/byline, published and materially updated dates, source references, correction history where applicable, editorial/contact information, sponsorship disclosure, and clear ownership. The audit stage must flag unsupported financial claims, stale rates/fees/regulatory details, missing jurisdiction, misleading certainty, and absent risk context.

## 3. Reference and toolchain snapshot

### Canonical GitHub repository

The empty GitHub repository at `nobledev89/FTP` is the canonical source repository. Use `main` as the production branch and `origin` as the remote name.

For this currently uninitialized local workspace, the initial connection sequence is:

```powershell
git init
git branch -M main
git remote add origin git@github.com:nobledev89/FTP.git
git add .
git commit -m "docs: add implementation plan"
git push -u origin main
```

Before running the sequence, review `git status` and confirm that `.env*`, local credentials, generated files, and temporary Paperframe reference files are excluded. If SSH authentication is not configured, use `https://github.com/nobledev89/FTP.git` for `origin` instead. Do not create a second remote if `origin` already exists; verify it with `git remote -v` and update it deliberately if necessary.

### Paperframe findings

The reviewed Paperframe snapshot uses Next.js App Router, React, Tailwind CSS 4, `next/font`, schema-validated local MDX, a fixed header, serif-led headlines, sans body copy, mono metadata, thin stone borders, restrained light/dark section contrast, and almost no decorative effects.

The implementation may adapt its layout and presentational component code, but must replace:

- `src/content/**` local files;
- `gray-matter` loaders;
- `next-mdx-remote/rsc` as the database article path;
- static content selectors and build-time slug enumeration.

They will be replaced with server-only Supabase repositories, Zod-validated database DTOs, and a safe Markdown renderer.

If Paperframe code is copied rather than independently reimplemented, add its MIT text to `THIRD_PARTY_NOTICES.md` and retain the required notice in substantial copied files or the repository license documentation.

### Dated environment check

Observed on 2026-09-17:

| Tool | Observed version/capability |
|---|---|
| Node.js | `20.19.4` |
| pnpm | `10.32.1` |
| Next.js on npm | `16.3.5` |
| Supabase JS on npm | `2.116.0` |
| Zod on npm | `4.6.5` |
| Codex CLI | `0.146.0`; non-interactive `codex exec` is available |
| Claude Code | `2.1.144`; `claude -p`, JSON output, and JSON Schema output are available |

Re-run version/help checks immediately before implementing CLI adapters. Do not assume this snapshot remains current. Pin exact package versions in the lockfile after scaffolding and record the selected Node version in `.nvmrc` and `package.json#engines`.

## 4. Target architecture

```text
Public/admin browser
        |
        v
Cloudflare DNS (`fintechpulse.co.uk` remains here)
        |
        v
Vercel: Next.js App Router
  |-- public publication
  |-- authenticated admin
  |-- server actions/route handlers
  `-- signed cache revalidation endpoint
        |
        v
Supabase
  |-- Postgres + RLS
  |-- Auth
  `-- Storage
        ^
        | outbound HTTPS only
        |
Windows PC
  |-- Hermes scheduler/monitor
  `-- local-worker
       |-- queue claimant + lease renewal
       |-- mock/manual/CLI/API provider adapters
       |-- publishing service
       `-- public URL verifier
```

### Trust boundaries

- The browser receives only the Supabase URL and public/publishable key.
- Admin writes use an authenticated user session and server-side authorization/RLS.
- The Supabase service-role secret exists only on the local PC worker, never in browser code or `NEXT_PUBLIC_*` variables.
- Optional AI API credentials exist only in the worker environment.
- Manual provider responses are untrusted input and must pass size limits plus Zod validation.
- Published Markdown is rendered with raw HTML disabled. Provider output is never injected with `dangerouslySetInnerHTML`.

## 5. Planned repository structure

```text
/
|-- src/
|   |-- app/
|   |   |-- (public)/
|   |   |   |-- page.tsx
|   |   |   |-- blog/page.tsx
|   |   |   `-- blog/[slug]/page.tsx
|   |   |-- admin/
|   |   |   |-- login/page.tsx
|   |   |   `-- (protected)/...
|   |   |-- api/
|   |   |   |-- revalidate/route.ts
|   |   |   `-- health/route.ts
|   |   |-- feed.xml/route.ts
|   |   |-- robots.ts
|   |   `-- sitemap.ts
|   |-- components/
|   |   |-- public/
|   |   |-- admin/
|   |   `-- shared/
|   |-- lib/
|   |   |-- auth/
|   |   |-- content/
|   |   |-- state-machine/
|   |   |-- supabase/
|   |   |-- validation/
|   |   `-- publishing/
|   `-- styles/
|-- local-worker/
|   |-- src/
|   |   |-- cli/
|   |   |-- queue/
|   |   |-- pipeline/
|   |   |-- providers/
|   |   |   |-- openai/
|   |   |   |-- claude/
|   |   |   `-- gemini/
|   |   |-- publishing/
|   |   `-- verification/
|   |-- package.json
|   `-- tsconfig.json
|-- prompts/
|   |-- editorial-style.md
|   |-- research.md
|   |-- draft.md
|   |-- image-brief.md
|   |-- audit.md
|   `-- revise.md
|-- supabase/
|   |-- config.toml
|   |-- migrations/
|   `-- seed.sql
|-- docs/
|   |-- IMPLEMENTATION-PLAN.md
|   |-- IMPLEMENTATION-STATUS.md
|   |-- DESIGN-SYSTEM.md
|   |-- ARCHITECTURE.md
|   |-- STATE-MACHINE.md
|   |-- PROVIDERS.md
|   |-- LOCAL-WORKER.md
|   |-- HERMES.md
|   |-- VERCEL_DEPLOYMENT.md
|   `-- CLOUDFLARE_DOMAIN.md
|-- tests/
|   |-- integration/
|   `-- e2e/
|-- .env.example
|-- pnpm-workspace.yaml
|-- package.json
|-- README.md
`-- THIRD_PARTY_NOTICES.md
```

The exact route grouping may change during scaffolding, but public and admin layouts must remain isolated.

## 6. Public design lock: Paperframe adaptation

`docs/DESIGN-SYSTEM.md` is the first visual deliverable and a gate for public UI work. It must cite the reviewed Paperframe commit and record any intentional deviation.

### 6.1 Typography

Use Paperframe's three-role type system:

| Role | Family | Use |
|---|---|---|
| Editorial | `Noto Serif SC`, with a suitable serif fallback stack | masthead, page/article headings, pull quotes, featured-story text |
| Interface/body | `Geist Sans`, Arial/Helvetica fallback | navigation, summaries, article body, UI labels |
| Metadata | `Geist Mono`, monospace fallback | dates, issue/category labels, source metadata, small utility copy |

Required scale, derived from Paperframe:

| Element | Mobile | Larger screens | Notes |
|---|---:|---:|---|
| Publication masthead | 60px | 72–96px | serif, 600, line-height about 1.05 |
| Page/article H1 | 48px | 60px | serif, 600, tight tracking |
| Section H2 | 36px | 48px | serif, 600, line-height 1–1.1 |
| Article H2 | 30px | 36px | serif, 600 |
| Article H3 | 24px | 24px | serif, 600 |
| Feature/card title | 20–36px | 24–48px | depends on hierarchy, not card decoration |
| Body/prose | 18px | 18px | 32px line-height |
| Supporting copy | 14–16px | 14–16px | 1.5–1.75 line-height |
| Metadata/eyebrow | 10–11px | 10–11px | uppercase, 0.18–0.24em tracking |

Do not use display-serif type for admin data tables or form controls.

### 6.2 Width, grid, and spacing

- Public shell max width: `64rem` (`max-w-5xl`).
- Article/detail canvas max width: `56rem` (`max-w-4xl`).
- Main prose measure: target `42–48rem`; keep long-form lines readable even inside the wider article canvas.
- Summary measure: no more than `48rem` (`max-w-3xl`).
- Page gutters: 16px mobile, 24px small screens, 32px large screens.
- Fixed header height: 56px.
- Standard section padding: 80px vertical on desktop, reduced to 56–64px on small screens.
- Detail page top/bottom padding: 40px minimum.
- Grid: 12 columns for asymmetric editorial features; one column mobile, two around 640px, and three only where content density supports it around 1024px.
- Default gaps: 16, 24, 32, 40, 48, and 64px. Use 80/96/128px only for major editorial separation.

Whitespace is structural. Do not fill empty regions with decorative cards, metrics, blobs, or gradients.

### 6.3 Colour and borders

Baseline tokens:

```text
paper:          #ffffff
ink:            #1c1917
muted:          #57534e
subtle:         #78716c
line:           #d6d3d1
line-soft:      #e7e5e4
wash:           #f5f5f4
dark-surface:   #0c0a09
dark-line:      #44403c
dark-copy:      #d6d3d1
```

- Use colour sparingly for category identity or status, never as a substitute for hierarchy.
- Public borders are generally 1px stone lines.
- Use border-top/bottom separators more often than boxed cards.
- No gradients, glass panels, glow, or broad drop shadows.
- Version 1 has a light public canvas with intentional dark editorial sections; it does not require a global dark-mode toggle.
- If dark mode is later added, define semantic tokens and test every article element. Do not invert colours ad hoc.

### 6.4 Images

- Standard cards use `16:9`.
- Featured/portrait editorial images use `4:5`.
- A full article hero may use `16:9`, `3:2`, or the source image's editorial crop, selected explicitly in image metadata.
- Images are square-cornered by default; at most 2–4px radius where technically useful.
- Use `object-cover`, a light neutral placeholder, and a 1px ring/border.
- Hover treatment may scale to about `1.03` over roughly 700ms; no floating cards or strong shadows.
- Store focal point/crop metadata when generated images need controlled responsive cropping.
- Hero and inline images require alt text before approval. Captions are optional but, when present, are visually subordinate.

### 6.5 Navigation and footer

- Header is fixed, 56px high, with a 1px bottom border and a mostly opaque white background.
- Desktop navigation appears at the medium breakpoint and uses compact uppercase tracked labels.
- Mobile uses a full-screen dark overlay with large serif links and visible close state.
- The public shell reserves top padding equal to the fixed header height.
- Footer uses a top border, publication name/description on the left, compact links on the right at large sizes, and stacked content on mobile.
- All interactive targets must meet accessible hit-area and keyboard-focus requirements, even when their visible styling is typographically restrained.

### 6.6 Buttons, controls, and motion

- Public CTAs are primarily text links with underline/bottom-border transitions.
- Where a button is necessary, use a rectangular 1px border, 0–4px radius, and direct colour inversion on hover.
- Pills are limited to true compact status/category controls. They are not a default container shape.
- Motion is limited to colour/border changes, subtle list indentation, the mobile menu, and gentle image scale.
- Respect `prefers-reduced-motion`; reduce durations and remove transforms.
- Do not add scroll-jacking, animated counters, blobs, parallax, or decorative entrance animations.

### 6.7 Public page composition

Initial public routes:

- `/`: FinTechPulse publication masthead, one featured story, recent UK financial/fintech article stream, optional real topic sections, and footer;
- `/blog`: archive header plus editorial stream/grid with pagination;
- `/blog/[slug]`: category, headline, excerpt, publish/update metadata, hero image, safe article body, sources, and related articles;
- generated sitemap, robots, RSS, canonical, Open Graph, Twitter, and Article JSON-LD surfaces.

Do not reproduce Paperframe's generic project/service/statistics sections unless real FinTechPulse content requires them. The visual grammar is retained; irrelevant template content is removed.

### 6.8 Admin visual system

The admin is a functional application, not a Paperframe page with forms added:

- sans-first typography;
- compact, dense tables and timelines;
- neutral surfaces with 1px borders and small radii;
- clear persistent navigation;
- accessible semantic status colours;
- controls optimized for scanning and task completion;
- no publication masthead, oversized serif hero, or public article card treatment.

Shared primitives may include colour tokens and focus styles, but public layout components must never wrap admin routes.

## 7. Data model and migrations

Create migrations in small, ordered files: extensions/enums, identity/config, content/artifacts, queue/state functions, RLS, Storage policies, indexes, and seed data.

### 7.1 Required and supporting tables

| Table | Purpose and important fields |
|---|---|
| `sites` | Publication identity, `fintechpulse.co.uk` domain, `en-GB` locale, `Europe/London` timezone, GBP currency; one seeded row in v1 |
| `admin_users` | Supabase Auth user ID, role, active flag; no client-side self-promotion |
| `article_jobs` | `id`, `site_id`, topic/keywords/requirements, strict status enum, provider selections, attempts, revision count, scheduling, lease fields, action-required fields, optimistic `lock_version`, timestamps |
| `articles` | Canonical slug/title/excerpt/SEO data, selected approved draft, publication status/timestamps, canonical URL, author/byline, current hero image |
| `research_packets` | Versioned normalized research JSON, summary, provider run, prompt version, validation status |
| `sources` | URL, title, publisher, dates, source type/quality, access timestamp, excerpt/hash as needed; tied to packet/job |
| `claims` | Normalized claim text, confidence/verification state, notes, dates/entities, packet/version |
| `claim_sources` | Many-to-many evidence relationship with support/contradict classification and locator |
| `drafts` | Immutable versions: title, slug, excerpt, Markdown body, SEO fields, internal links, source references, parent draft, provider run |
| `audits` | Immutable audit versions, verdict, structured findings, compared draft, provider run, cycle number |
| `images` | Immutable image/version metadata: role, purpose, prompt, alt, caption, ratio, status, private/public storage paths, provider run |
| `provider_runs` | Provider, mode, stage, input/output artifact references, prompt snapshot, start/end, result, error class/summary, retry, usage/cost if known, idempotency key |
| `job_events` | Append-only event timeline with from/to status, actor type/id, event type, safe metadata, timestamp |
| `prompt_templates` | Prompt key, immutable version, content, variables schema, active flag, editor, timestamps |
| `provider_settings` | Per-site/per-stage selected provider mode and non-secret settings; secrets never stored here in v1 |
| `site_settings` | Typed site configuration, publication metadata, editorial settings, and editable style guide reference |
| `publishing_logs` | Each publish/revalidate/verify attempt, request/result summary, timing, status code, error |
| `worker_instances` | Worker ID, host label, version, started/last-seen timestamps, current job/stage, health metadata |
| `originality_checks` | Optional checker runs and suspicious phrase matches; no unsupported “plagiarism-free” claim |

### 7.2 Core constraints

- UUID primary keys using `gen_random_uuid()`.
- All timestamps are `timestamptz`; scheduling is stored in UTC and displayed in the site's timezone.
- Unique article slug per site.
- Unique artifact version per job/type, for example `(job_id, version)` on drafts and audits.
- A draft/audit/image row is immutable after completion except for tightly scoped review metadata.
- `revision_count <= 2` for automatic cycles.
- Provider and provider-mode values use constrained enums/checks.
- Published articles require a selected approved draft, title, slug, nonempty Markdown body, canonical URL inputs, and required image alt text.
- Important JSONB payloads also pass application Zod schemas. Database checks cover shapes that can be enforced economically.
- `job_events` is append-only for authenticated users; corrections are new events.
- Cascades are conservative. Deleting a user must not delete audit history or published content.

### 7.3 Indexes

At minimum:

- queue claim index on `(status, desired_publish_at, created_at)` filtered to claimable statuses;
- lease recovery index on `lease_expires_at` where a lease exists;
- public article index on `(site_id, published_at desc)` filtered to published/verified rows;
- unique `(site_id, slug)`;
- artifact indexes on `(job_id, version desc)`;
- provider run index on `(job_id, stage, started_at desc)`;
- event timeline index on `(job_id, created_at, id)`;
- audit verdict and action-required indexes for dashboard queues;
- worker heartbeat index on `last_seen_at`.

Use query plans to confirm indexes after realistic seed volume; do not add speculative indexes to every foreign key without checking access patterns.

### 7.4 Row Level Security (RLS) and authorization

- Public/anonymous users may select only publication-safe columns for articles whose publication time has arrived and whose state is `PUBLISHED` or `VERIFIED`.
- Public users cannot read drafts, research, sources marked private, audits, prompts, jobs, logs, provider settings, or private Storage objects.
- Authenticated users gain admin access only when an active `admin_users` record matches `auth.uid()`.
- Admin mutations use server actions/RPCs with server-side authorization checks and Zod validation.
- The local worker uses the service role on the trusted PC.
- Browser uploads use short-lived signed upload flows or authenticated Storage policies; the service key is never sent to the browser.
- Create private `article-work` and public-read `article-public` buckets. Working assets stay private; publish copies approved assets to stable public paths.

## 8. State machine

The transition function is centralized in Postgres and mirrored by a pure TypeScript transition map for fast validation/tests. Callers submit expected current status and `lock_version`; the database transaction rejects stale or invalid transitions and appends the event.

### 8.1 Normal path

| From | Allowed normal next state(s) | Gate |
|---|---|---|
| `IDEA` | `RESEARCH_PENDING` | required job fields valid |
| `RESEARCH_PENDING` | `RESEARCHING` | worker successfully claims stage |
| `RESEARCHING` | `RESEARCH_COMPLETE` | valid versioned research packet saved |
| `RESEARCH_COMPLETE` | `DRAFT_PENDING` | research/claims ready |
| `DRAFT_PENDING` | `DRAFTING` | worker claims stage |
| `DRAFTING` | `DRAFT_COMPLETE` | valid immutable draft saved |
| `DRAFT_COMPLETE` | `IMAGES_PENDING`, `AUDIT_PENDING` | skip images only when requested count is zero, with event |
| `IMAGES_PENDING` | `IMAGES_PROCESSING` | worker claims stage |
| `IMAGES_PROCESSING` | `AUDIT_PENDING` | required image assets/briefs complete |
| `AUDIT_PENDING` | `AUDITING` | worker claims stage |
| `AUDITING` | `APPROVED`, `REVISION_REQUIRED`, `NEEDS_HUMAN` | structured audit verdict |
| `REVISION_REQUIRED` | `REVISING` | cycle count below 2 and worker claims |
| `REVISING` | `RE_AUDIT_PENDING` | new draft version saved |
| `RE_AUDIT_PENDING` | `AUDITING` | re-audit claim; cycle recorded in run |
| `APPROVED` | `SCHEDULED`, `PUBLISHING` | manual/automatic publish policy and time |
| `SCHEDULED` | `PUBLISHING` | publish time reached and publishing service claims |
| `PUBLISHING` | `PUBLISHED` | atomic publication succeeds |
| `PUBLISHED` | `VERIFIED` | live verification passes |
| `VERIFIED` | none | terminal success |

`PUBLISHED` does not advance on a failed verification. It remains published, records the failed verification attempt, schedules bounded retries, and surfaces an action-required alert after exhaustion. This preserves the rule that `PUBLISHED -> VERIFIED` occurs only on verification success.

### 8.2 Exceptional states

- `PAUSED`: allowed from any nonterminal, pre-publication status. Store `paused_from_status`. Resume to the same pending/waiting status, or normalize an interrupted active status to its preceding pending state after releasing the lease.
- `FAILED`: entered only after the retry policy is exhausted or a permanent technical error occurs. Store `failed_stage` and a sanitized summary. Admin retry returns to that stage's pending status and creates a new event/run.
- `NEEDS_HUMAN`: used for expired CLI authentication, invalid provider output after repair attempts, conflicting facts, exhausted revisions, or policy/editorial judgment. Resolution requires an admin note and an explicit destination allowed for the recorded stage.
- Manual provider mode: remains in the active stage (`RESEARCHING`, `DRAFTING`, `IMAGES_PROCESSING`, or `AUDITING`) with `action_required_kind`, generated prompt/run ID, and no held lease. Importing a validated response clears the action and continues atomically.

### 8.3 Publication boundary

Implement a dedicated database RPC and publishing module that:

1. locks the job/article;
2. confirms `PUBLISHING`, approved draft, schedule, required images, and latest audit;
3. snapshots the approved content into the canonical article row;
4. copies or confirms public image objects;
5. sets publication timestamps;
6. records a publishing log and event;
7. transitions to `PUBLISHED` in the same transaction where possible;
8. requests signed Vercel cache revalidation outside the database transaction;
9. enqueues/marks post-publish verification.

Provider modules receive no publication method or database capability that can execute this boundary.

## 9. Queue, leases, retries, and idempotency

### Queue claiming

Create an atomic `claim_next_job(worker_id, lease_seconds)` RPC using `FOR UPDATE SKIP LOCKED`. It selects one eligible job, verifies time/attempt constraints, changes the stage to its active state, writes a random lease token and expiry, increments `lock_version`, and appends the claim event.

Only the matching worker ID plus lease token may renew or complete a claimed stage. A sweeper/recovery RPC converts expired active work back to the appropriate pending state and records the abandoned attempt.

### Retry policy

- Classify errors as transient, rate/usage limit, auth, invalid output, permanent configuration, or unknown.
- Use exponential backoff with jitter and a stage-specific cap.
- Never retry auth expiry in a tight loop; transition to `NEEDS_HUMAN`.
- Subscription usage-limit errors pause/request human action and never trigger an API fallback.
- Provider output gets one bounded local repair/parse attempt where safe; subsequent schema failure requires human action or a stage retry.
- Automatic revision cycles are limited to two, independent of network retry counts.

### Idempotency

- Each provider call has a deterministic idempotency key based on job, stage, source artifact version, cycle, and logical attempt.
- Completion transactions first check whether the expected artifact/version already exists.
- Publishing is safe to call again and cannot create duplicate article versions or storage copies.
- Manual imports reject duplicate completion but show the already-accepted artifact.
- Job transition commands use expected status and `lock_version` to prevent stale UI/worker writes.

### Worker heartbeat

The daemon upserts `worker_instances` on startup and periodically updates `last_seen_at`, version, current job, and stage. The dashboard computes:

- online: heartbeat within the configured threshold;
- stale: near threshold, shown as warning;
- offline: beyond threshold.

This is observation through Supabase, not a connection from Vercel to the PC.

## 10. Provider architecture

### 10.1 Shared adapter contract

Each stage adapter implements a typed contract similar to:

```ts
type ProviderMode = "mock" | "subscription_cli" | "manual" | "api";

interface StageAdapter<TInput, TOutput> {
  prepare(input: TInput, context: RunContext): Promise<PreparedRun>;
  execute(prepared: PreparedRun, signal: AbortSignal): Promise<RawRunResult>;
  normalize(raw: RawRunResult): Promise<TOutput>;
}
```

`PreparedRun` always contains the final prompt, prompt-template version, safe serialized input references, provider/mode, and schema version. Manual mode stores it and returns an action-required result. All normalized results pass stage-specific Zod schemas before database persistence.

### 10.2 Supported stage modes

| Stage | Modes | Version 1 default |
|---|---|---|
| OpenAI research | `mock`, `manual_chatgpt`, `codex_cli`, `openai_api` | `manual_chatgpt` |
| Claude writing/revision | `mock`, `claude_code`, `manual_claude`, `anthropic_api` | `claude_code` |
| Gemini images | `mock`, `manual_gemini`, `gemini_api` | `manual_gemini` |
| OpenAI audit | `mock`, `manual_chatgpt`, `codex_cli`, `openai_api` | configurable; start `manual_chatgpt` until CLI quality is accepted |
| Publishing/verification | internal deterministic services | internal |

Provider selection is per stage, visible on job creation and article detail, and snapshotted into each run so later setting changes do not rewrite history.

### 10.3 Codex CLI adapter

- Re-check `codex --version`, `codex exec --help`, and login status at implementation time.
- Use `codex exec` non-interactively with a prompt file/stdin and machine-readable output supported by the installed version.
- Run in a temporary, read-only working directory with no project secrets in prompt or command arguments.
- Set timeouts, capture exit code/stdout/stderr separately, redact paths/tokens, and enforce output-size limits.
- Treat missing binary/auth expiry as `NEEDS_HUMAN` with an actionable message.
- Do not provide `OPENAI_API_KEY` to the process in `codex_cli` mode.

### 10.4 Claude Code adapter

- Re-check `claude --version` and `claude --help` before implementation.
- Use `claude -p --output-format json` and, where reliable, `--json-schema` for the stage output.
- Disable unnecessary tools for pure writing work and use an isolated temporary working directory.
- Do not set `ANTHROPIC_API_KEY` in `claude_code` mode.
- Handle missing CLI, expired subscription authentication, usage limits, timeouts, and invalid JSON as distinct outcomes.

### 10.5 Manual workflows

The admin run panel must show:

- provider and mode;
- exact generated prompt with Copy Prompt;
- external-site action where appropriate (for example Open Gemini);
- response paste/import or image upload;
- expected schema/example;
- validation errors without discarding the user's input;
- Continue action only after validation succeeds.

Manual Gemini supports one hero and one or two supporting images by default. Each upload captures purpose, prompt, alt text, optional caption, aspect ratio, and Storage object metadata.

### 10.6 Mock providers

Build mocks first. They must create deterministic but realistic:

- research packets with sources, claims, uncertainty, and structure;
- article drafts with metadata and image briefs;
- image placeholders stored through the same artifact interface;
- PASS and REVISION_REQUIRED audit fixtures;
- one controlled retry/failure scenario.

Mocks use the real queue, state machine, versioning, and publishing paths. They are not a separate demo shortcut.

## 11. Prompt and artifact contracts

### Research output

Schema includes topic interpretation, angle, facts, claims, statistics, dates, entities, primary/secondary sources, contradictions, uncertainties, questions, and recommended structure. Claims reference source IDs where possible. The research stage does not write the article.

### Draft output

Schema includes title, slug, excerpt, body Markdown, meta title, meta description, suggested internal links, image briefs, and source references. The writer receives normalized research and verified facts, not unnecessary full competitor prose.

### Audit output

Schema includes verdict and findings. Each finding contains severity, category, article location, problem, reason, and recommended correction. Categories cover facts, support, contradiction, source quality, wording overlap, AI-like style, repetition, grammar, clarity, SEO, structure, usefulness, and internal consistency. The auditor reports; it does not rewrite the article.

### Revision output

The revision prompt includes the original draft, research packet, and specific audit findings. It instructs Claude to change only identified issues and forbids unsupported new claims. The result is always a new draft version.

### Editorial style guide

Create `prompts/editorial-style.md` from the supplied requirements. Seed it into a versioned prompt/style setting. Admin edits create a new version rather than mutating historical prompt snapshots.

## 12. Admin application plan

### Authentication

- Supabase email authentication for v1.
- Middleware/server layout redirects unauthenticated requests, but every server action and route handler independently authorizes.
- Admin membership comes from `admin_users`, not from a browser claim the user can edit.
- Preserve intended destination through login safely.

### Routes and capabilities

| Route | Capability |
|---|---|
| `/admin/login` | sign in and authentication error handling |
| `/admin` | queue summary, stages, upcoming posts, failures, manual actions, recent publications, worker health |
| `/admin/articles/new` | topic, keywords, type, target length, image count, desired publish time, auto-publish, stage provider modes |
| `/admin/articles/[jobId]` | complete lifecycle timeline and all versioned artifacts |
| `/admin/articles/[jobId]/edit` | controlled metadata/content correction with new draft/version semantics |
| `/admin/prompts` | prompt/style guide versions, preview, activate, rollback by activating an older/new copied version |
| `/admin/providers` | per-stage mode configuration, capability/CLI status, explicit cost warnings |
| `/admin/logs` | filterable provider/publish/job logs with redacted errors |
| `/admin/settings` | publication identity, SEO, timezone, worker thresholds |

Article detail shows research, claims/evidence, sources, every draft diff/version, image prompts/assets, every audit and revision, provider runs, events, errors, schedule, publication logs, and verification. Controls include retry, pause, resume, mark needs human, resolve action, approve, schedule, and publish according to permissions and state.

Use server pagination/filtering for tables and timelines. Do not load entire histories into the client.

## 13. Public application plan

### Data access

- Use server-only Supabase repository functions returning narrow, Zod-validated public DTOs.
- Fetch only `PUBLISHED`/`VERIFIED` articles whose publish time has arrived.
- Use Next caching/revalidation deliberately. Start with short ISR/revalidation for lists and slug-tagged invalidation after publishing.
- The worker calls a signed Vercel `/api/revalidate` endpoint outbound after publication; this does not expose the local PC.
- A missing/unpublished slug returns `notFound()` and never leaks draft metadata.

### Safe article rendering

- Store canonical draft/published body as Markdown.
- Render with a component map matching `docs/DESIGN-SYSTEM.md`.
- Raw HTML and executable MDX components are disabled.
- Sanitize/validate links and image sources, add safe external-link attributes, and enforce allowed Storage/public URL origins.
- Render source references and captions as structured data rather than embedded HTML.

### SEO and feeds

- Per-article title, description, canonical, Open Graph, Twitter card, and Article JSON-LD.
- Publication-wide metadata and share-image fallback.
- Dynamic `sitemap.xml` with published articles only.
- `robots.txt` that disallows admin and internal APIs.
- RSS/Atom feed if it can be implemented without compromising delivery; it is expected for v1 unless a concrete blocker is documented.
- Slugs are stable after publication; if an admin changes one later, record aliases/redirects.
- All canonical, feed, sitemap, JSON-LD, and social metadata URLs use `https://fintechpulse.co.uk`; requests for alternate hosts redirect to the canonical apex origin.

## 14. Publishing and live verification

Post-publish verification performs bounded HTTP checks against the canonical public URL:

1. status is successful after redirects;
2. canonical URL matches;
3. expected title is present;
4. main article body exists and exceeds a minimum meaningful length;
5. expected hero image resolves successfully;
6. meta description and Open Graph metadata exist;
7. Article JSON-LD parses and contains the expected headline/date;
8. no known placeholder markers are present.

Record each check independently in `publishing_logs`. Retry transient deployment/cache failures with backoff. Advance to `VERIFIED` only when all required checks pass.

## 15. Environment variable plan

`.env.example` must contain comments and no real secrets.

### Web/Vercel

```text
NEXT_PUBLIC_SITE_URL=https://fintechpulse.co.uk
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_URL=
REVALIDATION_SECRET=
```

The web app should not need the Supabase service-role credential. If a server-only operation appears to require it, prefer an authorized database RPC/RLS design and document any exception.

### Local worker

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PUBLIC_SITE_URL=https://fintechpulse.co.uk
REVALIDATION_SECRET=
WORKER_ID=
WORKER_POLL_INTERVAL_MS=10000
WORKER_HEARTBEAT_INTERVAL_MS=30000
WORKER_OFFLINE_AFTER_SECONDS=120
WORKER_LEASE_SECONDS=900
WORKER_MAX_ATTEMPTS=5
PUBLISH_VERIFY_TIMEOUT_MS=15000
CODEX_BIN=codex
CLAUDE_BIN=claude
```

### Optional API mode only

```text
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
```

The app and worker must boot without the optional API variables when all selected stages use mock, manual, or subscription CLI modes. Startup validates only credentials required by currently selected modes.

## 16. Implementation phases

Each phase ends with passing tests and a reviewable commit. Do not postpone lint/type/build repair to the final phase.

### Phase 0 — Repository and architecture baseline

- Initialize Git if needed, set `main`, connect `origin` to `git@github.com:nobledev89/FTP.git`, and create a pnpm workspace.
- Create and begin maintaining `docs/IMPLEMENTATION-STATUS.md` using the status-tracking rules in section 17.
- Scaffold the current stable Vercel-supported Next.js App Router with TypeScript, Tailwind, ESLint, and `src/`.
- Record exact Node/pnpm/package versions and add `.gitignore`, `.editorconfig`, format conventions, and scripts.
- Add `ARCHITECTURE.md`, this plan, `THIRD_PARTY_NOTICES.md`, and decision records for Markdown-vs-MDX, queue leases, provider isolation, and public/admin layout separation.
- Add CI for install, lint, typecheck, unit tests, and build.

Exit: clean scaffold passes `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

### Phase 1 — Paperframe design lock

- Create `docs/DESIGN-SYSTEM.md` with the concrete rules in section 6.
- Port/adapt only the necessary public shell primitives: typography loading, header, mobile menu, footer, section heading, article image, stream list, and rich-copy component map.
- Create public fixture pages for desktop/mobile visual review; do not connect MDX content.
- Establish a separate admin token sheet/layout.
- Add Paperframe MIT attribution if code is reused.

Exit: design-system review confirms typography, widths, borders, image ratios, navigation, mobile behavior, footer, reduced motion, and public/admin separation.

### Phase 2 — Supabase schema and security

- Initialize Supabase local configuration and ordered migrations.
- Create enums, all required/supporting tables, constraints, indexes, triggers, transition/publish/claim RPCs, and seed data.
- Configure Auth assumptions and `admin_users` bootstrap instructions.
- Add RLS and Storage bucket policies.
- Generate TypeScript database types.
- Add migration and RLS integration tests against local Supabase.

Exit: a fresh Supabase reset applies all migrations; anonymous/admin/worker access tests prove intended boundaries.

### Phase 3 — Domain services and state machine

- Implement Zod schemas and repository/service boundaries.
- Implement the pure transition map plus database-backed transition client.
- Implement event append, artifact version helpers, optimistic concurrency, pause/resume/retry/human-resolution rules.
- Add table-driven tests for every allowed and rejected transition.

Exit: transition tests, version immutability tests, and publication-boundary tests pass.

### Phase 4 — Authentication and admin shell

- Build Supabase SSR auth clients, login/logout, protected layout, admin authorization, and session refresh.
- Build admin navigation, responsive shell, accessible components, loading/error/empty states.
- Add Dashboard, New Article, Article Detail, Prompts, Providers, Logs, and Settings routes with real database reads.
- Implement validated server actions for create/pause/resume/retry/approve/schedule/settings.

Exit: an authenticated admin can create and inspect an `IDEA`; unauthenticated and non-admin users cannot access data or actions.

### Phase 5 — Local worker and queue safety

- Create the Windows-compatible TypeScript worker package and CLI.
- Implement `worker:once`, `worker:start`, and `worker:status`.
- Implement atomic claim, lease renewal, expiry recovery, heartbeat, retry/backoff, graceful shutdown, and structured redacted logging.
- Document Hermes shell invocation and Task Scheduler/manual debugging options.
- Test two concurrent workers, crash recovery, lease expiry, and duplicate completion.

Exit: two workers cannot process the same stage; a killed worker's job becomes safely claimable after lease expiry.

### Phase 6 — Mock pipeline end to end

- Implement deterministic mock research, draft, image, audit, revision, publish, and verification adapters.
- Seed editable prompt templates and `editorial-style.md`.
- Exercise PASS, revision, failure, pause, human-action, and scheduled publication branches.
- Connect admin artifact/timeline views.

Exit: a mock job reaches `VERIFIED`, all intermediate versions/events are inspectable, and no shortcut bypasses production services.

### Phase 7 — Public publication

- Build `/`, `/blog`, and `/blog/[slug]` from Supabase using the Paperframe design system.
- Build safe Markdown component rendering and structured source list.
- Add pagination, empty/not-found states, responsive images, metadata, JSON-LD, sitemap, robots, RSS, and share images.
- Add cache tags/revalidation route and verify no draft leakage.
- Perform desktop and mobile visual comparison against the frozen Paperframe reference.

Exit: public pages are editorial, responsive, accessible, SEO-complete, and visually distinct from admin.

### Phase 8 — Manual provider workflows

- Implement manual ChatGPT research/audit prompt generation and response import.
- Implement manual Claude draft/revision import.
- Implement manual Gemini prompt/copy/open/upload/continue flow.
- Add schema examples, validation feedback, audit trail, and private-to-public image lifecycle.

Exit: the full pipeline works without any CLI or AI API key, using manual subscription interactions.

### Phase 9 — Subscription CLI providers

- Re-inspect installed Codex and Claude help/auth status.
- Implement Claude Code first, using non-interactive JSON/JSON Schema output.
- Implement Codex only through its currently supported non-interactive mechanism.
- Add capability probes, safe process isolation, timeouts/cancellation, output limits, error classification, and redaction.
- Ensure usage limits/auth expiry never fall back to API.

Exit: each CLI can be selected per stage, successful output is normalized identically to manual/mock output, and expired authentication produces an actionable human state.

### Phase 10 — Optional API adapters

- Implement adapters behind explicit configuration and credential checks.
- Keep schemas and stage services identical to other modes.
- Add budget/usage logging where provider responses expose it.
- Add UI cost warning and confirmation before enabling API mode.

Exit: adding credentials and switching one stage is sufficient; no other pipeline redesign or fallback behavior is introduced.

### Phase 11 — Publishing, scheduling, and verification hardening

- Finalize atomic publishing service, scheduled-job claiming, public Storage copies, signed revalidation, and verification retries.
- Test simultaneous publish attempts, slug conflicts, schedule timezone edges, Storage failures, stale cache, and partially available public pages.
- Prove provider modules cannot directly mark content published.

Exit: scheduled and immediate articles publish exactly once and reach `VERIFIED` only after live checks pass.

### Phase 12 — Operations, documentation, and release QA

- Complete README and all setup/deployment documents.
- Validate `.env.example` from clean web and worker environments.
- Add Windows instructions for pnpm, Supabase, Codex login, Claude login, Hermes, and daemon operation.
- Run security, accessibility, responsive, failure-recovery, and browser QA.
- Deploy a preview, then production; configure the domain using Vercel-provided DNS values in Cloudflare.

Exit: a new operator can set up Supabase, run the mock/manual pipeline, deploy Vercel, configure Cloudflare, and operate the Windows worker from documentation alone.

## 17. Implementation status tracking

`docs/IMPLEMENTATION-STATUS.md` is required from the first implementation task onward. It is both a current-state dashboard and an append-only work log; it must not be reconstructed only at the end of a phase.

### Update rule

Update the file immediately after any of these events:

- a planned task or meaningful subtask is completed;
- a file, migration, route, provider, or feature becomes operational;
- a verification command or phase exit criterion passes;
- a task changes from not started to in progress, blocked, or deferred;
- a decision changes scope, sequencing, or acceptance criteria;
- a discovered issue is fixed or becomes a blocker.

Do not mark work complete merely because files exist. A completion entry must include its verification evidence, such as commands run, test results, manual QA performed, or the reason verification is not applicable.

### Required current-state fields

Keep these fields at the top of the status file:

- overall implementation status;
- current phase and task;
- last-updated timestamp with timezone;
- current branch and latest relevant commit when available;
- active blockers;
- next concrete action.

Maintain a phase table for Phases 0–12 using only `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `DEFERRED`, or `COMPLETE`. Each phase row includes progress, completion date, and a short evidence summary. Keep a checklist beneath the active phase and check items individually as they finish.

### Append-only completion log

For every completed item, append a dated entry containing:

```text
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

Never delete earlier completion entries. If an earlier item is later found incomplete or regresses, append a correction, change the current phase/task status, and link the new evidence. Do not rewrite history to make the project appear further along.

### End-of-session rule

Before ending any implementation session:

1. reconcile the active-phase checklist with the actual repository;
2. record every command/test result completed during the session;
3. list blockers and incomplete verification plainly;
4. identify exactly one next concrete action;
5. commit the status update with the related implementation work, or explain why no commit exists.

The README may summarize maturity, but `docs/IMPLEMENTATION-STATUS.md` is the authoritative implementation progress record.

## 18. Test strategy

### Unit

- transition matrix and exceptional transitions;
- provider output Zod schemas;
- prompt interpolation and prompt-version snapshots;
- retry classification/backoff;
- slug and metadata generation;
- Markdown/link sanitization helpers;
- publication/verification predicates.

### Database/integration

- migrations from empty database;
- RLS matrix for anonymous, authenticated non-admin, admin, and worker;
- concurrent `claim_next_job` calls;
- lease renewal and expiry recovery;
- optimistic locking and duplicate idempotency keys;
- immutable version history;
- publishing transaction and slug conflict;
- Storage policies/private versus public assets.

### Worker

- mock pipeline to VERIFIED;
- process timeout/cancellation;
- malformed CLI/manual output;
- auth/usage-limit handling;
- crash after provider completion but before transition;
- daemon graceful shutdown;
- heartbeat online/offline thresholds.

### Web/e2e

- login and admin authorization;
- create, pause, resume, retry, manual import, upload, approve, schedule;
- lifecycle timeline and version switching;
- public list/detail/404 and unpublished slug protection;
- canonical/OG/Twitter/JSON-LD/sitemap/robots/RSS;
- malicious Markdown/XSS fixture;
- responsive header/mobile menu and keyboard navigation.

### Visual QA

At minimum compare 375px, 768px, 1024px, and 1440px widths. Check typography loading, line length, fixed header offset, archive density, image crops, long titles, missing images, source lists, footer, reduced motion, and public/admin differentiation. Store approved screenshots or visual-regression baselines after the first design sign-off.

## 19. Security and observability checklist

- No service role or AI key in client bundles, logs, prompts, or database settings.
- Zod validation at every server mutation/provider boundary.
- RLS enabled and tested, not merely declared.
- Safe Markdown only; raw HTML off.
- Rate-limit login-adjacent and public mutation/revalidation endpoints.
- Revalidation endpoint uses constant-time secret comparison or signed request, narrow tag inputs, replay/rate protection, and no arbitrary path fetching.
- External URLs fetched by verification are derived from configured site origin plus validated slug to avoid SSRF.
- CLI child processes receive a minimal environment and bounded input/output/time.
- Error logs redact tokens, auth headers, full prompts where sensitive, and local personal paths.
- Provider runs log provider, mode, stage, job, start/end, outcome, safe error summary, and retry.
- Operational views surface queue age, failed/retrying jobs, manual actions, expired leases, worker heartbeat, publish failures, and verification backlog.

## 20. Deployment and operations

### Supabase

1. Create project and link local CLI.
2. Apply migrations and Storage policies.
3. Create the first Auth user and insert/seed the matching `admin_users` membership through a controlled bootstrap step.
4. Configure auth redirect URLs for local, Vercel preview as appropriate, and production.
5. Put the service-role secret only in the local worker environment.

### Vercel

1. Import [nobledev89/FTP](https://github.com/nobledev89/FTP) from GitHub with the repository root as the Next.js project root and `main` as the production branch.
2. Use pnpm and the pinned Node version.
3. Configure only web-safe/public and server-only Vercel variables listed in the deployment document.
4. Run preview smoke/e2e checks, then promote to production.
5. Confirm the local worker directory is not treated as a separate deployable app.

### Cloudflare

1. Add `fintechpulse.co.uk` and `www.fintechpulse.co.uk` in Vercel first; configure the apex as canonical and `www` as its redirect.
2. Copy the exact DNS records Vercel provides into Cloudflare; do not hard-code assumed addresses.
3. Use DNS-only mode while validating domain ownership, TLS, the `www` redirect, the `https://fintechpulse.co.uk` canonical origin, and Vercel routing.
4. Document optional Cloudflare proxy/CDN settings separately and enable only after origin behavior is stable.

### Hermes/Windows worker

Hermes periodically runs `pnpm worker:once` and monitors exit status, or launches `pnpm worker:start` and monitors the daemon. The documented contract is shell commands and exit codes, not a Hermes-specific SDK. `pnpm worker:status` reads local configuration plus Supabase heartbeat/queue health without modifying jobs.

## 21. Required scripts

Root `package.json` exposes:

```text
pnpm dev
pnpm build
pnpm start
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm worker:once
pnpm worker:start
pnpm worker:status
pnpm supabase:start
pnpm supabase:reset
pnpm db:types
```

Windows-compatible implementations must not depend on Bash-only wrapper scripts.

## 22. Delivery milestones

### Milestone A — Safe foundation

Design lock, schema, RLS, state machine, auth, admin shell, worker lease system.

### Milestone B — Zero-cost demonstrable product

Mock pipeline, public Paperframe-based site, publishing, verification, complete admin history.

### Milestone C — Subscription/manual operations

Manual ChatGPT/Gemini/Claude flows plus Claude Code and supported Codex CLI integrations.

### Milestone D — Production release

Optional APIs, hardening, docs, Vercel deployment, Cloudflare domain, Windows/Hermes operations.

## 23. Definition of done

The project is not done when it merely scaffolds or renders placeholders. It is done when all of the following are true:

- fresh install and documented setup work from an empty environment;
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass;
- migrations reset cleanly and RLS tests pass;
- two workers cannot claim the same stage;
- expired leases recover without duplicate artifacts;
- every required status and valid transition is implemented and invalid transitions are rejected;
- mock mode completes the full lifecycle through `VERIFIED`;
- manual mode completes the lifecycle without AI API keys;
- Claude/Codex subscription modes fail gracefully on missing/expired auth;
- all drafts/audits/runs/events remain inspectable;
- only the publishing service can establish published state;
- public routes show only eligible published content and render provider output safely;
- public visual QA follows `DESIGN-SYSTEM.md` and Paperframe's editorial language;
- admin remains visually and structurally distinct;
- metadata, sitemap, robots, RSS, canonical, social cards, and Article JSON-LD are valid;
- live verification blocks `VERIFIED` until all required checks pass;
- README, Supabase, Vercel, Cloudflare, provider-auth, Hermes, and worker documentation match the actual commands;
- `docs/IMPLEMENTATION-STATUS.md` accurately reflects completed work, verification evidence, blockers, and the next action;
- no real secret is committed or exposed to the browser.

## 24. Known risks and planned mitigations

| Risk | Mitigation |
|---|---|
| Subscription CLI flags/auth behavior changes | Capability probe and version/help re-check at startup; clear unsupported/auth states |
| Manual mode holds queue leases indefinitely | Persist action-required state and release the lease before waiting |
| Provider returns valid JSON with bad facts | Research/source model, audit gate, explicit human state, immutable evidence trail |
| Service-role secret on personal PC | `.env.local` outside Git, minimal host access, log redaction, key rotation instructions |
| Duplicate worker execution | Atomic `SKIP LOCKED` claim, lease token, optimistic version, idempotency keys |
| Cached site hides a newly published article | Signed tag revalidation plus bounded live verification retries |
| Database Markdown enables XSS | Raw HTML disabled; component allowlist and malicious fixture tests |
| Paperframe drifts upstream | Freeze the referenced commit; adopt later changes deliberately, never automatically |
| Public site becomes generic SaaS UI | Design lock, visual regression, explicit prohibited-pattern review |
| Revision loop becomes infinite/costly | Hard maximum of two content revision cycles; no silent billable fallback |
| Cloudflare masks Vercel setup issues | DNS-only validation first; proxy configuration is a later optional step |

## 25. First implementation slice

The first coding slice should complete Phases 0–2 only: scaffold and verify the pnpm/Next baseline, write `docs/DESIGN-SYSTEM.md` from the frozen Paperframe snapshot, then build/reset/test the Supabase schema and RLS. Do not begin dashboard styling or AI adapters before those contracts are accepted; they are the foundation every later surface depends on.
