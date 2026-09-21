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

| File                                                | Contents                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `20260917100000_foundation.sql`                     | `private` schema, default-privilege hardening, enums, pure helpers, history guards                                                                                 |
| `20260917100100_identity_and_config.sql`            | `sites`, `admin_users`, authorization helpers, `prompt_templates`, `site_settings`, `provider_settings`, `worker_instances`                                        |
| `20260917100200_content_and_artifacts.sql`          | `article_jobs`, `provider_runs`, research artifacts, `drafts`, `audits`, `images`, `articles`, slug aliases, `job_events`, `publishing_logs`, `originality_checks` |
| `20260917100300_state_machine_and_queue.sql`        | Transition map, job/article guards, worker functions, publication boundary, admin functions, owner bootstrap                                                       |
| `20260917100400_rls_and_grants.sql`                 | RLS on every table, explicit grants, policies                                                                                                                      |
| `20260917100500_storage.sql`                        | `article-work` and `article-public` buckets and policies                                                                                                           |
| `20260917100600_indexes.sql`                        | Queue, lease, dashboard, public list, and timeline indexes                                                                                                         |
| `20260918100000_admin_console.sql`                  | Admin membership helpers, `admin_dashboard`, `admin_update_site_settings`, `admin_update_site_identity`                                                            |
| `20260918110000_worker_status.sql`                  | Read-only worker heartbeat and exact queue-health snapshot                                                                                                         |
| `20260918120000_mock_pipeline.sql`                  | Authorized immutable prompt-version creation, activation, and rollback                                                                                             |
| `20260918130000_manual_workflows.sql`               | Authorized manual import and image continuation, abandoned-run cancellation, implemented-mode provider defaults                                                    |
| `20260918140000_subscription_cli_modes.sql`         | Enables the stage-specific Claude Code and Codex defaults                                                                                                          |
| `20260918150000_api_provider_modes.sql`             | Enables stage-specific API defaults only with recorded metered-cost confirmation                                                                                   |
| `20260921100000_publishing_hardening.sql`           | Schedule horizon, revalidation logs, bounded verification retries                                                                                                  |
| `20260921110000_direct_manual_image_uploads.sql`    | Limits editor Storage inserts to the current manual image job/run/slot for direct uploads                                                                          |
| `20260921120000_article_withdrawal.sql`             | `admin_withdraw_article`: takes a live article off the site and cancels its verification                                                                           |
| `20260921130000_codex_image_mode.sql`               | `codex_image` provider mode for the images stage                                                                                                                   |
| `20260921130100_codex_image_mode_rules.sql`         | Mode rules and console selection for `codex_image`                                                                                                                 |
| `20260921140000_discarded_status.sql`               | Terminal `DISCARDED` status and its transitions                                                                                                                    |
| `20260921140100_discard_job.sql`                    | `admin_discard_job`: turns down an unpublished article with a required reason                                                                                      |
| `20260921150000_topic_discovery.sql`                | Topic categories, discovery settings and runs, job provenance, worker discovery functions                                                                          |
| `20260921160000_seed_topic_discovery_prompt.sql`    | Seeds the `topic-discovery` prompt on databases created before it                                                                                                  |
| `20260921170000_editor_desk.sql`                    | `admin_reschedule_job` (publish now or move a scheduled time) and opt-in auto-publish for discovered articles                                                      |
| `20260921180000_editorial_illustration_prompts.sql` | House illustration style for generated article images                                                                                                              |
| `20260921180100_hero_image_replacement.sql`         | Replacing the hero image on a live article                                                                                                                         |
| `20260921190000_auto_publish_policy.sql`            | Automatic publication policy: hero, duplicate, and daily-count checks, 15-minute spacing, `auto_publish_hold_reason`                                               |

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

| Role                            | Tables                                                                    | Functions                                                                              |
| ------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `anon`                          | Read `sites`; read `articles` and slug aliases that are published and due | None                                                                                   |
| `authenticated` (no membership) | Same as `anon`                                                            | Admin functions reject with `42501`                                                    |
| Admin `viewer`                  | Read every editorial table and all articles                               | `admin_dashboard`; writes reject with `42501`                                          |
| Admin `editor`                  | Same reads as viewer; no direct writes                                    | Adds job transitions, settings, prompt versions, manual imports, and provider defaults |
| Admin `owner`                   | Same reads as editor; no direct writes                                    | Adds `admin_update_site_identity`                                                      |
| `service_role` (worker)         | Full table access, still subject to the state machine and history guards  | Worker functions below                                                                 |

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
| `record_revalidation`    | Records one cache-invalidation attempt against a published article; never changes job or article state                 |
| `recover_expired_leases` | Returns expired work to its pending status, or `FAILED` after the final attempt                                        |
| `worker_status`          | Read-only heartbeat, thresholds, and exact queue-health snapshot for the configured worker                             |

