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

| Route                     | What it is for                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin`                  | The decisions waiting on you, then work in progress, what is scheduled, what is live, and the full list                                                                            |
| `/admin/articles/new`     | Create a job: brief, publication intent, and per-stage provider modes                                                                                                              |
| `/admin/articles/[jobId]` | One article: its state, the decisions available, and the draft as it will read; every artifact version, provider run, publishing log, and the timeline sit under Technical details |
| `/admin/prompts`          | Prompt template versions and a preview of any one of them                                                                                                                          |
| `/admin/providers`        | The mode each stage runs in, what it costs, which workers have reported in, and their CLI sign-ins                                                                                 |
| `/admin/logs`             | Provider runs, publishing and verification, and job events, filterable and paginated                                                                                               |
| `/admin/settings`         | Publication identity, editorial and SEO defaults, worker thresholds                                                                                                                |

Tables and timelines page on the server. A filtered view is a URL, so it can be shared and
bookmarked, and no screen loads an entire history into the browser. The article page's two views
are a URL too: `?view=details` opens Technical details.

## What the statuses are called

The database has 23 job statuses because the queue, the worker, and the audit trail need them. The
console shows an editor six of them, derived from the exact status in
`src/lib/admin/editorial-status.ts`:

| Shown            | Means                                                            | Statuses behind it                                                                  |
| ---------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Needs you        | Nothing moves until you decide or supply something               | `IDEA`, `FAILED`, `NEEDS_HUMAN`, any stage waiting on manual input or a CLI sign-in |
| In progress      | The worker is researching, writing, illustrating, or checking it | The pending and active pipeline statuses, `PUBLISHING`                              |
| Ready to publish | The audit passed and it is waiting for your decision             | `APPROVED` without auto-publish                                                     |
| Scheduled        | It goes live by itself, at its time or on the next poll          | `SCHEDULED`, `APPROVED` with auto-publish                                           |
| Live             | On the site                                                      | `PUBLISHED`, `VERIFIED`                                                             |
| Stopped          | Paused, discarded, or withdrawn                                  | `PAUSED`, `DISCARDED`, a withdrawn article                                          |

Each article also shows where it is along **Research → Write → Image → Check → Publish**, with the
step it stopped at marked when it is paused, failed, escalated, or waiting for a person. The image
step is struck through when the article asked for no image.

The exact status is never hidden: it is the badge's tooltip, and it appears as its database value
under Technical details, on `/admin/logs`, and in the timeline.

## Article controls

Every article page opens with a decision panel: the state in one sentence, the step tracker, and
the decisions that apply now. Reversible actions are buttons; anything that needs a reason or a
time opens its own form under the row, one at a time, so a destructive form is never on screen
until it is asked for. The set comes from `availableControls`, which mirrors what
`admin_transition_job` will accept:

| Status                 | Controls                                                      |
| ---------------------- | ------------------------------------------------------------- |
| `IDEA`                 | Start the article, pause, flag for review, discard            |
| Any other pausable     | Pause, flag for review, discard                               |
| `APPROVED`             | **Publish now**, schedule, pause, flag for review, discard    |
| `SCHEDULED`            | **Publish now**, change time, pause, flag for review, discard |
| `PAUSED`               | Resume, discard                                               |
| `FAILED`               | Try again, discard                                            |
| `NEEDS_HUMAN`          | Choose what happens next, discard                             |
| Running                | None: the worker owns the outcome                             |
| `PUBLISHED`/`VERIFIED` | Withdraw from site, with a reason                             |

"Choose what happens next" is the escalation resolution: the destinations the database allows are
offered in plain words ("Approve it as it is", "Rewrite it using the audit notes") rather than as
status names. A note is optional in the console; when it is left empty the choice itself is
recorded, because the database requires a note. Approval is one of those resolutions, which the
database allows only after an audit, and only when the latest valid draft carries the latest audit.

### Publishing

**Publish now** is the fastest path to a live article, and needs no date typed. For an `APPROVED`
article it schedules publication for `now()`; for a `SCHEDULED` one it moves the time to `now()`
through `admin_reschedule_job`. Either way the worker claims it on its next poll (every
`WORKER_POLL_INTERVAL_MS`, ten seconds by default), publishes, and then verifies the live page, so
"now" means seconds, not instantly. Nothing is published from the browser: the console only sets
the time, and `publish_article` stays the worker's.

**Schedule** takes a wall-clock time in the publication timezone and converts it to an instant. A
time that has passed publishes now; a time more than a year out is refused. A scheduled article can
be moved as often as you like, from its own page or from the dashboard, until the worker claims it.

The same three decisions — Publish now, Schedule, Discard — are on each dashboard card, so a ready
article can be published without opening it.

Every action carries the `lock_version` the page was rendered with. If someone else acted in between,
the action is refused with "This job changed since the page was loaded" rather than overwriting their
work. Escalating requires a note; resolving records the choice when no note is given. Both end up
on the timeline.

### Reading an article

The **Article** view is for reading, not inspecting: the headline, standfirst, hero image, and body
as formatted text, with the version chips when there is more than one draft. Beside it sit **The
check** (the latest audit as a verdict, its summary, and each note with the fix it suggests),
**About this article** (working title, type, category, web address, keywords, byline, where it came
from), and **On the site** once it is published.

The preview follows the admin type system rather than the public stylesheet ([ADR
0004](decisions/0004-public-admin-layout-separation.md)): it shows what the article says, not a
pixel copy of the published page. Provider Markdown is rendered with raw HTML skipped, Markdown
images dropped, and only http(s), root-relative, and fragment links kept, the same rules the public
renderer applies. The hero is read from the private `article-work` bucket through a short-lived
signed URL, so an image can be judged before anything is public.

**Technical details** holds what the console used to show first: state and lease, provider modes,
research packets, sources, raw drafts, audits as stored, images, provider runs, publishing and
verification logs, and the paged timeline.

### Discarding an article

Any article that is not yet published has a **Discard** button in its decision panel, and on its
dashboard card while it is waiting for you. It opens a form with a required reason and a
confirmation tick. The job moves to the terminal `DISCARDED` status; its drafts,
audits, and timeline are kept. A stage that is running must finish (or be paused) first.

### Topic discovery and review

**Settings → Topic discovery** turns automatic article discovery on or off, sets how often the
worker scans (default every 30 minutes), whether discovered articles get a ChatGPT hero image,
whether they publish on their own, and a daily target (0–12) for each of the ten categories. **Scan now** makes the worker's next poll
scan immediately; daily targets still apply. **Recent scans** lists the last ten scans with what
they found, what they created, and any error.

Discovered articles run research, writing, image, and audit unattended on the worker PC and then
wait on the dashboard under **Needs your decision**, with the news story they came from. Read the
draft, then publish it, schedule it, or discard it.

**Publish discovered articles automatically** (off by default) changes that last step: an article
that passes its audit goes live without an editor, appearing under Scheduled and then Live instead
of waiting. It can still be withdrawn afterwards. The setting is copied onto each article when it
is discovered, so turning it off leaves articles already in the pipeline alone, and turning it on
does not release articles that are already waiting.

### Withdrawing an article

An owner or editor can take a live article down with **Withdraw from site** in the decision panel.
It needs a reason (3–500 characters, recorded on the timeline as `article.withdrawn`) and a confirmation tick.
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
