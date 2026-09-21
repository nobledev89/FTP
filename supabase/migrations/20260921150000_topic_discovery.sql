-- Topic discovery.
--
-- Every discovery interval the local worker searches recent news for the categories that still owe
-- articles today, and turns each chosen story into a normal article job that runs research,
-- writing, images, and audit on the subscription providers. Discovered jobs never auto-publish:
-- they stop at APPROVED for an editor to schedule or discard.
--
-- Quotas are per category per publication day (Europe/London by default), paced through the day:
-- a category with a target of N may have created ceil(N * elapsed-fraction-of-day) jobs so far,
-- so two articles a day arrive roughly one in each half of the day rather than both at 00:30.
-- The database decides what is due and enforces the quota under a row lock; the worker only
-- proposes stories.

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

create table public.topic_categories (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  guidance text not null check (char_length(btrim(guidance)) between 1 and 1000),
  daily_target smallint not null default 0 check (daily_target between 0 and 12),
  sort_order smallint not null default 0,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, slug)
);

comment on table public.topic_categories is
  'Editorial categories for topic discovery, with a per-day article target (0 = off).';

create trigger topic_categories_set_updated_at
  before update on public.topic_categories
  for each row execute function private.set_updated_at();

-- The ten launch categories, for every publication that already exists. seed.sql inserts the same
-- rows on a fresh database, where the site does not exist yet when migrations run.
insert into public.topic_categories (site_id, slug, name, guidance, sort_order)
select s.id, c.slug, c.name, c.guidance, c.sort_order
from public.sites s
cross join (values
  (1, 'fintech-news', 'Fintech News',
   'Company news from Revolut, Monzo, Wise, Stripe, Klarna, PayPal, Adyen, Starling and other fintechs active in the UK: launches, results, funding, licences, leadership changes, and regulatory action.'),
  (2, 'ai-finance', 'AI & Finance',
   'AI advisers, agentic AI, AI trading tools, bank automation, and how financial institutions use AI in fraud, credit, compliance, and risk management.'),
  (3, 'payments', 'Payments',
   'Apple Pay, Google Pay, QR and instant payments, cross-border payments, payment APIs, merchant tools, and payment infrastructure.'),
  (4, 'open-banking', 'Open Banking',
   'UK open banking and open finance: APIs, variable recurring payments, bank connectivity, and the regulatory roadmap.'),
  (5, 'digital-banks', 'Digital Banks',
   'Revolut, Monzo, Starling, Chase UK, Kroo, bunq, N26, and other digital banks serving UK customers.'),
  (6, 'crypto-tokenisation', 'Crypto, Stablecoins & Tokenisation',
   'The financial and business side only: stablecoins, tokenised deposits and assets, institutional adoption, and UK regulation. Never crypto-price speculation.'),
  (7, 'fraud-security', 'Fraud & Cybersecurity',
   'Scams, APP fraud and reimbursement, AI-powered fraud, data breaches, AML, and identity verification.'),
  (8, 'business-fintech', 'Fintech for Business',
   'Payment processors, accounting fintech, expense cards, business banking, payroll, and embedded finance.'),
  (9, 'explainers', 'Explainers & Guides',
   'Evergreen explainers and guides that stay useful for years, prompted by a current development but written to last.'),
  (10, 'uk-fintech', 'UK Fintech',
   'The UK fintech sector itself: FCA, Bank of England, and Treasury decisions, investment, listings, and the London ecosystem.')
) as c (sort_order, slug, name, guidance)
on conflict (site_id, slug) do nothing;

-- ---------------------------------------------------------------------------
-- Settings and job provenance
-- ---------------------------------------------------------------------------

alter table public.site_settings
  add column discovery_enabled boolean not null default false,
  add column discovery_interval_minutes smallint not null default 30
    check (discovery_interval_minutes between 15 and 720),
  add column discovery_image_count smallint not null default 1
    check (discovery_image_count between 0 and 1),
  add column discovery_last_started_at timestamptz;

alter table public.article_jobs
  add column origin text not null default 'editor' check (origin in ('editor', 'discovery')),
  add column topic_category_id uuid references public.topic_categories (id) on delete restrict,
  add column discovery_source jsonb
    check (discovery_source is null or jsonb_typeof(discovery_source) = 'object'),
  add constraint article_jobs_discovery_provenance
    check ((origin = 'discovery') = (topic_category_id is not null and discovery_source is not null));

