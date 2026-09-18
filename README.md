# FinTechPulse

A UK-first financial and fintech publication ([fintechpulse.co.uk](https://fintechpulse.co.uk)) built on an
automated editorial publishing platform. Articles move through research, drafting, images,
audit, and revision stages using mock, manual, subscription-CLI, or optional API providers. They then
publish to a content-first public site and are verified live.

- **Web** (`/`): Next.js App Router on Vercel, with the public publication and an authenticated admin.
- **Data** (`/supabase`): Supabase Postgres, Auth, and Storage. This is the queue and the source of
  truth.
- **Worker** (`/local-worker`): TypeScript worker that runs only on the owner's Windows PC and is
  invoked by Hermes. It makes outbound connections only.

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The full scope and phase plan are in
[docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md).

## Status

Implementation progress, verification evidence, blockers, and the next action are tracked in
[docs/IMPLEMENTATION-STATUS.md](docs/IMPLEMENTATION-STATUS.md), the authoritative record.

## Requirements

- pnpm `10.32.1` or later
- Docker Desktop (for the local Supabase stack, from Phase 2)
- Playwright Chromium for `pnpm test:e2e`: `pnpm exec playwright install chromium`
- Git with access to `git@github.com:nobledev89/FTP.git`
- On the worker PC only, for the subscription CLI modes: Claude Code and Codex, signed in with the
  subscription accounts (see [docs/PROVIDERS.md](docs/PROVIDERS.md))

You do not need to install Node 24. pnpm downloads the pinned runtime (`24.21.0`) automatically; see
[ADR 0005](docs/decisions/0005-project-local-node-runtime.md). Run every tool through `pnpm`.

## Getting started

```powershell
pnpm install
pnpm supabase:start                  # local Postgres, Auth, and Storage in Docker
Copy-Item .env.example .env.local    # then fill in values from `pnpm exec supabase status`
pnpm dev
```

Open <http://localhost:3000>. Design review fixtures are at `/design-review` and `/admin/design-review`
(outside Vercel production). Supabase setup, the access model, and hosted-project steps are in
[docs/SUPABASE.md](docs/SUPABASE.md).

The public home, `/blog` archive, article pages, RSS, sitemap, robots, and social cards read only
publication-safe Supabase snapshots. Their data/cache contract and signed invalidation protocol are
documented in [docs/PUBLICATION.md](docs/PUBLICATION.md).

The admin console is at `/admin` and needs an account with an active `admin_users` row. To create
one against the local stack:

```powershell
# 1. Add the user in Supabase Studio (http://127.0.0.1:54323) -> Authentication -> Add user,
#    with "Auto Confirm User" enabled.
# 2. Grant it ownership once, from Studio -> SQL Editor:
#    select private.bootstrap_first_owner('you@example.com');
```

Then sign in at <http://localhost:3000/admin/login>. See
[docs/ADMIN-CONSOLE.md](docs/ADMIN-CONSOLE.md) for what each screen does.

## Scripts

| Command                             | What it does                                                          |
| ----------------------------------- | --------------------------------------------------------------------- |
| `pnpm dev`                          | Start the Next.js dev server                                          |
| `pnpm build` / `pnpm start`         | Production build and server                                           |
| `pnpm lint`                         | ESLint across the workspace                                           |
| `pnpm typecheck`                    | Generate route types, then type-check web, worker, and tests          |
| `pnpm test`                         | Unit tests (web and worker Vitest projects)                           |
| `pnpm test:integration`             | Schema, RLS, queue, state machine, and Storage tests (local Supabase) |
| `pnpm test:e2e`                     | Production build plus Playwright design and signed-out admin checks   |
| `pnpm test:e2e:admin`               | Authenticated admin console checks (needs the local Supabase stack)   |
| `pnpm worker:once`                  | Recover leases and process at most one supported worker stage         |
| `pnpm worker:start`                 | Run the worker polling daemon with graceful shutdown                  |
| `pnpm worker:status`                | Read worker heartbeat and queue health without changing jobs          |
| `pnpm supabase:start` / `:stop`     | Start or stop the local Supabase stack                                |
| `pnpm supabase:reset`               | Rebuild the local database from migrations and seed data              |
| `pnpm db:lint`                      | `plpgsql_check` over database functions                               |
| `pnpm db:types`                     | Regenerate database types for the web app and worker                  |
| `pnpm prompts:seed`                 | Regenerate the SQL seed from the reviewed Markdown prompts            |
| `pnpm contracts:sync`               | Sync artifact schemas from the web app into the worker package        |
| `pnpm format` / `pnpm format:check` | Prettier                                                              |

Worker setup and operational behaviour are documented in
[docs/LOCAL-WORKER.md](docs/LOCAL-WORKER.md). The worker runs deterministic mock provider stages,
the manual ChatGPT, Claude, and Gemini handoffs (continued from the admin console; see
[docs/ADMIN-CONSOLE.md](docs/ADMIN-CONSOLE.md)), Claude Code and Codex on the owner's subscriptions
(see [docs/PROVIDERS.md](docs/PROVIDERS.md)), and the internal publishing and verification services.
Phase 10 adds optional API adapters without changing the artifact or queue contracts.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Decision records](docs/decisions/README.md)
- [Design system](docs/DESIGN-SYSTEM.md)
- [Supabase](docs/SUPABASE.md)
- [Admin console](docs/ADMIN-CONSOLE.md)
- [State machine](docs/STATE-MACHINE.md)
- [Local worker](docs/LOCAL-WORKER.md)
- [Providers](docs/PROVIDERS.md)
- [Public publication](docs/PUBLICATION.md)
- [Hermes and Windows scheduling](docs/HERMES.md)
- [Implementation plan](docs/IMPLEMENTATION-PLAN.md)
- [Implementation status](docs/IMPLEMENTATION-STATUS.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

MIT. Portions are adapted from Paperframe (MIT); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
