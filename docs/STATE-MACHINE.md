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

### Manual provider waits

`request_manual_action` keeps the current active status, releases the worker lease, connects the job to
a matching `provider_runs` row in `action_required`, and appends an `action.required` event. Import and
continuation arrive in the manual-workflow phase; provider output must pass the shared Zod contract
before persistence.

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