create index article_jobs_discovery_quota_idx
  on public.article_jobs (topic_category_id, created_at)
  where origin = 'discovery';

-- The same story is never turned into two articles.
create unique index article_jobs_discovery_source_url_idx
  on public.article_jobs (site_id, (discovery_source ->> 'url'))
  where origin = 'discovery';

-- ---------------------------------------------------------------------------
-- Discovery runs: one row per scan, for the console and for single-flight scanning
-- ---------------------------------------------------------------------------

create table public.topic_discovery_runs (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites (id) on delete restrict,
  worker_id text not null check (char_length(worker_id) <= 64),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  categories text[] not null default '{}',
  candidates integer check (candidates between 0 and 1000),
  created_job_ids uuid[] not null default '{}',
  error text check (char_length(error) <= 2000),
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status = 'running') = (finished_at is null))
);

create index topic_discovery_runs_recent_idx on public.topic_discovery_runs (site_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.topic_categories enable row level security;
alter table public.topic_discovery_runs enable row level security;

revoke all on public.topic_categories, public.topic_discovery_runs from anon, authenticated;
grant select on public.topic_categories, public.topic_discovery_runs to authenticated;
grant all on public.topic_categories, public.topic_discovery_runs to service_role;

create policy "Admins read topic_categories"
  on public.topic_categories for select to authenticated using ((select private.is_admin()));
create policy "Admins read topic_discovery_runs"
  on public.topic_discovery_runs for select to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Pacing
-- ---------------------------------------------------------------------------

-- Jobs a category may have created so far today: its target, prorated over the publication day.
create function private.discovery_allowance(p_daily_target integer, p_now timestamptz, p_timezone text)
returns integer
language sql
stable
set search_path = ''
as $$
  select ceil(
    p_daily_target
    * extract(epoch from ((p_now at time zone p_timezone) - date_trunc('day', p_now at time zone p_timezone)))
    / 86400.0
  )::integer;
$$;

-- Discovery jobs a category has created since midnight in the publication timezone.
create function private.discovery_created_today(p_category_id uuid, p_now timestamptz, p_timezone text)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer from public.article_jobs j
  where j.topic_category_id = p_category_id
    and j.origin = 'discovery'
    and j.created_at >= (date_trunc('day', p_now at time zone p_timezone) at time zone p_timezone);
$$;

-- ---------------------------------------------------------------------------
-- Worker functions (service role only)
-- ---------------------------------------------------------------------------

-- Starts a scan when one is due and some category still owes an article. Returns no row otherwise,
-- which is the common case and costs one indexed query.
create function public.worker_begin_topic_discovery(p_worker_id text)
returns table (
  run_id bigint,
  site_id uuid,
  site_name text,
  timezone text,
  today text,
  categories jsonb,
  recent_topics jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_settings public.site_settings;
  v_site public.sites;
  v_now timestamptz := now();
  v_due jsonb;
  v_run_id bigint;
begin
  if p_worker_id is null or p_worker_id !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'invalid worker id' using errcode = '22023';
  end if;

  -- Version 1 has one publication; lock its settings row so two workers cannot both start a scan.
  select st.* into v_settings from public.site_settings st
  where st.discovery_enabled
  order by st.site_id
  limit 1
  for update;
  if not found then
    return;
  end if;
  select * into v_site from public.sites where id = v_settings.site_id;

  -- A scan whose worker died is closed after an hour so it cannot block discovery forever.
  update public.topic_discovery_runs r set
    status = 'failed', finished_at = v_now, error = 'The worker stopped before finishing the scan.'
  where r.site_id = v_site.id and r.status = 'running' and r.started_at < v_now - interval '1 hour';

  if exists (select 1 from public.topic_discovery_runs r where r.site_id = v_site.id and r.status = 'running') then
    return;
  end if;
  if v_settings.discovery_last_started_at is not null
     and v_settings.discovery_last_started_at > v_now - make_interval(mins => v_settings.discovery_interval_minutes) then
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'name', c.name, 'guidance', c.guidance,
      'daily_target', c.daily_target,
      'created_today', private.discovery_created_today(c.id, v_now, v_site.timezone)
    ) order by c.sort_order), '[]'::jsonb)
  into v_due
  from public.topic_categories c
  where c.site_id = v_site.id
    and c.daily_target > 0
    and private.discovery_created_today(c.id, v_now, v_site.timezone)
        < private.discovery_allowance(c.daily_target, v_now, v_site.timezone);

  if jsonb_array_length(v_due) = 0 then
    return;
  end if;

  insert into public.topic_discovery_runs (site_id, worker_id, categories)
  select v_site.id, p_worker_id, array_agg(d ->> 'slug') from jsonb_array_elements(v_due) d
  returning id into v_run_id;

  update public.site_settings set discovery_last_started_at = v_now where site_id = v_site.id;

  return query
  select
    v_run_id,
    v_site.id,
    v_site.name,
    v_site.timezone,
    to_char(v_now at time zone v_site.timezone, 'YYYY-MM-DD'),
    v_due,
    coalesce((
      select jsonb_agg(jsonb_build_object('category', c.slug, 'topic', j.topic,
                                          'url', j.discovery_source ->> 'url') order by j.created_at desc)
      from public.article_jobs j
      join public.topic_categories c on c.id = j.topic_category_id
      where j.site_id = v_site.id and j.origin = 'discovery' and j.created_at > v_now - interval '14 days'
    ), '[]'::jsonb);
