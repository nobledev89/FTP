-- Autonomous throughput and provider recovery.
--
-- New articles are admitted to costly processing through a rolling window. Provider usage limits
-- pause only the affected provider and resume queued work automatically after the window. Topic
-- discovery also respects a bounded backlog, so an unattended worker cannot create work forever.

-- ---------------------------------------------------------------------------
-- Settings and durable operational state
-- ---------------------------------------------------------------------------

alter table public.site_settings
  add column processing_window_minutes smallint not null default 300
    check (processing_window_minutes between 60 and 1440),
  add column processing_max_articles smallint not null default 4
    check (processing_max_articles between 1 and 24),
  add column discovery_backlog_limit smallint not null default 8
    check (discovery_backlog_limit between 1 and 50);

comment on column public.site_settings.processing_window_minutes is
  'Rolling admission window for new articles. Existing admitted work is allowed to finish.';
comment on column public.site_settings.processing_max_articles is
  'Maximum articles that may enter research during one rolling processing window.';
comment on column public.site_settings.discovery_backlog_limit is
  'Maximum non-terminal discovered jobs allowed before topic discovery pauses.';

create table public.processing_admissions (
  job_id uuid primary key references public.article_jobs (id) on delete restrict,
  site_id uuid not null references public.sites (id) on delete restrict,
  admitted_at timestamptz not null default now()
);

create index processing_admissions_window_idx
  on public.processing_admissions (site_id, admitted_at desc);

create table public.provider_cooldowns (
  site_id uuid not null references public.sites (id) on delete restrict,
  provider_key text not null check (provider_key in (
    'codex_subscription', 'claude_subscription', 'openai_api', 'anthropic_api', 'gemini_api'
  )),
  blocked_until timestamptz not null,
  reason text not null check (char_length(reason) between 1 and 2000),
  source_job_id uuid references public.article_jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, provider_key)
);

create trigger provider_cooldowns_set_updated_at
  before update on public.provider_cooldowns
  for each row execute function private.set_updated_at();

alter table public.processing_admissions enable row level security;
alter table public.provider_cooldowns enable row level security;
revoke all on public.processing_admissions, public.provider_cooldowns from anon, authenticated;
grant select on public.processing_admissions, public.provider_cooldowns to authenticated;
grant all on public.processing_admissions, public.provider_cooldowns to service_role;

create policy "Admins read processing_admissions"
  on public.processing_admissions for select to authenticated using ((select private.is_admin()));
create policy "Admins read provider_cooldowns"
  on public.provider_cooldowns for select to authenticated using ((select private.is_admin()));

-- Subscription products share a quota across their CLI modes. API billing lanes remain separate.
create function private.provider_cooldown_key(p_mode public.provider_mode)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_mode
    when 'codex_cli' then 'codex_subscription'
    when 'codex_image' then 'codex_subscription'
    when 'claude_code' then 'claude_subscription'
    when 'openai_api' then 'openai_api'
    when 'anthropic_api' then 'anthropic_api'
    when 'gemini_api' then 'gemini_api'
    else null
  end;
$$;

create function private.queue_stage(p_status public.job_status)
returns public.pipeline_stage
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status = 'PUBLISHED' then 'verify'::public.pipeline_stage
    when p_status in ('SCHEDULED', 'APPROVED') then 'publish'::public.pipeline_stage
    else private.stage_for_status(p_status)
  end;
$$;

revoke execute on function
  private.provider_cooldown_key(public.provider_mode),
  private.queue_stage(public.job_status)
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Claiming: finish in-flight work, but admit only N new articles per rolling window
-- ---------------------------------------------------------------------------

