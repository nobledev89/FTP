# Deployment and release runbook

This runbook takes one reviewed commit from a clean checkout to hosted Supabase, a Vercel preview,
the production apex domain, and the Windows worker. It deliberately keeps the worker and every
service/API credential off Vercel.

The release order is Supabase, Vercel preview, DNS, production smoke tests, then the worker. Do not
start a production worker against a database whose migrations or web deployment are incomplete.

## Release inputs

Before changing hosted services, have all of the following:

- owner access to the GitHub repository, Supabase project, Vercel project, and Cloudflare zone;
- the exact commit SHA being released and a successful GitHub Actions run for that SHA;
- a Windows worker prepared from [WINDOWS-SETUP.md](WINDOWS-SETUP.md);
- one 32-byte-or-longer random revalidation secret, stored in the web and worker secret stores;
- the hosted Supabase project URL, publishable key, and service-role secret;
- a rollback owner and a maintenance window for the first production release.

Generate the shared secret locally without copying it into shell history:

```powershell
pnpm node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 1. Preflight the release commit

From a clean checkout of the exact release SHA:

```powershell
pnpm install --frozen-lockfile
pnpm env:check:examples
pnpm prompts:seed --check
pnpm contracts:sync --check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The database and browser suites require Docker and the local Supabase stack:

```powershell
pnpm supabase:start
pnpm supabase:reset
pnpm db:lint
pnpm test:integration
pnpm test:e2e
pnpm test:e2e:admin
pnpm supabase:stop
```

Do not release from an uncommitted worktree. Generated prompt SQL, worker contracts, and database
types must show no diff after their checks.

## 2. Provision hosted Supabase