end;
$$;

-- Turns one proposed story into a started article job, or returns null when the category's quota
-- is already met or the story was used before. Every check is repeated here under the category's
-- row lock, so a proposal can never exceed the target however the worker behaves.
create function public.worker_create_discovered_job(
  p_run_id bigint,
  p_worker_id text,
  p_category_id uuid,
  p_topic text,
  p_article_type public.article_type,
  p_keywords text[],
  p_requirements text,
  p_source jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.topic_discovery_runs;
  v_category public.topic_categories;
  v_settings public.site_settings;
  v_site public.sites;
  v_now timestamptz := now();
  v_url text := btrim(coalesce(p_source ->> 'url', ''));
  v_topic text := btrim(coalesce(p_topic, ''));
  v_job public.article_jobs;
  v_draft_mode public.provider_mode;
begin
  select * into v_run from public.topic_discovery_runs where id = p_run_id for update;
  if not found or v_run.status <> 'running' or v_run.worker_id is distinct from p_worker_id then
    raise exception 'discovery run % is not running for worker %', p_run_id, p_worker_id using errcode = 'FT003';
  end if;

  select * into v_category from public.topic_categories
  where id = p_category_id and site_id = v_run.site_id
  for update;
  if not found then
    raise exception 'category % does not belong to this publication', p_category_id using errcode = '22023';
  end if;
  select * into v_site from public.sites where id = v_run.site_id;
  select * into v_settings from public.site_settings where site_id = v_run.site_id;

  if char_length(v_topic) not between 3 and 300 then
    raise exception 'a discovered topic must be 3 to 300 characters' using errcode = '22023';
  end if;
  if v_url !~ '^https://[^\s/]+\.[^\s]+$' or char_length(v_url) > 2000
     or char_length(btrim(coalesce(p_source ->> 'headline', ''))) not between 3 and 300 then
    raise exception 'a discovered story needs an https URL and a headline' using errcode = '22023';
  end if;

  if private.discovery_created_today(v_category.id, v_now, v_site.timezone)
     >= private.discovery_allowance(v_category.daily_target, v_now, v_site.timezone) then
    return null;
  end if;
  if exists (
    select 1 from public.article_jobs j
    where j.site_id = v_run.site_id and j.origin = 'discovery' and j.discovery_source ->> 'url' = v_url
  ) then
    return null;
  end if;

  -- Discovery exists to run unattended, so every stage uses a subscription provider. Writing
  -- follows the publication's writing default when it is Claude Code (or a mock, in tests).
  v_draft_mode := coalesce(
    (select ps.mode from public.provider_settings ps
     where ps.site_id = v_run.site_id and ps.stage = 'draft' and ps.mode in ('claude_code', 'mock')),
    'claude_code'
  );

  insert into public.article_jobs (
    site_id, topic, keywords, requirements, article_type, image_count, auto_publish, category,
    research_mode, writing_mode, images_mode, audit_mode, origin, topic_category_id, discovery_source
  ) values (
    v_run.site_id, v_topic, coalesce(p_keywords[1:20], '{}'), nullif(btrim(coalesce(p_requirements, '')), ''),
    coalesce(p_article_type, 'news'), v_settings.discovery_image_count, false, v_category.name,
    'codex_cli', v_draft_mode, 'codex_image', 'codex_cli', 'discovery', v_category.id,
    jsonb_build_object(
      'url', v_url,
      'headline', left(btrim(p_source ->> 'headline'), 300),
      'publisher', left(nullif(btrim(coalesce(p_source ->> 'publisher', '')), ''), 120),
      'published_at', left(nullif(btrim(coalesce(p_source ->> 'published_at', '')), ''), 40),
      'run_id', p_run_id
    )
  )
  returning * into v_job;

  perform private.append_job_event(
    v_job.id, 'job.created', null, 'IDEA', 'worker', p_worker_id, v_job.lock_version, null,
    jsonb_build_object('origin', 'discovery', 'run_id', p_run_id, 'category', v_category.slug,
                       'source_url', v_url)
  );

  perform private.set_state_context('transition');
  update public.article_jobs set status = 'RESEARCH_PENDING' where id = v_job.id returning * into v_job;
  perform private.set_state_context('');
  perform private.append_job_event(
    v_job.id, 'job.started', 'IDEA', 'RESEARCH_PENDING', 'worker', p_worker_id, v_job.lock_version, null,
    jsonb_build_object('origin', 'discovery')
  );

  update public.topic_discovery_runs set created_job_ids = created_job_ids || v_job.id where id = p_run_id;
  return v_job.id;
end;
$$;

create function public.worker_finish_topic_discovery(
  p_run_id bigint,
  p_worker_id text,
  p_succeeded boolean,
  p_candidates integer default null,
  p_error text default null,
  p_usage jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.topic_discovery_runs set
    status = case when p_succeeded then 'succeeded' else 'failed' end,
    finished_at = now(),
    candidates = p_candidates,
    error = left(p_error, 2000),
    usage = case when jsonb_typeof(p_usage) = 'object' then p_usage else '{}'::jsonb end
  where id = p_run_id and worker_id = p_worker_id and status = 'running';
  if not found then
    raise exception 'discovery run % is not running for worker %', p_run_id, p_worker_id using errcode = 'FT003';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin functions
-- ---------------------------------------------------------------------------

create function public.admin_update_discovery_settings(
  p_enabled boolean,
  p_interval_minutes integer,
  p_image_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
begin
  if p_interval_minutes not between 15 and 720 or p_image_count not between 0 and 1 then
    raise exception 'scan every 15 to 720 minutes, with 0 or 1 image per article' using errcode = '22023';
  end if;
  update public.site_settings set
    discovery_enabled = coalesce(p_enabled, false),
    discovery_interval_minutes = p_interval_minutes,
    discovery_image_count = p_image_count,
    updated_by = v_member.user_id
  where site_id = v_member.site_id;
end;
$$;

create function public.admin_update_topic_category(p_category_id uuid, p_daily_target integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
begin
  if p_daily_target not between 0 and 12 then
    raise exception 'a daily target must be between 0 and 12' using errcode = '22023';
  end if;
  update public.topic_categories set daily_target = p_daily_target, updated_by = v_member.user_id
  where id = p_category_id and site_id = v_member.site_id;
  if not found then
    raise exception 'category % not found', p_category_id using errcode = 'P0002';
  end if;
end;
$$;

-- Makes the next worker poll scan immediately instead of waiting out the interval. Quotas and
-- pacing still apply.
create function public.admin_request_discovery_scan()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
begin
  update public.site_settings set discovery_last_started_at = null where site_id = v_member.site_id;
end;
$$;

revoke execute on function
  private.discovery_allowance(integer, timestamptz, text),
  private.discovery_created_today(uuid, timestamptz, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.worker_begin_topic_discovery(text),
  public.worker_create_discovered_job(bigint, text, uuid, text, public.article_type, text[], text, jsonb),
  public.worker_finish_topic_discovery(bigint, text, boolean, integer, text, jsonb)
to service_role;

grant execute on function
  public.admin_update_discovery_settings(boolean, integer, integer),
  public.admin_update_topic_category(uuid, integer),
  public.admin_request_discovery_scan()
to authenticated;
