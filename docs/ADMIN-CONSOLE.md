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
| `/admin/providers`        | The mode each stage runs in, what it costs, and which workers have reported in                     |
| `/admin/logs`             | Provider runs, publishing and verification, and job events, filterable and paginated               |
| `/admin/settings`         | Publication identity, editorial and SEO defaults, worker thresholds                                |

Tables and timelines page on the server. A filtered view is a URL, so it can be shared and
bookmarked, and no screen loads an entire history into the browser.

## Article controls

The controls offered depend on the job's status, and mirror what `admin_transition_job` will accept:

| Status               | Controls                                        |
| -------------------- | ----------------------------------------------- |
| `IDEA`               | Start research, pause, mark needs human         |
| Any other pausable   | Pause, mark needs human                         |
| `APPROVED`           | Schedule publication, pause, mark needs human   |
| `PAUSED`             | Resume                                          |
| `FAILED`             | Retry the failed stage                          |
| `NEEDS_HUMAN`        | Resolve to an explicit destination, with a note |
| Running or published | None: the worker owns the outcome               |

Approval is a resolution: an escalated job is resolved to `APPROVED`, which the database allows only
after an audit, and only when the latest valid draft carries the latest audit.

Every action carries the `lock_version` the page was rendered with. If someone else acted in between,
the action is refused with "This job changed since the page was loaded" rather than overwriting their
work. Escalating and resolving both require a note, which is recorded on the timeline.

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

## Not in this phase

- **Editing a draft** (`/admin/articles/[jobId]/edit`) needs `drafts.origin = 'admin_edit'` writes,
  which arrive with the mock pipeline in Phase 6.
- **Activating or rolling back a prompt version** arrives in Phase 6, which is what seeds the
  templates in the first place.
- **Changing a stage's provider mode** arrives with the adapters that make the alternatives real,
  Phases 8 to 10. A new job can already override the mode for its own run.
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
