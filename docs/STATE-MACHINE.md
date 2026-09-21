# State machine

This document is the application contract for the FinTechPulse article-job lifecycle. PostgreSQL is
the authority for writes. The pure TypeScript model in
`src/lib/state-machine/transitions.ts` mirrors that authority so callers can render controls and
reject impossible requests before a round trip.

The integration suite compares every TypeScript transition with every row in
`private.job_transitions`. A change on either side fails until both contracts agree.

## Core rules

- Every job starts in `IDEA` with `lock_version = 0`.
- Status and workflow fields change only through the database functions. Direct writes are rejected,
  including writes made with the service role.
- `PUBLISHED` is reachable only through `publish_article`; `VERIFIED` is reachable only through
  `record_verification` after every required live check passes.
- Admin commands include the status-independent `expected_lock_version`. Stale commands fail with
  `FT002` rather than overwriting newer work.
- Active worker stages use a worker ID, random lease token, and expiry. Completion, failure, and
  manual-action commands must present the current unexpired lease.
- Research packets, drafts, and audits are immutable versions. Images become progressively more
  restricted and are immutable once ready. Events and publishing logs are append-only.

## Normal path

| Current status      | Normal destination(s)                             | Owner of the transition                                   |
| ------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| `IDEA`              | `RESEARCH_PENDING`                                | Admin `start`                                             |
| `RESEARCH_PENDING`  | `RESEARCHING`                                     | Worker claim                                              |
| `RESEARCHING`       | `RESEARCH_COMPLETE`                               | Worker completion; valid research required                |
| `RESEARCH_COMPLETE` | `DRAFT_PENDING`                                   | Automatic follow-on                                       |
| `DRAFT_PENDING`     | `DRAFTING`                                        | Worker claim                                              |
| `DRAFTING`          | `DRAFT_COMPLETE`                                  | Worker completion; valid draft required                   |
| `DRAFT_COMPLETE`    | `IMAGES_PENDING` or `AUDIT_PENDING`               | Automatic; skips images only when count is 0              |
| `IMAGES_PENDING`    | `IMAGES_PROCESSING`                               | Worker claim                                              |
| `IMAGES_PROCESSING` | `AUDIT_PENDING`                                   | Worker completion; all requested images ready             |
| `AUDIT_PENDING`     | `AUDITING`                                        | Worker claim                                              |
| `AUDITING`          | `APPROVED`, `REVISION_REQUIRED`, or `NEEDS_HUMAN` | Worker completion matching the audit verdict              |
| `REVISION_REQUIRED` | `REVISING`                                        | Worker claim                                              |
| `REVISING`          | `RE_AUDIT_PENDING`                                | Worker completion; new draft must answer the latest audit |
| `RE_AUDIT_PENDING`  | `AUDITING`                                        | Worker claim                                              |
| `APPROVED`          | `SCHEDULED` or `PUBLISHING`                       | Admin schedule or worker claim                            |
| `SCHEDULED`         | `PUBLISHING`                                      | Worker claim after the scheduled time                     |
| `PUBLISHING`        | `PUBLISHED`                                       | Publication RPC only                                      |
| `PUBLISHED`         | `VERIFIED`                                        | Verification RPC only                                     |
| `VERIFIED`          | none                                              | Terminal                                                  |

Completing research automatically queues drafting. Completing a draft automatically queues images,
or audit when no images were requested. A passing audit records the exact approved draft and audit.
Automatic publication may queue a future schedule; otherwise an approved job waits for an explicit
schedule or publish policy.

An `APPROVED` job with `auto_publish` and no time is claimable immediately. That is what
`site_settings.discovery_auto_publish` sets on discovered jobs when they are created, so a
discovered article can go live on its passing audit without an editor. It is on by default, and
the value is fixed on each job at creation, so changing it never moves work already in the
pipeline.

For a discovered job, `private.complete_stage_core` applies the automatic publication policy
(migration `20260921190000`) the moment the audit passes, before the automatic follow-on
transitions run. An article publishes by itself only when it has a ready hero image in slot 0, its
headline does not restate an article already live or already scheduled, and the day it would
appear on is still inside the publication's articles-per-day count (the sum of the topic
categories' daily targets). It is then given the first slot at least
`site_settings.auto_publish_spacing_minutes` (15 by default) after the most recent publication or
pending schedule, which the existing `APPROVED → SCHEDULED` rule picks up; the first article of a
quiet period is due immediately and stays `APPROVED`.

