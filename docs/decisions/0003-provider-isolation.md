# ADR 0003: Provider adapters are isolated from publishing

- Status: Accepted
- Date: 2026-09-17

## Context

Each stage can run in `mock`, `manual`, `subscription_cli`, or `api` mode. Subscription CLIs and APIs
return untrusted text. Their flags and failure modes change over time, and some modes cost money. The
platform must never publish content that has not passed the audit gate. It must also never switch
silently from a free mode to a billable one.

## Decision

- Each stage adapter implements `prepare`, `execute`, and `normalize`, and returns typed data only.
- Adapters receive no database client, Storage client, or publishing capability. The stage service
  persists validated output.
- Only the publishing service may call the publication RPC, which is the only path to `PUBLISHED`.
- Provider selection is set per stage and snapshotted into every `provider_runs` row.
- API mode is opt-in per stage. There is no automatic fallback between modes. When a usage limit is
  hit or a subscription login expires, the job moves to a human-action state.
- CLI child processes get a minimal environment (no project secrets, and no API keys in CLI modes), a
  temporary working directory, a timeout, and bounded output.

## Consequences

- Switching a stage between modes changes configuration only; stage services, schemas, and the state
  machine are shared.
- Tests must prove that adapters cannot reach the publishing boundary (Phase 11).
