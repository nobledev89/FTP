# Supabase

Supabase is the queue, source of truth, and security boundary for FinTechPulse. This guide covers the
local stack, the schema, who can do what, and how to set up a hosted project.

## Local development

Requirements: Docker Desktop running, and dependencies installed with `pnpm install`.

| Command                 | What it does                                                                 |
| ----------------------- | ---------------------------------------------------------------------------- |
| `pnpm supabase:start`   | Starts the local stack and applies migrations and seed data on first run     |
| `pnpm supabase:stop`    | Stops the stack (data is kept)                                               |
| `pnpm supabase:reset`   | Recreates the database from `supabase/migrations` and `supabase/seed.sql`    |
| `pnpm db:lint`          | Runs `plpgsql_check` over `public` and `private`; fails on any warning       |
| `pnpm db:types`         | Regenerates TypeScript types for the web app and the worker                  |
| `pnpm test:integration` | Schema, RLS, queue, state machine, and Storage tests against the local stack |

Local URLs: API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`, email testing
`http://127.0.0.1:54324`. `pnpm exec supabase status` prints the local keys. They are the standard
local development keys, not secrets.

After changing a migration, run `pnpm supabase:reset`, `pnpm db:lint`, `pnpm db:types`, and
`pnpm test:integration`. CI runs the same sequence and fails if the generated types are out of date.

## Schema overview

Migrations run in order:

| File                                         | Contents                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `20260917100000_foundation.sql`              | `private` schema, default-privilege hardening, enums, pure helpers, history guards                                                                                 |
| `20260917100100_identity_and_config.sql`     | `sites`, `admin_users`, authorization helpers, `prompt_templates`, `site_settings`, `provider_settings`, `worker_instances`                                        |
| `20260917100200_content_and_artifacts.sql`   | `article_jobs`, `provider_runs`, research artifacts, `drafts`, `audits`, `images`, `articles`, slug aliases, `job_events`, `publishing_logs`, `originality_checks` |
| `20260917100300_state_machine_and_queue.sql` | Transition map, job/article guards, worker functions, publication boundary, admin functions, owner bootstrap                                                       |
| `20260917100400_rls_and_grants.sql`          | RLS on every table, explicit grants, policies                                                                                                                      |
| `20260917100500_storage.sql`                 | `article-work` and `article-public` buckets and policies                                                                                                           |
| `20260917100600_indexes.sql`                 | Queue, lease, dashboard, public list, and timeline indexes                                                                                                         |

Design rules enforced by the database:

- **Artifacts are immutable.** Research packets, sources, claims, drafts, audits, originality checks,
  and finished provider runs reject updates and deletes. Only review metadata (`review_note`,
  `reviewed_by`, `reviewed_at`) may change. Corrections are new versions.
- **History is append-only.** `job_events` and `publishing_logs` reject updates and deletes.
- **Artifacts stay inside their job.** Composite foreign keys on `(id, job_id)` stop a draft from
  referencing another job's research, and similar cross-job references.
- **Status changes use the state machine.** A trigger on `article_jobs` rejects direct status, lease,
  and workflow-column edits from every role, including the service role. It also rejects any status
  pair missing from `private.job_transitions`.
- **Only the publishing service publishes.** `PUBLISHING → PUBLISHED` is possible only inside
  `publish_article`, `PUBLISHED → VERIFIED` only inside `record_verification`, and `articles` rows can be
  written only by those functions.
- **API modes need confirmation.** `provider_settings` rejects a billable API mode without
  `api_mode_confirmed_at`, and rejects secret-looking keys in `settings`.

## Access matrix

| Role                            | Tables                                                                    | Functions                                    |
| ------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| `anon`                          | Read `sites`; read `articles` and slug aliases that are published and due | None                                         |
| `authenticated` (no membership) | Same as `anon`                                                            | Admin functions reject with `42501`          |
| Admin `viewer`                  | Read every editorial table and all articles                               | Admin functions reject with `42501`          |
| Admin `editor`/`owner`          | Same reads as viewer; no direct writes                                    | `create_article_job`, `admin_transition_job` |
| `service_role` (worker)         | Full table access, still subject to the state machine and history guards  | Worker functions below                       |

`private.bootstrap_first_owner` cannot be executed by any API role.

## Worker functions (service role)

