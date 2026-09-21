# Windows operator setup

This is the clean-machine path for local development and the production worker. Commands use
PowerShell from the repository root. The worker must run as the same ordinary Windows account that
owns the Codex and Claude subscription sign-ins.

## 1. Install the bootstrap tools

Install Git, Docker Desktop, and a current Node.js LTS runtime. `winget` is one convenient path:

```powershell
winget install --exact --id Git.Git
winget install --exact --id Docker.DockerDesktop
winget install --exact --id OpenJS.NodeJS.LTS
```

Restart the terminal after installation, start Docker Desktop, and install the repository's pnpm
version:

```powershell
npm install --global pnpm@10.32.1
pnpm --version
```

The bootstrap Node only launches pnpm. This workspace pins Node `24.21.0` in
`pnpm-workspace.yaml`, so pnpm downloads and uses that runtime for project scripts without replacing
the system installation.

## 2. Clone and install

```powershell
git clone git@github.com:nobledev89/FTP.git D:\FinTechPulse
Set-Location -LiteralPath D:\FinTechPulse
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm env:check:examples
```

Use the real clone path if it differs. Keep the repository on a local fixed disk; provider CLI
scratch files and package installs should not live in a synchronised cloud folder.

## 3. Configure local web and Supabase

```powershell
pnpm supabase:start
pnpm exec supabase status -o env
Copy-Item .env.example .env.local
```

Use the status output to replace the Supabase URL and publishable-key placeholders in `.env.local`.
Generate a shared revalidation secret:

```powershell
pnpm node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Put that value in `.env.local`, then validate and start the web app:

```powershell
pnpm env:check:web
pnpm dev
```

Open `http://localhost:3000`. Create the first local admin through Studio and
`private.bootstrap_first_owner` as described in [SUPABASE.md](SUPABASE.md).

## 4. Configure the worker

```powershell
Copy-Item local-worker/.env.example local-worker/.env.local
```

Fill the five required values. For local use, get the service-role value from
`pnpm exec supabase status -o env`; for production, use the hosted project's service-role secret.
`PUBLIC_SITE_URL` and `REVALIDATION_SECRET` must match the web environment exactly.

```powershell
pnpm env:check:worker
pnpm env:check
pnpm worker:status
pnpm worker:once
```

The combined check catches a worker pointed at a different site or Supabase project. Restrict
`local-worker/.env.local` to the operator's Windows account and exclude it from backups, screenshots,
support bundles, and cloud sync. It is already git-ignored.

## 5. Install subscription CLIs when those modes are used

Mock and manual modes need no provider CLI or API key. For subscription modes, install both CLIs as
the same Windows user that will run the worker:

```powershell
npm install --global @anthropic-ai/claude-code @openai/codex
claude auth login
codex login
```

Choose the Claude subscription and **Sign in with ChatGPT** for Codex. Do not use API-key sign-in;
the worker refuses it to prevent silent per-request billing. Confirm readiness:

```powershell
claude auth status
codex login status
pnpm worker:status
```

For an unattended Claude worker, `claude setup-token` may be stored as
`CLAUDE_CODE_OAUTH_TOKEN` in `local-worker/.env.local`. Full isolation, accepted auth methods, model
overrides, and upgrade checks are in [PROVIDERS.md](PROVIDERS.md).

## 6. Run unattended

Use only one operating model:

- Hermes invokes `pnpm worker:once` every minute and alerts on a non-zero exit; or
- Hermes supervises the long-running `pnpm worker:start`; or
- Windows Task Scheduler invokes `worker:once` with **Do not start a new instance**.

The exact command, exit codes, shutdown expectations, and recovery drill are in
[HERMES.md](HERMES.md). Disable sleep while the machine is expected to publish, allow normal process
termination before force-kill, and do not run the task with administrator privileges.

## Routine upgrade

```powershell
git status --short
git pull --ff-only
pnpm install --frozen-lockfile
pnpm env:check
pnpm typecheck
pnpm test
pnpm worker:status
```

Stop the daemon before pulling. After a Codex or Claude upgrade, repeat the capability and sign-in
checks in [PROVIDERS.md](PROVIDERS.md#when-a-cli-updates) before enabling the scheduler.

## Common Windows failures

- **Docker command fails:** start Docker Desktop and wait until its engine reports ready before
  `pnpm supabase:start`.
- **PowerShell blocks a global `.ps1` shim:** use the corresponding `.cmd` command (for example
  `pnpm.cmd`) or fix the user's approved execution policy; do not disable machine security controls.
- **A scheduled CLI mode says signed out:** the task is running as a different Windows account or
  that account's token expired. Sign in as the scheduled account and rerun `pnpm worker:status`.
- **The worker is offline after sleep/restart:** start it manually, inspect `worker:status`, and let
  lease recovery requeue expired work. Never edit lease columns directly.
- **The environment check prints a variable name:** correct that variable in the named local file.
  The validator never prints credential values.
