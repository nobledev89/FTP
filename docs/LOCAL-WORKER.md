# Local worker

The local worker is the only FinTechPulse process that holds the Supabase service-role credential.
It runs on the owner's Windows PC, makes outbound HTTPS connections only, and is never deployed to
Vercel. The queue and lease design is documented in
[ADR 0002](decisions/0002-queue-leases.md).

## Setup

1. Run `pnpm install` at the repository root.
2. Copy the worker section of `.env.example` to `local-worker/.env.local`.
3. Fill `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_SITE_URL`,
   `REVALIDATION_SECRET`, and a stable lowercase `WORKER_ID`.
4. Keep the file on the worker PC. It is git-ignored and must never be copied to Vercel.
5. Check connectivity with `pnpm worker:status`.

The optional `WORKER_HOST_LABEL` is uploaded to the admin dashboard. It defaults to `WORKER_ID`; the
worker deliberately does not upload the Windows hostname. Optional AI keys are not required until a
stage is explicitly configured for its API mode.

For the subscription CLI modes, install Claude Code and Codex on the same PC and sign both in with
the subscription accounts (`claude auth login`, `codex login` with ChatGPT). Setup, isolation, and
failure handling are in [PROVIDERS.md](PROVIDERS.md). `pnpm worker:status` reports whether each CLI
is installed, supported, and signed in to a subscription.

## Commands

