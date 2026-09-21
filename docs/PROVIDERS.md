# Providers

Every provider stage (research, draft, revision, images, audit) runs in the mode snapshotted on the
job when it was created. Changing a publication default affects new jobs only. The worker never
substitutes one mode for another: a stage whose provider is unavailable goes to an editor, and a
free mode never silently becomes a billable one (plan section 2, decision 6).

## Modes

| Stage              | Implemented modes                                       | Version 1 default |
| ------------------ | ------------------------------------------------------- | ----------------- |
| Research           | `mock`, `manual_chatgpt`, `codex_cli`, `openai_api`     | `manual_chatgpt`  |
| Draft and revision | `mock`, `manual_claude`, `claude_code`, `anthropic_api` | `claude_code`     |
| Images             | `mock`, `manual_gemini`, `codex_image`, `gemini_api`    | `manual_gemini`   |
| Audit              | `mock`, `manual_chatgpt`, `codex_cli`, `openai_api`     | `manual_chatgpt`  |
| Publish and verify | `internal` (deterministic services, no provider)        | `internal`        |

All modes share one contract (`local-worker/src/providers/contract.ts`). A stage adapter prepares
the prompt from the active prompt template, executes, and normalizes the result through the same
Zod artifact schema. Mock, manual, and CLI modes therefore produce identical artifacts, and every
prompt snapshot, provider run, and artifact version is kept.

- **Mock** is deterministic and free; see [LOCAL-WORKER.md](LOCAL-WORKER.md) for its keyword controls.
- **Manual** modes prepare the prompt and wait for an editor to paste or upload the result in the
  console; see [ADMIN-CONSOLE.md](ADMIN-CONSOLE.md).
- **Subscription CLI** modes run Claude Code or Codex on the worker PC, as described below.
- **API** modes make metered requests from the worker PC only, after the cost confirmation and key
  checks described below.

## ChatGPT images through Codex (`codex_image`)

`codex_image` generates each image brief with Codex's built-in image tool on the worker PC's ChatGPT
subscription: no API key, no per-image bill, and no visible watermark. It runs the same signed-in
Codex as `codex_cli` (read-only sandbox, `--ephemeral`, `--ignore-user-config`, web search off) and
prompts it with the reviewed `image-brief` template plus an instruction to generate exactly one
image and reply `DONE`.

`codex exec` cannot name an output file, and the read-only sandbox stops the agent copying one, so
the worker reads the file Codex itself saves under `<CODEX_HOME>/generated_images/<thread id>/`
(the thread id comes from the first JSONL event and is checked as a UUID) and then deletes that
folder. The bytes' real type, size, dimensions, and SHA-256 are recorded; alt text and aspect ratio
come from the approved draft's brief, as for `gemini_api`. An image whose shape is more than 6% off
the brief's aspect ratio (Codex renders 16:9 as 1672×941) is rejected as invalid output. One image
takes about 60–90 seconds. Checked against codex-cli 0.146.0 on 2026-09-21.

## Optional metered APIs

| Mode            | Provider API           | Stages          | Default model            |
| --------------- | ---------------------- | --------------- | ------------------------ |
| `openai_api`    | OpenAI Responses       | research, audit | `gpt-5`                  |
| `anthropic_api` | Anthropic Messages     | draft, revision | `claude-sonnet-5`        |
| `gemini_api`    | Gemini generateContent | images          | `gemini-3.1-flash-image` |

API credentials live only in `local-worker/.env.local`; they are never stored in Supabase, sent to
Vercel, or passed to a subscription CLI. Add only the keys for modes you intend to enable:

```dotenv
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
```

Then restart the worker and select the API mode on **Providers**. The form shows a metered-cost
warning and will not submit until an editor checks the confirmation. The database records who
confirmed and when. Switching back to a free mode clears that confirmation. New article jobs can
use a billable mode only while that exact stage default is enabled and confirmed.

The optional model overrides are `OPENAI_API_MODEL`, `ANTHROPIC_API_MODEL`, and
`GEMINI_IMAGE_MODEL`. `API_TIMEOUT_MS` defaults to five minutes per request and
`API_MAX_RESPONSE_BYTES` defaults to 16 MB. Gemini makes one request per requested image slot.