| Function                 | Purpose                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `heartbeat_worker`       | Upserts `worker_instances` for dashboard health                                                                        |
| `claim_next_job`         | Recovers expired leases, then atomically claims one due job (`FOR UPDATE SKIP LOCKED`) and returns a lease token       |
| `renew_lease`            | Extends a held lease; does not change `lock_version`                                                                   |
| `complete_stage`         | Checks the stage gate, completes the stage, and applies automatic follow-on transitions                                |
| `request_manual_action`  | Releases the lease and marks the active stage as waiting for manual input                                              |
| `fail_stage`             | `retry` (back to pending with `next_attempt_at`), `failed`, or `needs_human`; auth and usage-limit errors cannot retry |
| `publish_article`        | The publication boundary (plan section 8.3); marks copied images published and snapshots the approved draft            |
| `record_verification`    | Logs each live check; `VERIFIED` only when all eight pass, otherwise stays `PUBLISHED` and retries                     |
| `recover_expired_leases` | Returns expired work to its pending status, or `FAILED` after the final attempt                                        |

## Admin functions (authenticated)

`create_article_job` creates an `IDEA` job. Provider modes default to `provider_settings`, and API
modes are rejected unless confirmed there.

`admin_transition_job(job_id, action, expected_lock_version, note, to_status, desired_publish_at)`:

| Action             | Transition                                  | Notes                                                                                                                                      |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `start`            | `IDEA → RESEARCH_PENDING`                   |                                                                                                                                            |
| `pause`            | pausable → `PAUSED`                         | Releases a running lease and resumes from the pending status                                                                               |
| `resume`           | `PAUSED → paused_from_status`               |                                                                                                                                            |
| `retry`            | `FAILED →` pending status of `failed_stage` | Resets attempts                                                                                                                            |
| `mark_needs_human` | pausable → `NEEDS_HUMAN`                    | Note required                                                                                                                              |
| `resolve`          | `NEEDS_HUMAN →` explicit destination        | Note required. Research, draft, and image escalations cannot skip ahead. `APPROVED` needs the latest valid draft to have the latest audit. |
| `schedule`         | `APPROVED → SCHEDULED`                      | `desired_publish_at` defaults to now                                                                                                       |

Every admin action checks `expected_lock_version` and appends a `job_events` row.

## Error codes

| SQLSTATE | Meaning                                               | Typical handling                          |
| -------- | ----------------------------------------------------- | ----------------------------------------- |
| `FT001`  | Invalid transition or write outside the state machine | Bug or stale UI; reload the job           |
| `FT002`  | Stale `lock_version`                                  | Reload and retry the admin action         |
| `FT003`  | Worker does not hold a valid lease                    | Abandon the stage; another worker owns it |
| `FT004`  | Immutable history change attempted                    | Create a new version instead              |
| `FT005`  | Stage gate not met                                    | Produce the missing artifact or escalate  |
| `FT006`  | Slug conflict at publication                          | `fail_stage` with `needs_human`           |
| `42501`  | Not authorized                                        | Show an access error                      |
| `22023`  | Invalid argument                                      | Validation bug; fix the caller            |
| `P0002`  | Job not found                                         |                                           |

## Storage

| Bucket           | Visibility | Path convention          | Writers                                         |
| ---------------- | ---------- | ------------------------ | ----------------------------------------------- |
| `article-work`   | Private    | `jobs/<job id>/...`      | Editors and owners (existing jobs only), worker |
| `article-public` | Public URL | `articles/<slug>/<file>` | Worker (publishing service) only                |

Both buckets accept PNG, JPEG, WebP, and AVIF up to 10 MB. Browser roles cannot overwrite, delete, or
list objects.

## Authentication assumptions

- Email and password sign-in for admins. Public sign-up is disabled (`[auth] enable_signup = false`).
  Keep `[auth.email] enable_signup = true`: setting it to `false` disables email login entirely.
- Minimum password length is 12.
- Admin access comes only from an active `admin_users` row. A signed-in user without a membership
  sees exactly what an anonymous visitor sees.
- Removing an auth user removes their membership; `job_events` keep the user id as history.

## Hosted project setup

1. Create the project in the Supabase dashboard (region close to the UK, for example London).
2. Link and push the schema from the repository root:

   ```powershell
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <project-ref>
   pnpm exec supabase db push --dry-run
   pnpm exec supabase db push --include-seed
   ```

3. In **Authentication → Providers → Email**: keep email enabled, turn off **Allow new users to sign
   up**, and set the minimum password length to 12.
4. In **Authentication → URL Configuration**: set the site URL to `https://fintechpulse.co.uk` and add
   `http://localhost:3000` plus any Vercel preview domain you use as redirect URLs.
5. Create the first admin in **Authentication → Users → Add user** (or invite them).
6. Grant them ownership once, in **SQL Editor**:

   ```sql
   select private.bootstrap_first_owner('owner@example.com');
   ```

   The function refuses to run if an active owner already exists. Add further admins from the admin
   application (Phase 4).

7. Copy the **publishable** key to Vercel. Copy the **secret** (service role) key only into
   `local-worker/.env.local` on the worker PC. Never add it to Vercel.