An article that fails a check keeps its place instead: `auto_publish` is cleared,
`auto_publish_hold_reason` records `no_image`, `duplicate`, or `daily_cap`, a
`job.auto_publish_held` event is appended, and the article waits at `APPROVED` for an editor, who
sees the reason on its dashboard card. The policy never touches an editor's own job
(`origin = 'editor'`), and neither **Publish now** nor `admin_reschedule_job` consults it, so
hands-on publication is always immediate.

`desired_publish_at` is an instant, never a local reading: the console converts the editor's local
time using the site timezone, and the queue compares instants, so a repeated or skipped local hour is
never ambiguous. A schedule more than a year out is rejected with `FT005` rather than parked in the
queue where no worker would ever claim it. Claim eligibility and publication eligibility are checked
independently, so rescheduling a job a worker already holds still cannot publish it early.

## Exceptional paths

### Pause and resume

Any nonterminal status before publishing begins may move to `PAUSED`. If the job holds a worker lease,
the lease is released and `paused_from_status` is normalized to the stage's pending status. For
example, an interrupted `DRAFTING` job resumes at `DRAFT_PENDING`. A manual-input wait has no lease and
resumes in the same active status so the prepared run can continue.

`PUBLISHING`, `PUBLISHED`, `VERIFIED`, `FAILED`, and `NEEDS_HUMAN` cannot be paused.

### Failure, retry, and recovery

The active research, drafting, image, audit, revision, and publishing states may move to `FAILED` after
retry exhaustion or a permanent failure. The failed stage is retained. Admin `retry` returns the job
to that stage's pending status; a scheduled publishing attempt returns to `SCHEDULED`.

Transient failures and expired leases recover directly to the relevant pending status. Audit recovery
uses `RE_AUDIT_PENDING` once a revision has completed. Publishing recovery returns to `SCHEDULED` when
a schedule exists and otherwise to `APPROVED`.

Authentication and subscription usage-limit errors are never tight-loop retries. They require human
action.

### Human resolution

Pausable statuses and `PUBLISHING` may escalate to `NEEDS_HUMAN`. A note of at least three characters
is mandatory. Resolution also requires a note and an explicit destination from:

- `RESEARCH_PENDING`
- `DRAFT_PENDING`
- `IMAGES_PENDING`
- `AUDIT_PENDING`
- `RE_AUDIT_PENDING`
- `REVISION_REQUIRED`
- `APPROVED`

The database applies artifact gates as well as the transition map. An escalation at research, draft,
or images cannot skip forward. Resolving to `APPROVED` requires the latest valid draft to be covered by
the latest audit. A third automatic revision cycle is not allowed.

### Rescheduling and publishing now

A job is scheduled by `admin_transition_job` (`APPROVED → SCHEDULED`); with no time given, the
schedule is `now()`, which is what the console's **Publish now** sends for a ready article.

`admin_reschedule_job` moves an already `SCHEDULED` job's `desired_publish_at`, again defaulting to
`now()`. The status does not change, so no transition is involved and the transition map is
untouched; it checks the caller, the site, and `lock_version`, appends a `job.rescheduled` event,
and leaves the horizon guard to reject a time more than a year out. A job the worker has already
claimed for publication is `PUBLISHING`, not `SCHEDULED`, so it cannot be moved under the worker.

Claim eligibility is unchanged: the queue publishes a `SCHEDULED` job once its instant has passed,
so "publish now" means "on the worker's next poll", not "inside this request".

### Discarding

`admin_discard_job` moves any unpublished job — every pausable status, plus `PAUSED`, `FAILED`, and
`NEEDS_HUMAN` — to the terminal `DISCARDED` status with a required reason (3–500 characters). It
is refused while a stage runs under a live lease, clears an expired lease and any pending manual
action, and keeps every artifact. Nothing leaves `DISCARDED`. Published work is taken down with
`admin_withdraw_article` instead, which marks the article withdrawn and leaves the job's status
alone.

### Manual provider waits

`request_manual_action` keeps the current active status, releases the worker lease, connects the job to
a matching `provider_runs` row in `action_required`, and appends an `action.required` event.

An editor continues the wait through one of three functions, each a single transaction that
re-authorizes the caller, locks the job and run, and requires the job to still be waiting on that
exact run with no lease (Phase 8):

- `admin_import_manual_result` stores a research packet (with its source and claim graph), a draft or
  revised draft, or an audit; finishes the run; and completes the stage through the same
  `complete_stage_core` the worker uses, so gates, revision limits, and follow-on transitions are
  identical to every other mode.
