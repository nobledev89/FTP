# Hermes and Windows scheduling

Hermes integrates with FinTechPulse through shell commands and exit codes. There is no Hermes SDK
dependency and nothing listens for inbound connections on the worker PC.

Prepare the machine and validate its environment first with
[WINDOWS-SETUP.md](WINDOWS-SETUP.md). Do not schedule the worker until `pnpm env:check:worker` and
`pnpm worker:status` both succeed under the same Windows account Hermes will use.

## Recommended command

For periodic scheduling, run this command from the repository root:

```powershell
pnpm worker:once
```

Run it every minute initially and configure Hermes not to overlap invocations. Overlap is still safe
because Postgres claims with `FOR UPDATE SKIP LOCKED`, but avoiding redundant processes makes logs and
heartbeats clearer. Exit `0` means the cycle completed, including the normal case where no job was
eligible. Alert on `1` or `2` and use `pnpm worker:status` for diagnosis.

For a monitored long-running process, Hermes may instead launch:

```powershell
pnpm worker:start
```

Hermes should request a normal process termination before force-killing it and allow at least
`WORKER_SHUTDOWN_TIMEOUT_MS`. The daemon stops accepting claims, aborts active work, releases the
lease into retry backoff where possible, writes a final heartbeat, and exits.

## Health command

```powershell
pnpm worker:status
```

This is read-only. Exit `0` means the configured worker heartbeat is online. Exit `3` means the
worker has never heartbeated or is stale/offline; the emitted JSON includes queue and heartbeat
details. Exit `1` means the status query itself failed, and `2` means local configuration is invalid.

## Windows Task Scheduler alternative

If Hermes is unavailable, create a task with these conservative settings:

- Trigger: every minute, indefinitely.
- Program: `pwsh.exe` (or `powershell.exe` on Windows PowerShell 5.1).
- Arguments:

  ```text
  -NoProfile -NonInteractive -Command "Set-Location -LiteralPath 'D:\FinTechPulse'; pnpm worker:once"
  ```

- Start in: `D:\FinTechPulse`.
- If the task is already running: **Do not start a new instance**.
- Run as the normal owner account; do not enable **Run with highest privileges**.
- Replace Task Scheduler's broad default execution limit with an explicit operational ceiling that
  is longer than every configured stage timeout and the shutdown allowance.
- Keep `local-worker/.env.local` readable only by that account.

Use the real repository location if it differs. Subscription CLI modes added in Phase 9 will also
require the scheduled account to own the corresponding CLI login; a different service account does
not inherit interactive Codex or Claude authentication.

Task Scheduler captures exit status but not durable logs by itself. Redirecting output to a local
file is optional; if enabled, secure and rotate it because operational metadata is still sensitive
even after automatic redaction.

## Recovery drill

1. Start a test job and let a worker claim it.
2. Terminate that worker without graceful shutdown.
3. Confirm `pnpm worker:status` reports a lease, then an expired lease after the configured duration.
4. Run `pnpm worker:once` or restart the daemon.
5. Confirm the `lease.expired` event exists and another worker can claim the pending stage with a new
   token and incremented attempt.

The old token is permanently fenced off. If the killed process resumes, its completion call receives
`FT003` and cannot duplicate the transition.
