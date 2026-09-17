# ADR 0002: Supabase queue with leases and optimistic locking

- Status: Accepted
- Date: 2026-09-17

## Context

The worker runs on a personal Windows PC that can sleep, crash, or restart mid-stage. Two worker
processes may run at once, for example a Hermes-triggered `worker:once` overlapping the daemon. The
admin dashboard can edit a job while the worker is processing it. No inbound connection to the PC is
allowed, and a separate queue service would add one more thing to operate.

## Decision

- Postgres in Supabase is the queue. `article_jobs` stores the status, lease owner, lease token, lease
  expiry, attempt counters, and an optimistic `lock_version`.
- `claim_next_job(worker_id, lease_seconds)` does the following in one transaction: selects one
  eligible job with `FOR UPDATE SKIP LOCKED`, moves it to its active status, writes a random lease
  token, increments `lock_version`, and appends a claim event.
- Only the matching worker ID and lease token can renew or complete a claimed stage.
- A recovery function returns expired active work to the stage's pending status and records the
  abandoned attempt.
- Every status change goes through a single transition function. It takes the expected status and
  `lock_version`, rejects stale or invalid moves, and appends to `job_events`.
- Manual provider stages hold no lease while waiting for operator input.

## Consequences

- Correctness does not depend on the worker process behaving well; the database enforces it.
- Completion must be idempotent: artifact writes check for an existing version before inserting.
- Queue throughput is bounded by the polling interval, which is acceptable at editorial volume.