Follow [SUPABASE.md](SUPABASE.md#hosted-project-setup) for the complete authentication and owner
bootstrap. The deploy sequence is:

```powershell
pnpm exec supabase login
pnpm exec supabase link --project-ref <project-ref>
pnpm exec supabase db push --dry-run
pnpm exec supabase db push --include-seed
```

Review the dry run before applying it. `db push` records migration history and skips migrations
already applied; production migrations are forward-only, so fix a bad migration with a new one
instead of editing an applied file.

Before proceeding, confirm:

- email sign-in is enabled, public sign-up is disabled, and the minimum password length is 12;
- the Auth site URL is `https://fintechpulse.co.uk` and the permitted redirect list contains local
  development and the preview URL being tested;
- `article-work` is private and `article-public` is public;
- the first owner can sign in and a non-member cannot enter `/admin`;
- the publishable key is available for Vercel, while the service-role secret is stored only on the
  worker PC.

Supabase documents `link`, dry-run, and `db push --include-seed` in its
[CLI reference](https://supabase.com/docs/reference/cli/supabase-db-push).

## 3. Configure Vercel

Import `nobledev89/FTP` as one project. Use the repository root as the Root Directory, `main` as the
production branch, and the detected Next.js framework preset. Do not create a second Vercel project
for `local-worker`; that package is a Windows process, not a deployment.

Add exactly these application variables to Preview and Production:

| Variable                               | Production value                              |
| -------------------------------------- | --------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                 | `https://fintechpulse.co.uk`                  |
| `NEXT_PUBLIC_SUPABASE_URL`             | Hosted project URL                            |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Hosted publishable key                        |
| `REVALIDATION_SECRET`                  | Same random secret used by the Windows worker |

Never add `SUPABASE_SERVICE_ROLE_KEY`, an AI provider key, or a subscription CLI credential to
Vercel. The server uses the publishable key and RLS; the worker owns privileged writes.

Create a non-production branch deployment first. Check its build log, then smoke test:

- `/`, `/blog`, `/feed.xml`, `/sitemap.xml`, and `/robots.txt` return successfully;
- an unpublished slug returns 404 and no draft text is present in public HTML;
- `/admin` redirects to login, the owner can sign in, and a non-member reaches only no-access;
- `/design-review` is available in Preview and responsive at 375, 768, 1024, and 1440 px;
- the browser console and Vercel function logs contain no secrets or unhandled errors.

Vercel creates previews for branch/PR pushes and production deployments from the configured
production branch; see its [Git deployment guide](https://vercel.com/docs/git).

## 4. Add the production domains through Cloudflare DNS

Add both `fintechpulse.co.uk` and `www.fintechpulse.co.uk` to the Vercel project before editing DNS.
Keep the project decision that the apex is canonical and configure `www` as a redirect to it. The
application also has a host redirect as defence in depth.

In Cloudflare, create the exact records Vercel currently displays for those domains. Do not copy an
IP address or CNAME from a tutorial: Vercel may provide account- or project-specific targets. Remove
only records that conflict on the same host, and preserve mail and verification records.

Set the new web records to **DNS only** (grey cloud) while Vercel verifies ownership and provisions
TLS. Verification TXT records are always DNS-only. Cloudflare explains the distinction in its
[proxy-status guide](https://developers.cloudflare.com/dns/proxy-status/), and Vercel documents the
domain/redirect flow in [Deploying and Redirecting Domains](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting).

Validate from PowerShell:

```powershell
Resolve-DnsName fintechpulse.co.uk
Resolve-DnsName www.fintechpulse.co.uk
(Invoke-WebRequest https://fintechpulse.co.uk/ -MaximumRedirection 0).StatusCode
(Invoke-WebRequest https://www.fintechpulse.co.uk/ -MaximumRedirection 0 -SkipHttpErrorCheck).StatusCode
```

The apex must serve a valid certificate and `www` must redirect permanently to the apex without a
loop. Leave Cloudflare proxying off through initial release QA. Enabling it later is a separate
change: repeat TLS, redirects, caching, signed revalidation, upload, and live-verification tests.

## 5. Release and prove the production path

Release the reviewed commit to the Vercel production environment. Record the deployment ID, commit
SHA, start/end time, and operator in the release log. Then check:

```powershell
$Origin = "https://fintechpulse.co.uk"
Invoke-WebRequest "$Origin/"
Invoke-WebRequest "$Origin/blog"
Invoke-WebRequest "$Origin/feed.xml"
Invoke-WebRequest "$Origin/sitemap.xml"
Invoke-WebRequest "$Origin/robots.txt"
Invoke-WebRequest "$Origin/design-review" -SkipHttpErrorCheck
```

The design-review route must be 404 in Vercel Production. Inspect the public page metadata for the
apex canonical URL, Open Graph/Twitter fields, and Article JSON-LD. Confirm the admin remains
`noindex`.

On the worker PC, create and validate `local-worker/.env.local` with the hosted Supabase values and
production origin:

```powershell
pnpm env:check:worker
pnpm worker:status
pnpm worker:once
```

Run one mock article through `VERIFIED`, then one manual article through every handoff. Confirm the
timeline contains provider runs, artifact versions, publication/revalidation logs, and all eight
live checks. Include a manual image above 4.5 MB: its upload request must go directly to Supabase,
the small preflight/finalize actions must stay below Vercel's request limit, and the recorded image
size/hash must come from the server's read-back of the private object. The enforced file limit is
10 MB.

Only after these checks pass should Hermes or Task Scheduler start the recurring worker command.

## Rollback and incident order

1. Stop Hermes/Task Scheduler or gracefully stop `worker:start`; this prevents new claims.
2. Pause affected jobs in the admin. A held lease remains fenced and will recover after expiry.
3. Use Vercel's deployment rollback for an application-only regression.
4. Do not roll the application behind an incompatible database migration. Apply a corrective
   migration and roll forward.
5. If a credential may have leaked, rotate it at the owning provider, update the relevant secret
   store, validate the environments again, and restart/redeploy only the affected process.
6. Re-run the production smoke and mock-publication checks before resuming the scheduler.

Record the incident, affected job IDs, deployment/migration SHAs, credential rotations, and recovery
evidence without copying raw prompts, provider replies, or secret values into the record.