Research gives OpenAI's API web search; audit gets no web tool. Anthropic receives no tools and
writes only from the prompt's research packet. Every text response is constrained by the JSON
Schema projected from the shared Zod artifact contract, then validated by the full contract before
storage. Gemini bytes are capped at 10 MiB per image, checked for a supported PNG/JPEG/WebP header,
hashed, and passed to the same private image store used by other modes.

Successful API runs store the provider, resolved model, response ID, and token/cache/tool counts
exposed by the response in `provider_runs.usage`, with `billing: "metered_api"`. The application
does not estimate money from mutable list prices, so `cost_amount` stays empty; use the provider's
own account budget and billing dashboard as the monetary authority.

Authentication or exhausted-credit failures go to an editor; rate limits and transient network or
5xx errors use the existing bounded retry policy; invalid JSON, refusals, and schema failures need
human review. There is no automatic fallback in any direction.

## Subscription CLIs

| Mode          | CLI         | Stages          | Sign-in accepted                                   |
| ------------- | ----------- | --------------- | -------------------------------------------------- |
| `claude_code` | Claude Code | draft, revision | Claude subscription (`claude.ai` or `setup-token`) |
| `codex_cli`   | Codex       | research, audit | ChatGPT (`codex login`, Sign in with ChatGPT)      |

Checked against Claude Code `2.1.275` and codex-cli `0.146.0` on 2026-09-18.

### Setup on the worker PC

1. Install both CLIs for the Windows user that runs the worker, for example
   `npm install -g @anthropic-ai/claude-code @openai/codex`.
2. Sign in with the subscription accounts, in that user's PowerShell:
   - `claude auth login` with the Claude subscription account. For an unattended PC,
     `claude setup-token` creates a long-lived subscription token; put it in the worker's
     `local-worker/.env.local` as `CLAUDE_CODE_OAUTH_TOKEN`.
   - `codex login` and choose **Sign in with ChatGPT**.
3. Check both with `claude auth status` (`"loggedIn": true`, `"authMethod": "claude.ai"`) and
   `codex login status` (`Logged in using ChatGPT`).
4. Run `pnpm worker:status`. Its `providers` section must show both CLIs with `"ready": true`. The
   console's **Providers** page shows the same state from the worker's heartbeat.
5. Select the modes: per job on **New article**, or as publication defaults on **Providers**.

Optional worker variables (`local-worker/.env.local`):

| Variable                 | Default       | Purpose                                                            |
| ------------------------ | ------------- | ------------------------------------------------------------------ |
| `CLAUDE_BIN`             | `claude`      | Command on PATH, absolute `.exe` path, or `.js`/`.mjs` entry point |
| `CODEX_BIN`              | `codex`       | As above                                                           |
| `CLAUDE_MODEL`           | CLI default   | `--model` for Claude Code, such as `opus` or `sonnet`              |
| `CODEX_MODEL`            | CLI default   | `--model` for Codex                                                |
| `CODEX_REASONING_EFFORT` | model default | `minimal`, `low`, `medium`, `high`, or `xhigh`                     |
| `CLI_TIMEOUT_MS`         | `1200000`     | Longest one CLI stage may run before it is killed and retried      |

### What a run does

Immediately before sending a prompt, the worker probes the CLI: `--version`, its help text for every
option the adapter relies on (cached per version), and its offline sign-in report. The probe never
contacts the model. A missing, outdated, signed-out, or billable CLI is reported before any usage is
spent.

Claude Code runs as:

```text
claude -p --output-format json --json-schema <schema> --tools "" --system-prompt <editorial text>
  --no-session-persistence --setting-sources "" --strict-mcp-config --safe-mode
  --permission-mode dontAsk [--model <CLAUDE_MODEL>]
```

Codex runs as:

```text
codex exec --ignore-user-config --strict-config --ignore-rules --ephemeral --skip-git-repo-check
  --sandbox read-only --color never --json --cd <empty directory> --output-schema <file>
  --output-last-message <file> -c web_search="live" | "disabled"
  [--model <CODEX_MODEL>] [-c model_reasoning_effort="<effort>"] -
```