- `admin_import_manual_image` records one uploaded Gemini image per call (the job stays in
  `IMAGES_PROCESSING`), and `admin_complete_manual_images` completes the stage once every requested
  slot has a ready image from this run.

The console validates pasted output against the shared Zod contract first; the database repeats the
shape checks it depends on, and rejects a draft that does not brief every requested image slot. A
second import of a finished run fails with `FT004` and names the accepted artifact.

A paused manual wait keeps its run, so resuming shows the same prompt; nothing is accepted while the
job is `PAUSED`. Escalating the wait instead abandons the run: a trigger marks it `cancelled` when the
job's `action_required_run_id` moves away without an import, and a later claim prepares a fresh
prompt in a new run.

## TypeScript boundaries

### Pure model

`src/lib/state-machine/transitions.ts` exports the status and stage sets, all 99 allowed transition
pairs, path classification, status-to-stage mapping, and pending-state selection. It does not access a
database and is safe for tests and presentation logic. It does not replace database authorization or
artifact gates.

`src/lib/state-machine/admin-rules.ts` models the deterministic part of admin actions, including stale
lock detection and pause normalization. Site ownership, current database state, artifact validity, and
audit verdicts remain database checks.

### Database-backed services

`src/lib/state-machine/supabase.ts` exposes two capabilities:

- `AdminWorkflowService` calls `admin_transition_job` for start, pause, resume, retry, escalation,
  resolution, and scheduling. Every command carries `expectedLockVersion`.
- `WorkerWorkflowService` calls the lease-fenced claim, complete, manual-action, and failure RPCs. This
  service must be constructed with the worker's service-role client only.

Database errors are normalized into `WorkflowError` values without discarding the SQLSTATE.

| SQLSTATE | Application code     | Meaning                                                   |
| -------- | -------------------- | --------------------------------------------------------- |
| `FT001`  | `INVALID_TRANSITION` | Status pair or command is not allowed                     |
| `FT002`  | `STALE_JOB`          | `lock_version` no longer matches                          |
| `FT003`  | `LEASE_LOST`         | Worker does not hold a current lease                      |
| `FT004`  | `IMMUTABLE_HISTORY`  | Attempt to rewrite or delete history                      |
| `FT005`  | `GATE_NOT_MET`       | Required artifact, verdict, image, or schedule is missing |
| `FT006`  | `SLUG_CONFLICT`      | Publication slug is already in use                        |
| `42501`  | `NOT_AUTHORIZED`     | Role, membership, or site check failed                    |
| `P0002`  | `NOT_FOUND`          | Job or required record does not exist                     |
| `22023`  | `INVALID_ARGUMENT`   | Malformed command or unsupported argument                 |

### Content and artifact repository

`src/lib/content/repository.ts` separates editorial reads from worker-only writes. Database rows and
JSON artifacts are validated with Zod before they cross the repository boundary.

Artifact appends use optimistic version allocation:

1. read the latest version for the job (and image slot where relevant);
2. compare it with `expectedLatestVersion`;
3. insert exactly the next version;
4. translate a concurrent unique-key race into `ArtifactVersionConflictError`.

Callers reload and deliberately retry after a conflict. They never update an earlier artifact.

The event writer accepts only non-transition events (both statuses equal or absent). Status-changing
events remain exclusively owned by the database transition functions, which update the job and append
the event in one transaction.

## Validation contracts

`src/lib/validation/artifacts.ts` defines strict, versioned schemas for normalized research, drafts,
audits, and image metadata. Notable cross-field checks include:

- claim evidence must reference a source in the same research packet;
- source and claim keys, and image slots, are unique;
- slot 0 is the hero image and other slots are supporting images;
- ready images have alt text, a private object path, and a supported MIME type;
- non-pass audits contain at least one actionable finding.

Schema versions are stored with artifacts. A breaking schema change creates a new version constant and
an explicit compatibility path; it does not reinterpret historical rows.

## Verification

- Unit tests exercise all 99 allowed status pairs and all 385 rejected pairs.
- Unit tests cover stage mapping, pause normalization, retry destinations, stale locks, schema
  cross-references, audit findings, and artifact-version conflicts.
- Integration tests compare the complete TypeScript map to `private.job_transitions`, use real admin
  and worker clients through an optimistic lifecycle, and validate repository reads, event appends, and
  immutable version allocation.
- The existing database suite covers leases, retries, revision limits, manual waits, artifact
  immutability, publication exclusivity, idempotency, and live-verification outcomes.
