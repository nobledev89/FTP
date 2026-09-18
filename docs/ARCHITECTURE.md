# Architecture

This document describes how FinTechPulse is put together. The binding requirements live in
[IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md); the reasoning behind the load-bearing choices is in
[decisions/](decisions/).

## System overview

```text
Public/admin browser
        |
        v
Cloudflare DNS  ->  Vercel: one Next.js App Router project
                      |-- (public) route group: publication
                      |-- (admin) route group: authenticated admin
                      |-- server actions / route handlers
                      `-- signed cache revalidation endpoint
                                |
                                v
                    Supabase: Postgres + RLS, Auth, Storage
                                ^
                                | outbound HTTPS only
                                |
                    Windows PC: Hermes -> local-worker
                      |-- queue claim + lease renewal
                      |-- mock / manual / CLI / API provider adapters
                      |-- publishing service
                      `-- public URL verifier
```

Nothing connects _to_ the Windows PC. The worker polls Supabase, writes results back, and calls the
public site's signed revalidation endpoint. The dashboard learns about worker health from the
`worker_instances` heartbeat table, not from a live connection.

## Workspace layout

| Path            | Package                      | Deployed     | Purpose                                                               |
| --------------- | ---------------------------- | ------------ | --------------------------------------------------------------------- |
| `/`             | `fintechpulse`               | Vercel       | Next.js app: public publication, admin, route handlers                |
| `/local-worker` | `@fintechpulse/local-worker` | never        | Queue worker, provider adapters, publishing and verification services |
| `/supabase`     | —                            | Supabase CLI | Ordered migrations, seed data, local stack config                     |
| `/prompts`      | —                            | seeded to DB | Versioned editorial style guide and stage prompts                     |
| `/docs`         | —                            | —            | Plan, architecture, design system, decisions, operations              |

Both packages share one pnpm lockfile. Scripts run under the Node version pinned in
`pnpm-workspace.yaml` (`useNodeVersion`), see [ADR 0005](decisions/0005-project-local-node-runtime.md).

## Trust boundaries

| Actor                   | Credential                          | Can do                                                                   |
| ----------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| Anonymous browser       | Supabase publishable key            | Read publication-safe columns of articles whose publish time has arrived |
| Authenticated non-admin | User session                        | Nothing beyond anonymous access                                          |
| Admin                   | User session + active `admin_users` | Read all editorial data; mutate through authorized RPCs/server actions   |
| Local worker            | Service role (PC only)              | Claim jobs, write artifacts, publish through the publishing RPC          |
| Provider adapters       | None of their own                   | Return typed results to the stage service; cannot publish                |

The service-role secret and optional AI API keys exist only in the worker's local environment. They
never appear in `NEXT_PUBLIC_*` variables, browser bundles, prompts, logs, or database settings.

## Data flow for one article

1. An admin creates an `article_jobs` row in `IDEA` with per-stage provider selections.
2. The job advances to `RESEARCH_PENDING`. A worker claims it through `claim_next_job`, which moves it
   to `RESEARCHING` and grants a lease token.
3. The stage adapter prepares a run (prompt snapshot, template version, schema version). Mock and CLI
   modes execute immediately; manual mode records an action-required state and releases the lease.
4. Normalized output passes the stage's Zod schema and is stored as a new immutable artifact version
   (`research_packets`, `drafts`, `audits`, `images`) together with a `provider_runs` row.
5. Each transition goes through the database transition function, which checks the expected status and
   `lock_version`, and appends a `job_events` row in the same transaction.
6. After an `APPROVED` audit, the publishing service (never a provider) executes
   `PUBLISHING -> PUBLISHED`, snapshots content into `articles`, requests revalidation, and records a
   `publishing_logs` entry.
7. The verifier fetches the canonical URL and advances `PUBLISHED -> VERIFIED` only when every check
   passes.

The full status list and transition rules are in the plan, section 8, and the executable application
contract is documented in [STATE-MACHINE.md](STATE-MACHINE.md).

## Local worker runtime

The worker uses a handler registry as its claim allowlist. `claim_next_job` receives only registered
stages; an empty registry claims nothing. This lets the queue runtime ship before provider adapters
without consuming work it cannot finish. A claimed handler runs behind a lease keepalive and an abort
signal. Completion/manual-wait settlement is single-use locally and is checked again by the database
lease token. Transient failures receive jittered stage-specific backoff, while authentication,
subscription usage limits, and invalid provider output require a human.

Provider stages resolve an adapter from the job's snapshotted mode: mock, manual, or a subscription
CLI (Claude Code for writing and revision, Codex for research and audit). CLI adapters run the CLI on
the PC with no shell, an allowlisted environment that never contains the service-role key or an API
key, and a sign-in probe before every prompt that refuses a billable account
([ADR 0007](decisions/0007-subscription-cli-process-boundary.md), [PROVIDERS.md](PROVIDERS.md)).

Every cycle heartbeats and recovers expired leases before claiming. `worker:status` is separate and
read-only, using `worker_status` to observe the heartbeat and exact queue counts without changing
either. Operational setup is in [LOCAL-WORKER.md](LOCAL-WORKER.md), with Hermes and Task Scheduler
examples in [HERMES.md](HERMES.md).

## Admin authentication and authorization

Four layers, each independent of the others
([ADR 0006](decisions/0006-admin-authentication-boundary.md)):

| Layer                         | Responsibility                                                              |
| ----------------------------- | --------------------------------------------------------------------------- |
| `src/proxy.ts`                | Refresh the session cookie; optimistic redirect of signed-out visitors      |
| `src/lib/auth/dal.ts`         | The only place that establishes identity and membership                     |
| Row Level Security            | Narrow what `authenticated` can select at all                               |
| `SECURITY DEFINER` admin RPCs | Re-derive the caller's membership; the only way the console writes anything |

`proxy.ts` is Next.js 16's renamed Middleware convention and runs on the Node.js runtime. It makes no
authorization decision: membership is never read there. No admin layout performs an auth check
either, because a layout does not control whether nested segments render. Each page calls
`requireAdminSession()`, and each Server Action calls `authorizeAdminAction()`.

## Rendering boundaries

- Public and admin routes live in separate route groups with separate root layouts, fonts, and
  stylesheets ([ADR 0004](decisions/0004-public-admin-layout-separation.md)).
- Article bodies are Markdown rendered through an allowlisted component map with raw HTML disabled
  ([ADR 0001](decisions/0001-markdown-not-mdx.md)).
- Public data access goes through server-only repositories that return narrow, Zod-validated DTOs.

## Environment matrix

| Variable                                | Web (Vercel) | Worker (PC) | Notes                                    |
| --------------------------------------- | ------------ | ----------- | ---------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                  | yes          | —           | Canonical public origin                  |
| `NEXT_PUBLIC_SUPABASE_URL`              | yes          | —           | Browser-safe                             |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`  | yes          | —           | Browser-safe                             |
| `SUPABASE_URL`                          | yes          | yes         | Server-side                              |
| `REVALIDATION_SECRET`                   | yes          | yes         | Shared secret for signed revalidation    |
| `SUPABASE_SERVICE_ROLE_KEY`             | **no**       | yes         | Never on Vercel                          |
| `WORKER_*`, `PUBLISH_VERIFY_TIMEOUT_MS` | —            | yes         | Tunables with defaults                   |
| `CODEX_BIN`, `CLAUDE_BIN`               | —            | yes         | Subscription CLI binaries                |
| `OPENAI_API_KEY` etc.                   | —            | optional    | Required only when a stage uses API mode |

See [.env.example](../.env.example) for the annotated template.