| Command              | Behaviour                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm worker:once`   | Heartbeat, recover expired leases, claim at most one supported stage, process it, then exit             |
| `pnpm worker:start`  | Run the same cycle continuously; stop cleanly on `Ctrl+C`, `SIGINT`, `SIGTERM`, or `SIGHUP`             |
| `pnpm worker:status` | Read configuration-safe heartbeat and exact queue health without claiming, recovering, or changing jobs |

The worker registers research, draft, image, audit, revision, publish, and verify handlers. Provider
stages implement `mock`, the manual subscription modes (`manual_chatgpt` for research and audit,
`manual_claude` for writing and revision, `manual_gemini` for images), and the subscription CLI
modes (`codex_cli` for research and audit, `claude_code` for writing and revision), and the API modes
(`openai_api`, `anthropic_api`, and `gemini_api`); publication and verification use the internal
services. A manual stage prepares and snapshots the exact prompt, releases its lease, and waits for
an editor to paste or upload the response in the console, so a manual job never holds the worker. A
CLI or API stage runs on this PC while holding and renewing its lease. At startup the worker reads
the current provider settings and requires only keys for API providers selected there. A mode
switched while an already-running worker lacks its key stops as an actionable authentication
failure. It is never replaced with a mock, CLI, manual, or different API mode.

At start-up (and every ten minutes under `worker:start`) the worker probes both CLIs — version,
supported options, and sign-in, never a prompt — and includes the result in its heartbeat, where the
console's Providers page shows it. Each CLI stage probes again immediately before it sends a prompt.

Each provider run's idempotency key is `job:stage:cycle:attempt:claim-version`. The claim version (the
job's `lock_version` at claim) keeps a stage that an admin retried or resolved, which resets the
attempt counter, from reopening the finished run of an earlier claim. A draft from any mode must
brief every requested image slot; one that does not is rejected as `invalid_output`.

Mock jobs can exercise exceptional branches from the article keywords field:

| Keyword                        | Behaviour                                                      |
| ------------------------------ | -------------------------------------------------------------- |
| `mock:audit=pass`              | First audit passes (the default)                               |
| `mock:audit=revision`          | First audit requests revision; the re-audit passes             |
| `mock:audit=needs_human`       | Audit records a conflict and moves the job to `NEEDS_HUMAN`    |
| `mock:fail=<stage>`            | Stage fails once, then succeeds on a later attempt             |
| `mock:fail-always=<stage>`     | Stage fails on every attempt                                   |
| `mock:manual=<provider-stage>` | Releases the lease and records an action-required provider run |
| `mock:slow=<milliseconds>`     | Adds a bounded delay for lease, pause, and shutdown testing    |

The mock image stage creates real deterministic PNG bytes, stores them privately, and uses the same
public-copy service as a future image adapter. After `publish_article` commits, the publishing
service sends a timestamped, nonce-bound HMAC request to `PUBLIC_SITE_URL/api/revalidate`, retrying
transport failures, `429`, and `5xx` up to three times with a fresh signature each time; a rejected
signature is not retried. Every attempt is recorded through `record_revalidation` as a `revalidate`
row in `publishing_logs`. A failed cache request never rolls back an already published snapshot; the
live verifier remains the correctness backstop and schedules a bounded retry if the page is not
fresh or reachable.

Live verification fetches the real `/blog/[slug]` page and checks its status, canonical URL, title,
body, hero, metadata, Article JSON-LD, and placeholder markers before `record_verification` may
advance the job to `VERIFIED`. `hero_image_ok` resolves the hero the page actually rendered and
fetches it (`HEAD`, falling back to `GET`), so an article whose public image copy never landed fails
verification instead of passing as a partially available page. Failed attempts back off on the
`verify` stage schedule, which `record_verification` clamps to between now and one hour out; once the
attempts are exhausted the job raises `verification_failed` naming the checks that failed.

Exit codes are stable shell contracts:

| Code | Meaning                                                                         |
| ---: | ------------------------------------------------------------------------------- |
|  `0` | Command completed; `worker:once` may simply have found no eligible job          |
|  `1` | Database/runtime command failed                                                 |
|  `2` | Usage or environment configuration is invalid                                   |
|  `3` | `worker:status` reached Supabase, but this worker is missing, stale, or offline |

## Queue safety

- Claims are atomic `FOR UPDATE SKIP LOCKED` transactions. A second worker skips a locked or already
  leased job.
- The worker claims only stages with registered handlers.
- Every claim carries a random lease token. Completion, failure, and manual-wait calls must present
  the matching worker ID and unexpired token.
- Active handlers renew the lease and heartbeat. Losing the lease aborts local work; the old worker
  does not attempt completion with a stale token.
- A shutdown aborts the active handler and schedules a transient retry with backoff. If the process
  is killed before that transaction, expiry recovery returns the job to its pending state.
- Settlement is single-use in memory and fenced again by the database. Provider artifacts use
  deterministic idempotency keys in later phases.
- Auth, usage-limit, and invalid-output failures require human action. Permanent configuration
  failures stop; transient, rate-limit, and unknown failures use jittered exponential backoff with
  stage-specific caps. The worker attempt ceiling can be lower than the database job ceiling but
  never bypasses it. A missing, signed-out, or API-key-signed-in CLI is an auth failure (console
  action "CLI sign-in needed"); a subscription usage limit is a usage-limit failure. Neither is
  retried automatically, and neither is ever handed to an API mode.

## Logs and status

The worker writes one JSON object per line. Events include the worker ID, job ID, stage, attempt, and
safe outcome data. Secret-bearing fields, bearer credentials, provider keys, JWTs, URL credentials,
email addresses, and local Windows/POSIX home paths are redacted before output. Do not add raw prompts,
provider output, environment objects, or process command lines to log fields.

`worker:status` uses the service-role-only `worker_status` RPC. It reports heartbeat age/state,
current work, configured safe timings, exact queue counts, expired leases, delayed retries, action
requirements, failures, and counts by status, plus a fresh probe of each subscription CLI under
`providers`. It does not heartbeat or recover expired work, so a health probe cannot alter the queue.

## Manual debugging

Run these from PowerShell at the repository root:

```powershell
pnpm worker:status
pnpm worker:once
pnpm worker:start
```

Use `Ctrl+C` once to request graceful shutdown. A stage interrupted this way is released into retry
backoff. If a process was terminated forcefully, wait for its lease to expire, then run
`pnpm worker:once`; recovery is also performed inside every claim transaction.

For local Supabase, use the URL and secret printed by `pnpm exec supabase status -o env`. Hosted
credentials come from the Supabase project API settings. Never paste either secret into an issue,
chat transcript, committed file, or screenshot.

Hermes and Task Scheduler examples are in [HERMES.md](HERMES.md).
