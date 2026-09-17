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

## Commands

| Command              | Behaviour                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm worker:once`   | Heartbeat, recover expired leases, claim at most one supported stage, process it, then exit             |
| `pnpm worker:start`  | Run the same cycle continuously; stop cleanly on `Ctrl+C`, `SIGINT`, `SIGTERM`, or `SIGHUP`             |
| `pnpm worker:status` | Read configuration-safe heartbeat and exact queue health without claiming, recovering, or changing jobs |

Phase 5 intentionally registers no provider-stage handlers. The commands are operational, but
`worker:once` and `worker:start` pass an empty stage filter to the atomic claim function and remain
idle after heartbeat/recovery. Phase 6 installs deterministic mock handlers. This prevents an early
worker from consuming a job it cannot finish.

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
  never bypasses it.

## Logs and status

The worker writes one JSON object per line. Events include the worker ID, job ID, stage, attempt, and
safe outcome data. Secret-bearing fields, bearer credentials, provider keys, JWTs, URL credentials,
email addresses, and local Windows/POSIX home paths are redacted before output. Do not add raw prompts,
provider output, environment objects, or process command lines to log fields.

`worker:status` uses the service-role-only `worker_status` RPC. It reports heartbeat age/state,
current work, configured safe timings, exact queue counts, expired leases, delayed retries, action
requirements, failures, and counts by status. It does not heartbeat or recover expired work, so a
health probe cannot alter the queue.

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
