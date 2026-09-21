# Admin console

The authenticated operations application for the publication, at `/admin`. It is a separate route
group with its own root layout, fonts, and stylesheet ([ADR 0004](decisions/0004-public-admin-layout-separation.md)),
shares no component with the public site, and is `noindex` throughout.

Written for whoever operates the publication day to day, and for anyone adding a screen to it.

## Getting in

Sign-in is Supabase email and password. Public sign-up is disabled, so an account exists only
because the owner created it, and access requires an active row in `admin_users`. Creating the first
owner is described in [SUPABASE.md](SUPABASE.md#hosted-project-setup).

A signed-in account with no membership lands on `/admin/no-access`, which names the account and
offers a sign-out. It sees exactly what an anonymous visitor sees.

| Role     | Can do                                                              |
| -------- | ------------------------------------------------------------------- |
| `viewer` | Read every screen. Every control is withdrawn, not merely disabled. |
| `editor` | Create jobs, run workflow actions, save publication settings        |
| `owner`  | Everything an editor can do, plus publication identity              |

## Screens

| Route                     | What it is for                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `/admin`                  | Queue summary, stages, what is waiting on a person, failures, upcoming publications, worker health |
| `/admin/articles/new`     | Create a job: brief, publication intent, and per-stage provider modes                              |
| `/admin/articles/[jobId]` | One job: every artifact version, provider run, publishing log, the full timeline, and the controls |
| `/admin/prompts`          | Prompt template versions and a preview of any one of them                                          |
| `/admin/providers`        | The mode each stage runs in, what it costs, which workers have reported in, and their CLI sign-ins |
| `/admin/logs`             | Provider runs, publishing and verification, and job events, filterable and paginated               |
| `/admin/settings`         | Publication identity, editorial and SEO defaults, worker thresholds                                |

Tables and timelines page on the server. A filtered view is a URL, so it can be shared and
bookmarked, and no screen loads an entire history into the browser.

## Article controls

The controls offered depend on the job's status, and mirror what `admin_transition_job` will accept:

| Status                 | Controls                                        |
| ---------------------- | ----------------------------------------------- |
| `IDEA`                 | Start research, pause, mark needs human         |
| Any other pausable     | Pause, mark needs human                         |
| `APPROVED`             | Schedule publication, pause, mark needs human   |
| `PAUSED`               | Resume                                          |
| `FAILED`               | Retry the failed stage                          |
| `NEEDS_HUMAN`          | Resolve to an explicit destination, with a note |
| Running                | None: the worker owns the outcome               |
| `PUBLISHED`/`VERIFIED` | Withdraw the article, with a reason             |

Approval is a resolution: an escalated job is resolved to `APPROVED`, which the database allows only
after an audit, and only when the latest valid draft carries the latest audit.

Every action carries the `lock_version` the page was rendered with. If someone else acted in between,
the action is refused with "This job changed since the page was loaded" rather than overwriting their
work. Escalating and resolving both require a note, which is recorded on the timeline.

### Withdrawing an article

An owner or editor can take a live article down from the **Published article** panel. It needs a
reason (3–500 characters, recorded on the timeline as `article.withdrawn`) and a confirmation tick.
`admin_withdraw_article` marks the snapshot `withdrawn`, cancels a pending or exhausted verification
so the worker never re-checks it, and refuses while a verification lease is live ("try again in a
minute"). The action then expires the public cache tags, so the article page, its earlier slugs, the
home page, archive, feed, and sitemap drop it on the next request.

Withdrawal is final for that job: the job keeps its `PUBLISHED`/`VERIFIED` history, the slug stays
reserved, and there is no republish control. To correct and republish, create a new job with a new
slug. The published hero copy in the public `article-public` bucket is not deleted; nothing links to
it any more, but its direct URL still resolves.

## What this application cannot do

By design, not by omission:

- **It never writes a table directly.** `authenticated` holds no table write privileges. Every change
  is a `SECURITY DEFINER` function that re-authorizes the caller.
- **It never moves a job outside the state machine.** A trigger rejects direct status, lease, and
  workflow-column edits from every role, including the worker's.
- **It never publishes.** `PUBLISHING → PUBLISHED` happens only inside `publish_article`, which only
  the worker can call.
- **It never talks to the worker PC.** Worker health is read from heartbeat rows. There is no inbound
  connection, so a stale dashboard means a quiet worker, not a broken link.
- **It holds no provider credentials.** Provider runs happen on the worker PC.

## Redaction

Text that originated on the worker PC — provider errors, failure summaries, publishing errors, event
notes and JSON summaries — is redacted before it reaches a browser: credentials, tokens, local file
paths, and email addresses are masked, and long output is truncated. The unredacted text stays in the
database and in the worker's own log. See `src/lib/admin/redact.ts`.

## Prompt versions

`/admin/prompts` lists every immutable version and loads one body only when it is previewed. An
editor or owner can save the preview as a new version, either active or inactive. Activating an
older version is the rollback operation; provider runs keep their original prompt snapshot and
template version. Viewers can inspect versions but cannot create or activate one. The database
serializes version allocation per site/key and re-authorizes every write.

## Manual provider workflows

A stage in a manual mode (`manual_chatgpt`, `manual_claude`, `manual_gemini`) waits on the article
page with no worker lease held. The run panel shows the provider and mode, **Copy prompt**, an
**Open ChatGPT/Claude/Gemini** link, the exact prompt snapshot the worker stored, and an example of the
expected JSON.

- **Research, writing, revision, and audit** take a pasted JSON response (one outer ` ```json `
  fence is accepted). **Validate and continue** checks it against the shared artifact schema; a
  rejected response stays in the text box with the failing paths listed, and nothing is stored.
- **Images** take one upload per requested slot with its alt text (required), caption, and optional
  focal point. An authorized preflight issues a short-lived upload token for that exact live
  job/run/slot, and the browser sends the bytes straight to the private `article-work` bucket. The
  server then reads the stored object back, derives its real type, dimensions, size, and hash from
  the bytes, and records it as `ready`; browser-supplied file facts are never trusted. Uploading a
  replacement creates a new version. **Continue to audit** is enabled once every requested slot is
  ready; files become public only when the publishing service copies approved versions.
- A paused job keeps its prompt on screen but accepts nothing until it is resumed. Escalating a
  waiting job cancels its run; resolving it later prepares a fresh prompt.

Every import is one database transaction that re-checks the editor, stores the versioned artifact,
closes the run, and advances the job, so the history shows the accepted artifact against the prompt
that produced it. `/admin/providers` sets each stage's default for new jobs; only modes with a worker
adapter are offered there and on the new-article form.

## Subscription CLI modes

Claude Code (`claude_code`, writing and revision) and Codex (`codex_cli`, research and audit) run on
the worker PC with its own sign-ins; setup and isolation are in [PROVIDERS.md](PROVIDERS.md). Nothing
waits in the console: the worker runs the stage and moves the job on. The **Subscription CLIs** panel
on `/admin/providers` shows, per worker, whether each CLI is ready, needs signing in, is signed in to
a billable account, is not installed, or needs an update, as of the worker's last probe.

When a CLI cannot run, the job goes to `NEEDS_HUMAN` with the worker's message — for example "CLI
sign-in needed: … Run `claude auth login` …" or "Provider usage limit: … no API was used …". Fix the
cause on the PC, then resolve the job back to the stage's pending status from the article page. The
job keeps its CLI mode; the console never offers to switch it to an API.

## Metered API modes

OpenAI API (`openai_api`) serves research and audit, Anthropic API (`anthropic_api`) serves writing
and revision, and Gemini API (`gemini_api`) serves images. Selecting one on `/admin/providers`
reveals a billing warning and a required confirmation checkbox. The server action and database both
enforce that confirmation and record the editor and time. Selecting a free mode again clears it.
The new-article form offers an API choice only when that exact stage default remains confirmed.

Credentials stay on the worker PC. If the current setting requires a key that is absent, worker
startup exits with configuration code 2; if a running worker encounters a newly selected mode
without its key, the job stops for an editor. Successful runs show their provider usage metadata in
the existing run history. See [PROVIDERS.md](PROVIDERS.md) for setup and retry behaviour.

## Not in this phase

- **Editing a draft** (`/admin/articles/[jobId]/edit`) needs `drafts.origin = 'admin_edit'` writes,
  plus an atomic decision about invalidating images and forcing re-audit. It stays deferred rather
  than inserting an unconstrained version that an old approval could accidentally publish; a
  correction today goes through escalation and a revision or a fresh manual draft.
- **Managing memberships** is a SQL-editor task in version 1.

## Adding a screen

1. Call `requireAdminSession()` in the page. No layout does it for you: a layout does not control
   whether nested segments render ([ADR 0006](decisions/0006-admin-authentication-boundary.md)).
2. Read through a module in `src/lib/admin/`, selecting explicit columns and validating the result
   with Zod, so a later migration cannot silently widen the payload.
3. For a mutation, add the database function first, then a Server Action that calls
   `authorizeAdminAction()` before it validates its input.
4. Add the route to `adminNavigation` in `src/components/admin/admin-shell.tsx` if it belongs in the
   sidebar, and to the signed-out list in `tests/e2e/admin-auth.spec.ts` either way.