create or replace function public.claim_next_job(
  p_worker_id text,
  p_lease_seconds integer default 900,
  p_stages public.pipeline_stage[] default null
)
returns table (
  job_id uuid,
  stage public.pipeline_stage,
  status public.job_status,
  lease_token uuid,
  lease_expires_at timestamptz,
  lock_version integer,
  attempt integer,
  revision_count integer,
  mode public.provider_mode
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_job public.article_jobs;
  v_settings public.site_settings;
  v_from public.job_status;
  v_to public.job_status;
  v_stage public.pipeline_stage;
  v_token uuid := gen_random_uuid();
  v_admitted integer;
begin
  perform private.assert_valid_worker_args(p_worker_id, p_lease_seconds);
  perform private.recover_expired_leases_core();

  select j.* into v_job
  from public.article_jobs j
  where j.lease_token is null
    and j.action_required_kind is null
    and (j.next_attempt_at is null or j.next_attempt_at <= now())
    and j.attempt_count < j.max_attempts
    and (
      j.status in ('RESEARCH_PENDING', 'DRAFT_PENDING', 'IMAGES_PENDING', 'AUDIT_PENDING', 'RE_AUDIT_PENDING')
      or (j.status = 'REVISION_REQUIRED' and j.revision_count < 2)
      or (j.status = 'SCHEDULED' and j.desired_publish_at <= now())
      or (j.status = 'APPROVED' and j.auto_publish and (j.desired_publish_at is null or j.desired_publish_at <= now()))
      or (j.status = 'PUBLISHED' and j.next_attempt_at is not null)
    )
    and (
      p_stages is null
      or private.queue_stage(j.status) = any (p_stages)
    )
    and not exists (
      select 1 from public.provider_cooldowns pc
      where pc.site_id = j.site_id
        and pc.provider_key = private.provider_cooldown_key(
          private.mode_for_stage(j, private.queue_stage(j.status))
        )
        and pc.blocked_until > now()
    )
  order by
    case
      when j.status in ('SCHEDULED', 'APPROVED') then 0
      when j.status = 'PUBLISHED' then 1
      when j.status = 'RESEARCH_PENDING'
           and not exists (select 1 from public.processing_admissions a where a.job_id = j.id) then 3
      else 2
    end,
    coalesce(j.next_attempt_at, j.desired_publish_at, j.created_at),
    j.created_at
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  -- Serialize admissions on the publication settings row. A retried research stage already has an
  -- admission and does not consume another place.
  if v_job.status = 'RESEARCH_PENDING'
     and not exists (select 1 from public.processing_admissions a where a.job_id = v_job.id) then
    select * into v_settings from public.site_settings s
    where s.site_id = v_job.site_id for update;

    select count(*)::integer into v_admitted
    from public.processing_admissions a
    where a.site_id = v_job.site_id
      and a.admitted_at > now() - make_interval(mins => v_settings.processing_window_minutes);

    if v_admitted >= v_settings.processing_max_articles then
      return;
    end if;

    insert into public.processing_admissions (job_id, site_id)
    values (v_job.id, v_job.site_id)
    on conflict (job_id) do nothing;
  end if;

  v_from := v_job.status;
  v_to := case v_from
    when 'RESEARCH_PENDING' then 'RESEARCHING'
    when 'DRAFT_PENDING' then 'DRAFTING'
    when 'IMAGES_PENDING' then 'IMAGES_PROCESSING'
    when 'AUDIT_PENDING' then 'AUDITING'
    when 'RE_AUDIT_PENDING' then 'AUDITING'
    when 'REVISION_REQUIRED' then 'REVISING'
    when 'SCHEDULED' then 'PUBLISHING'
    when 'APPROVED' then 'PUBLISHING'
    when 'PUBLISHED' then 'PUBLISHED'
  end::public.job_status;
  v_stage := private.queue_stage(v_from);

  perform private.set_state_context('transition');
  update public.article_jobs j set
    status = v_to,
    lease_owner = p_worker_id,
    lease_token = v_token,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempt_count = j.attempt_count + 1,
    next_attempt_at = null
  where j.id = v_job.id
  returning j.* into v_job;
  perform private.set_state_context('');

  perform private.append_job_event(
    v_job.id, 'stage.claimed', v_from, v_to, 'worker', p_worker_id, v_job.lock_version, null,
    jsonb_build_object('stage', v_stage, 'attempt', v_job.attempt_count,
                       'lease_expires_at', v_job.lease_expires_at)
  );

  update public.worker_instances w
  set current_job_id = v_job.id, current_stage = v_stage, last_seen_at = now()
  where w.worker_id = p_worker_id;

  return query select
    v_job.id, v_stage, v_job.status, v_token, v_job.lease_expires_at, v_job.lock_version,
    v_job.attempt_count::integer, v_job.revision_count::integer,
    private.mode_for_stage(v_job, v_stage);
end;
$$;

-- ---------------------------------------------------------------------------
-- Usage limits: provider-wide cooldown and automatic resumption
-- ---------------------------------------------------------------------------

create function public.defer_provider_for_usage_limit(
  p_site_id uuid,
  p_worker_id text,
  p_provider_key text,
  p_summary text,
  p_retry_at timestamptz default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.site_settings;
  v_until timestamptz;
begin
  if p_worker_id is null or p_worker_id !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'invalid worker id' using errcode = '22023';
  end if;
  if p_provider_key not in (
    'codex_subscription', 'claude_subscription', 'openai_api', 'anthropic_api', 'gemini_api'
  ) then
    raise exception 'invalid provider cooldown key' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_summary, ''))) = 0 then
    raise exception 'a sanitized usage-limit summary is required' using errcode = '22023';
  end if;

  select * into v_settings from public.site_settings s where s.site_id = p_site_id;
  if not found then raise exception 'site % not found', p_site_id using errcode = 'P0002'; end if;
  v_until := greatest(
    coalesce(p_retry_at,
      now() + make_interval(mins => v_settings.processing_window_minutes) + interval '5 minutes'),
    now() + interval '1 minute'
  );

  insert into public.provider_cooldowns as pc
    (site_id, provider_key, blocked_until, reason)
  values (p_site_id, p_provider_key, v_until, left(p_summary, 2000))
  on conflict (site_id, provider_key) do update set
    blocked_until = greatest(pc.blocked_until, excluded.blocked_until),
    reason = excluded.reason;
  return v_until;