`worker_status` is the only worker RPC that is deliberately observation-only: it does not heartbeat,
recover leases, or claim work. This keeps `pnpm worker:status` safe for monitoring probes.

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

`admin_dashboard(list_limit)` returns one `jsonb` summary for the caller's site: status and stage
counts, totals, and bounded lists of the jobs awaiting input, blocked, in progress, upcoming, and
recently published, plus worker heartbeats classified against the configured thresholds. Any active
membership may call it. `list_limit` is clamped to 1-50.

`admin_update_site_settings(...)` (editor or owner) replaces every editable column of
`site_settings` and records `updated_by`. Every value is passed on each call, so an empty string
clears an optional column. Table constraints still apply: the email format, the threshold ranges,
and `worker_offline_after_seconds > worker_stale_after_seconds`.

`admin_update_site_identity(name, description, disclosure, timezone)` (owner only) updates `sites`.
It deliberately does not expose `canonical_origin`, `locale`, or `currency`: the canonical origin is
baked into the canonical URL of every published article, so it is a migration decision, not a
setting. An unknown timezone is rejected with `22023`.

`admin_create_prompt_version(...)` allocates the next immutable version under a per-site/key
transaction lock and optionally activates it. `admin_activate_prompt_template(template_id)` makes an
existing version active, which is the rollback operation. Both require editor access; activating an
`editorial-style` version also updates `site_settings.style_guide_template_id`.

Manual provider continuation (Phase 8, editor or owner). Each call requires the job to be waiting on
that exact `action_required` run, with no lease and not paused, and runs in one transaction:

| Function                                                                                   | Effect                                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `admin_import_manual_result(job_id, run_id, output)`                                       | Stores a research packet (with sources, claims, evidence), draft, revised draft, or audit; finishes the run; completes the stage through `complete_stage_core`     |
| `admin_import_manual_image(job_id, run_id, slot, metadata, private_path, mime, size, ...)` | Records one uploaded image as `ready` for a requested slot. The object must exist under `jobs/<job id>/` and its stored size and type must match the recorded ones |
| `admin_complete_manual_images(job_id, run_id)`                                             | Completes `IMAGES_PROCESSING → AUDIT_PENDING` once every requested slot has a ready image from this run (`FT005` otherwise)                                        |
| `admin_update_provider_setting(stage, mode, confirm_api)`                                  | Changes a stage's default for new jobs. API modes require confirmation and record the editor/time; free modes clear it; writing also sets revision                 |

A second import of a finished run fails with `FT004`. A draft that does not brief every requested
image slot fails with `22023`. When a job leaves a manual wait without an import (escalation), the
`article_jobs_cancel_superseded_manual_run` trigger marks the abandoned run `cancelled`.

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

| Bucket           | Visibility | Path convention                                              | Writers                                               |
| ---------------- | ---------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| `article-work`   | Private    | `jobs/<job>/manual/<run>/slot-<n>-<uuid>.<ext>` for browsers | Current manual-image editor via signed upload; worker |
| `article-public` | Public URL | `articles/<slug>/<file>`                                     | Worker (publishing service) only                      |

Both buckets accept PNG, JPEG, WebP, and AVIF up to 10 MB. Browser roles cannot overwrite, delete, or
list objects. An editor can create a signed upload only while that exact `manual_gemini` run is the
job's current action, the slot was requested, and the job is not paused. The import action downloads
the private object and inspects its bytes; `admin_import_manual_image` independently checks the
stored object's size and MIME metadata before recording a version.

## Authentication assumptions

- Email and password sign-in for admins. Public sign-up is disabled (`[auth] enable_signup = false`).
  Keep `[auth.email] enable_signup = true`: setting it to `false` disables email login entirely.
- Minimum password length is 12.
- Admin access comes only from an active `admin_users` row. A signed-in user without a membership
  sees exactly what an anonymous visitor sees.
- Removing an auth user removes their membership; `job_events` keep the user id as history.
- The web app verifies the session with `getClaims()`, which checks the access token's signature,
  rather than trusting the cookie's contents. See
  [decisions/0006-admin-authentication-boundary.md](decisions/0006-admin-authentication-boundary.md).

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

   The function refuses to run if an active owner already exists. Further memberships are added the
   same way for now, with an `insert into public.admin_users` from the SQL editor; managing them from
   the console is not part of version 1.

7. Copy the **publishable** key to Vercel. Copy the **secret** (service role) key only into
   `local-worker/.env.local` on the worker PC. Never add it to Vercel.

Continue with [DEPLOYMENT.md](DEPLOYMENT.md) for the Vercel preview, Cloudflare DNS, production
smoke tests, and worker release order.