In both cases the prompt is the exact text snapshotted on the provider run, sent on stdin.

### Isolation

- **No shell.** On Windows, npm installs each CLI as a `.cmd` shim. The worker reads the shim and
  runs its target directly (Claude Code's `claude.exe`; Codex's `codex.js` under the worker's own
  Node), so no argument is ever re-parsed by `cmd.exe`. A batch file it cannot map is refused.
- **Allowlisted environment.** The worker's own environment holds the Supabase service-role key.
  A CLI receives a fresh environment containing only what Windows and the CLI need: system and
  profile paths, locale, proxy settings, and its own sign-in location (`CLAUDE_CONFIG_DIR` and
  `CLAUDE_CODE_OAUTH_TOKEN`, or `CODEX_HOME`). `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `CODEX_API_KEY`, and every Supabase or revalidation secret are never passed.
- **No project or personal configuration.** Each run starts in a fresh empty temporary directory,
  removed afterwards. Claude Code runs with no tools and without the owner's CLAUDE.md files, hooks,
  plugins, skills, or MCP servers. Codex ignores the owner's `config.toml` (notify hooks, MCP servers,
  trusted projects) and runs read-only. Neither persists a session.
- **Bounded.** Each stream is capped at 8 MiB and each run at `CLI_TIMEOUT_MS`. On timeout,
  shutdown, or a lost lease the whole process tree is killed (`taskkill /T` on Windows), because
  Codex's Node entry point starts a native child that would otherwise keep running.
- **Web access.** Research gets Codex's live web search, because it must cite real, current sources.
  The audit judges the draft against the research packet and gets no web access. Claude Code writes
  only from the packet and has no tools at all.

### Structured output

The CLI receives a JSON Schema projected from the Zod artifact schema: types, properties, enums, and
nullability, with every property required and no additional properties, which is what OpenAI's
strict structured outputs accept. Length limits, patterns, and cross-field rules are enforced
afterwards by the Zod schema itself. The only local repair is taking the outermost JSON object when
the reply wraps it in a fence or prose. Output that still fails the schema is not retried
automatically; it goes to an editor as `invalid_output` with the failing fields in the message.

### Failures

| What happened                                          | Class              | Outcome                                           |
| ------------------------------------------------------ | ------------------ | ------------------------------------------------- |
| CLI not installed, signed out, or its sign-in expired  | `auth`             | `NEEDS_HUMAN`, action "CLI sign-in needed"        |
| CLI signed in with an API key or a cloud provider      | `auth`             | `NEEDS_HUMAN`; the run is refused before a prompt |
| Subscription usage limit reached                       | `usage_limit`      | `NEEDS_HUMAN`, action "Provider usage limit"      |
| Rate limited or overloaded                             | `rate_limit`       | Retried with longer backoff                       |
| Timeout, network error, provider 5xx                   | `transient`        | Retried with backoff up to the attempt limit      |
| Reply missing, not JSON, or failing the schema; >8 MiB | `invalid_output`   | `NEEDS_HUMAN`, action "Invalid provider output"   |
| CLI too old or too new (a required option is missing)  | `permanent_config` | `FAILED`                                          |

The console shows the worker's message, which names the command to run. After fixing the cause —
signing in, waiting for the limit to reset, updating the CLI — resolve or retry the stage from the
article page. Nothing in this table ever moves a stage to another provider or to an API.

Each successful CLI run records usage on its provider run: CLI and version, token counts, turns, and
for Codex the number of web searches. `billing` is `subscription` and the run's cost columns stay
empty. Claude Code's own list-price figure is kept as `list_price_estimate_usd` for comparison only;
a subscription run is not billed per request.

### When a CLI updates

The adapter depends on the options named above and on the output shapes recorded in
`local-worker/src/providers/cli/interpret.test.ts`. After updating either CLI:

1. Run `pnpm worker:status` and confirm both CLIs report `"ready": true`. A removed or renamed option
   shows here as "update needed" before any job is affected.
2. Run one low-stakes job with the CLI modes and inspect its provider runs in the console.
3. If an output shape changed, capture a new sample, update the fixture and parser, and record the
   version checked at the top of this section.