end;
$$;

create function public.defer_stage_for_usage_limit(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_summary text,
  p_retry_at timestamptz default null,
  p_run_id uuid default null
)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.article_jobs;
  v_from public.job_status;
  v_to public.job_status;
  v_stage public.pipeline_stage;
  v_key text;
  v_until timestamptz;
begin
  if char_length(btrim(coalesce(p_summary, ''))) = 0 then
    raise exception 'a sanitized usage-limit summary is required' using errcode = '22023';
  end if;
  v_job := private.lock_job(p_job_id);
  perform private.assert_lease(v_job, p_worker_id, p_lease_token);
  if not private.is_active_status(v_job.status) then
    raise exception 'job % is not running a stage', p_job_id using errcode = 'FT001';
  end if;

  v_from := v_job.status;
  v_stage := private.stage_for_status(v_from);
  v_key := private.provider_cooldown_key(private.mode_for_stage(v_job, v_stage));
  if v_key is null then
    raise exception 'stage % does not use a cooldown-managed provider', v_stage using errcode = '22023';
  end if;

  v_until := public.defer_provider_for_usage_limit(
    v_job.site_id, p_worker_id, v_key, p_summary, p_retry_at
  );
  update public.provider_cooldowns set source_job_id = v_job.id
  where site_id = v_job.site_id and provider_key = v_key;

  v_to := case
    when v_from = 'PUBLISHING' and v_job.desired_publish_at is not null then 'SCHEDULED'
    else private.pending_status_for_stage(v_stage, v_job.revision_count)
  end;

  perform private.set_state_context('transition');
  update public.article_jobs set
    status = v_to,
    lease_owner = null,
    lease_token = null,
    lease_expires_at = null,
    attempt_count = greatest(attempt_count - 1, 0),
    next_attempt_at = v_until,
    failed_stage = null,
    failure_summary = null,
    needs_human_stage = null,
    action_required_kind = null,
    action_required_message = null,
    action_required_run_id = null,
    action_required_at = null
  where id = p_job_id
  returning * into v_job;
  perform private.set_state_context('');

  perform private.append_job_event(
    v_job.id, 'stage.usage_deferred', v_from, v_to, 'worker', p_worker_id,
    v_job.lock_version, left(p_summary, 2000),
    jsonb_build_object('provider', v_key, 'run_id', p_run_id, 'resume_at', v_until)
  );
  update public.worker_instances set current_job_id = null, current_stage = null
  where worker_id = p_worker_id;
  return v_job.status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Discovery: pause at backlog/cooldown, and tell ranking how many jobs fit
