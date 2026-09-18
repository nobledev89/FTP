# ADR 0007: How the worker runs subscription CLIs

- Status: Accepted
- Date: 2026-09-18

## Context

ADR 0003 requires CLI children to get a minimal environment, a temporary directory, a timeout, and
bounded output, and forbids any silent move to a billable mode. Implementing Claude Code and Codex
on the owner's Windows PC (Phase 9) raised specifics that ADR did not settle:

- npm installs both CLIs as `.cmd` batch shims. Node will not spawn a batch file without a shell,
  and `cmd.exe` re-parses arguments, including the JSON Schema that `claude --json-schema` accepts
  only inline.
- The worker loads `local-worker/.env.local` into its own `process.env`, so an inherited environment
  would hand the Supabase service-role key to a third-party CLI.
- Both CLIs bill per request when signed in with an API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `CODEX_API_KEY`, or a stored key), and a signed-out Codex spends about a minute retrying 401s.
- The owner's own CLI configuration (CLAUDE.md files, hooks, plugins, MCP servers, Codex notify hooks)
  would otherwise run inside every pipeline stage.
- Codex forwards its output schema to OpenAI strict structured outputs, which reject keywords that Zod
  emits.

## Decision

- **No shell, ever.** A configured CLI is resolved to a directly spawnable file: a native executable,
  or a Node script run by the worker's own Node. npm shims are read and mapped to their target; a
  batch file that cannot be mapped is refused. Input goes on stdin; arguments are an argv array.
- **Allowlisted environment.** A child receives a new environment built from an explicit allowlist
  (system, profile, locale, and proxy variables, plus the CLI's own sign-in location). Nothing else
  is inherited. API keys are excluded by construction, not by a denylist.
- **Probe before every prompt.** Version, the options the adapter relies on (cached per version),
  and the CLI's offline sign-in report. Only a subscription sign-in is accepted; an API-key or cloud
  provider sign-in is refused as `auth` before any prompt is sent.
- **Isolated runs.** A fresh empty temporary directory per run, no session persistence, no user
  configuration, no tools for writing, a read-only sandbox for Codex, web search only for research.
  Timeouts, cancellation, and output limits kill the whole process tree.
- **Portable schema, Zod authority.** The CLI receives a structural projection of the Zod schema
  (types, properties, enums, nullability; every property required). The Zod schema then validates the
  result exactly as it validates mock and manual output.
- **Classification maps to the existing queue outcomes.** Missing, signed-out, or billable CLIs are
  `auth`; subscription limits are `usage_limit`; both go to an editor and are never retried or
  redirected. Schema failures are `invalid_output`. Timeouts and 5xx are `transient`.
- **Observed, not connected.** CLI readiness reaches the console only through the worker heartbeat.

## Consequences

- A CLI update that renames or removes a relied-on option shows as "update needed" in
  `worker:status` and the console before any job runs, and a stage that meets it fails as
  `permanent_config` rather than guessing.
- Setting `CLAUDE_BIN` or `CODEX_BIN` to a `.js`/`.mjs` script substitutes a scripted CLI, which the
  test suites use to exercise the real process, environment, and parsing paths without a
  subscription.
- A reply that is valid under the projected schema can still fail the Zod schema (a length, pattern,
  or cross-field rule). That is recorded as `invalid_output` for an editor rather than auto-retried.