-- ---------------------------------------------------------------------------

drop function public.worker_begin_topic_discovery(text);

create function public.worker_begin_topic_discovery(p_worker_id text)
returns table (
  run_id bigint,
  site_id uuid,
  site_name text,
  timezone text,
  today text,
  categories jsonb,
  recent_topics jsonb,
  available_job_slots integer
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
  v_backlog integer;
  v_slots integer;
begin
  if p_worker_id is null or p_worker_id !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'invalid worker id' using errcode = '22023';
  end if;

  select st.* into v_settings from public.site_settings st
  where st.discovery_enabled order by st.site_id limit 1 for update;
  if not found then return; end if;
  select * into v_site from public.sites where id = v_settings.site_id;

  if exists (
    select 1 from public.provider_cooldowns pc
    where pc.site_id = v_site.id and pc.provider_key = 'codex_subscription'
      and pc.blocked_until > v_now
  ) then return; end if;

  select count(*)::integer into v_backlog from public.article_jobs j
  where j.site_id = v_site.id and j.origin = 'discovery'
    and j.status not in ('VERIFIED', 'FAILED', 'DISCARDED');
  v_slots := greatest(v_settings.discovery_backlog_limit - v_backlog, 0);
  if v_slots = 0 then return; end if;

  update public.topic_discovery_runs r set
    status = 'failed', finished_at = v_now, error = 'The worker stopped before finishing the scan.'
  where r.site_id = v_site.id and r.status = 'running'
    and r.started_at < v_now - interval '1 hour';

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
  where c.site_id = v_site.id and c.daily_target > 0
    and private.discovery_created_today(c.id, v_now, v_site.timezone)
        < private.discovery_allowance(c.daily_target, v_now, v_site.timezone);
  if jsonb_array_length(v_due) = 0 then return; end if;

  insert into public.topic_discovery_runs (site_id, worker_id, categories)
  select v_site.id, p_worker_id, array_agg(d ->> 'slug') from jsonb_array_elements(v_due) d
  returning id into v_run_id;
  update public.site_settings set discovery_last_started_at = v_now where site_id = v_site.id;

  return query select
    v_run_id, v_site.id, v_site.name, v_site.timezone,
    to_char(v_now at time zone v_site.timezone, 'YYYY-MM-DD'), v_due,
    coalesce((
      select jsonb_agg(jsonb_build_object('category', c.slug, 'topic', j.topic,
                                          'url', j.discovery_source ->> 'url') order by j.created_at desc)
      from public.article_jobs j join public.topic_categories c on c.id = j.topic_category_id
      where j.site_id = v_site.id and j.origin = 'discovery'
        and j.created_at > v_now - interval '14 days'
    ), '[]'::jsonb),
    v_slots;
end;
$$;

-- The creator rechecks the backlog under the settings lock and stores the traffic rationale with
-- the source provenance, so later editorial analysis can compare estimated and actual demand.
create or replace function public.worker_create_discovered_job(
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
  v_headline text := btrim(coalesce(p_source ->> 'headline', ''));
  v_traffic_score integer;
  v_job public.article_jobs;
  v_draft_mode public.provider_mode;
begin
  select * into v_run from public.topic_discovery_runs where id = p_run_id for update;
  if not found or v_run.status <> 'running' or v_run.worker_id is distinct from p_worker_id then
    raise exception 'discovery run % is not running for worker %', p_run_id, p_worker_id using errcode = 'FT003';
  end if;
  select * into v_settings from public.site_settings where site_id = v_run.site_id for update;
  if (select count(*) from public.article_jobs j
      where j.site_id = v_run.site_id and j.origin = 'discovery'
        and j.status not in ('VERIFIED', 'FAILED', 'DISCARDED')) >= v_settings.discovery_backlog_limit then
    return null;
  end if;

  select * into v_category from public.topic_categories
  where id = p_category_id and site_id = v_run.site_id for update;
  if not found then
    raise exception 'category % does not belong to this publication', p_category_id using errcode = '22023';
  end if;
  select * into v_site from public.sites where id = v_run.site_id;

  begin v_traffic_score := (p_source ->> 'traffic_score')::integer;
  exception when others then raise exception 'traffic score must be a whole number' using errcode = '22023';
  end;
  if char_length(v_topic) not between 3 and 300
     or v_url !~ '^https://[^\s/]+\.[^\s]+$' or char_length(v_url) > 2000
     or char_length(v_headline) not between 3 and 300
     or v_traffic_score not between 0 and 100
     or coalesce(p_source ->> 'traffic_audience', '') not in ('broad', 'medium', 'niche')
     or coalesce(p_source ->> 'traffic_search_intent', '') not in ('high', 'medium', 'low')
     or coalesce(p_source ->> 'traffic_urgency', '') not in ('breaking', 'timely', 'evergreen')
     or char_length(btrim(coalesce(p_source ->> 'traffic_rationale', ''))) not between 20 and 500 then
    raise exception 'invalid discovered story or traffic-potential evidence' using errcode = '22023';
  end if;

  if private.discovery_created_today(v_category.id, v_now, v_site.timezone)
     >= private.discovery_allowance(v_category.daily_target, v_now, v_site.timezone) then return null; end if;
  if exists (select 1 from public.article_jobs j where j.site_id = v_run.site_id
             and j.origin = 'discovery' and j.discovery_source ->> 'url' = v_url) then return null; end if;
  if private.duplicate_headline(v_run.site_id, null, v_topic || ' ' || v_headline,
                                interval '30 days', false) is not null then return null; end if;

  v_draft_mode := coalesce(
    (select ps.mode from public.provider_settings ps where ps.site_id = v_run.site_id
     and ps.stage = 'draft' and ps.mode in ('claude_code', 'mock')), 'claude_code'
  );

  insert into public.article_jobs (
    site_id, topic, keywords, requirements, article_type, image_count, auto_publish, category,
    research_mode, writing_mode, images_mode, audit_mode, origin, topic_category_id, discovery_source
  ) values (
    v_run.site_id, v_topic, coalesce(p_keywords[1:20], '{}'), nullif(btrim(coalesce(p_requirements, '')), ''),
    coalesce(p_article_type, 'news'), v_settings.discovery_image_count,
    v_settings.discovery_auto_publish, v_category.name,
    'codex_cli', v_draft_mode, 'codex_image', 'codex_cli', 'discovery', v_category.id,
    jsonb_build_object(
      'url', v_url, 'headline', left(v_headline, 300),
      'publisher', left(nullif(btrim(coalesce(p_source ->> 'publisher', '')), ''), 120),
      'published_at', left(nullif(btrim(coalesce(p_source ->> 'published_at', '')), ''), 40),
      'run_id', p_run_id, 'traffic_score', v_traffic_score,
      'traffic_audience', p_source ->> 'traffic_audience',
      'traffic_search_intent', p_source ->> 'traffic_search_intent',
      'traffic_urgency', p_source ->> 'traffic_urgency',
      'traffic_rationale', btrim(p_source ->> 'traffic_rationale')
    )
  ) returning * into v_job;

  perform private.append_job_event(
    v_job.id, 'job.created', null, 'IDEA', 'worker', p_worker_id, v_job.lock_version, null,
    jsonb_build_object('origin', 'discovery', 'run_id', p_run_id, 'category', v_category.slug,
                       'source_url', v_url, 'traffic_score', v_traffic_score)
  );
  perform private.set_state_context('transition');
  update public.article_jobs set status = 'RESEARCH_PENDING' where id = v_job.id returning * into v_job;
  perform private.set_state_context('');
  perform private.append_job_event(
    v_job.id, 'job.started', 'IDEA', 'RESEARCH_PENDING', 'worker', p_worker_id,
    v_job.lock_version, null, jsonb_build_object('origin', 'discovery')
  );
  update public.topic_discovery_runs set created_job_ids = created_job_ids || v_job.id where id = p_run_id;
  return v_job.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin settings
-- ---------------------------------------------------------------------------

drop function public.admin_update_discovery_settings(boolean, integer, integer, boolean, integer);

create function public.admin_update_discovery_settings(
  p_enabled boolean,
  p_interval_minutes integer,
  p_image_count integer,
  p_auto_publish boolean default null,
  p_spacing_minutes integer default null,
  p_processing_window_minutes integer default null,
  p_processing_max_articles integer default null,
  p_backlog_limit integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
  v_settings public.site_settings;
begin
  select * into v_settings from public.site_settings where site_id = v_member.site_id;
  if p_interval_minutes not between 15 and 720 or p_image_count not between 0 and 1 then
    raise exception 'scan every 15 to 720 minutes, with 0 or 1 image per article' using errcode = '22023';
  end if;
  if coalesce(p_spacing_minutes, v_settings.auto_publish_spacing_minutes) not between 5 and 240 then
    raise exception 'space automatic articles 5 to 240 minutes apart' using errcode = '22023';
  end if;
  if coalesce(p_processing_window_minutes, v_settings.processing_window_minutes) not between 60 and 1440
     or coalesce(p_processing_max_articles, v_settings.processing_max_articles) not between 1 and 24 then
    raise exception 'processing window must be 1 to 24 hours with 1 to 24 articles' using errcode = '22023';
  end if;
  if coalesce(p_backlog_limit, v_settings.discovery_backlog_limit) not between 1 and 50 then
    raise exception 'discovery backlog must be between 1 and 50 articles' using errcode = '22023';
  end if;
  if coalesce(p_auto_publish, v_settings.discovery_auto_publish) and p_image_count = 0 then
    raise exception 'automatic publishing needs a hero image: choose one image per article, or turn automatic publishing off'
      using errcode = '22023';
  end if;

  update public.site_settings set
    discovery_enabled = coalesce(p_enabled, false),
    discovery_interval_minutes = p_interval_minutes,
    discovery_image_count = p_image_count,
    discovery_auto_publish = coalesce(p_auto_publish, discovery_auto_publish),
    auto_publish_spacing_minutes = coalesce(p_spacing_minutes, auto_publish_spacing_minutes),
    processing_window_minutes = coalesce(p_processing_window_minutes, processing_window_minutes),
    processing_max_articles = coalesce(p_processing_max_articles, processing_max_articles),
    discovery_backlog_limit = coalesce(p_backlog_limit, discovery_backlog_limit),
    updated_by = v_member.user_id
  where site_id = v_member.site_id;
end;
$$;

grant execute on function
  public.claim_next_job(text, integer, public.pipeline_stage[]),
  public.defer_provider_for_usage_limit(uuid, text, text, text, timestamptz),
  public.defer_stage_for_usage_limit(uuid, text, uuid, text, timestamptz, uuid),
  public.worker_begin_topic_discovery(text),
  public.worker_create_discovered_job(bigint, text, uuid, text, public.article_type, text[], text, jsonb)
to service_role;

grant execute on function
  public.admin_update_discovery_settings(boolean, integer, integer, boolean, integer, integer, integer, integer)
to authenticated, service_role;
