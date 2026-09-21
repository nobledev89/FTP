-- The editor's desk: publishing on demand, rescheduling, and opt-in auto-publish for discovery.
--
--   1. `admin_reschedule_job` moves a SCHEDULED job's publication time, or makes it due now. The
--      status does not change, so the transition map is untouched; the horizon guard added in
--      20260921100000 still rejects a time more than a year out. A job the worker has already
--      claimed is PUBLISHING, not SCHEDULED, so it cannot be rescheduled under the worker.
--   2. `site_settings.discovery_auto_publish` lets the owner opt discovered articles into
--      publishing as soon as their audit passes. It is off by default, which keeps the original
--      behaviour: discovered articles stop at APPROVED for an editor. The value is copied onto each
--      job when it is created, so changing it never affects articles already in the pipeline.

-- ---------------------------------------------------------------------------
-- Rescheduling
-- ---------------------------------------------------------------------------

create function public.admin_reschedule_job(
  p_job_id uuid,
  p_expected_lock_version integer,
  p_desired_publish_at timestamptz default null
)
returns table (desired_publish_at timestamptz, lock_version integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_member public.admin_users := private.require_editor();
  v_job public.article_jobs;
  v_previous timestamptz;
begin
  v_job := private.lock_job(p_job_id);
  if v_job.site_id <> v_member.site_id then
    raise exception 'job % belongs to another site', p_job_id using errcode = '42501';
  end if;
  if v_job.lock_version <> p_expected_lock_version then
    raise exception 'job % changed since it was loaded (lock_version % <> %)', p_job_id, v_job.lock_version,
      p_expected_lock_version using errcode = 'FT002';
  end if;
  if v_job.status <> 'SCHEDULED' then
    raise exception 'only SCHEDULED jobs can be rescheduled' using errcode = 'FT001';
  end if;

  v_previous := v_job.desired_publish_at;
  perform private.set_state_context('transition');
  update public.article_jobs j set desired_publish_at = coalesce(p_desired_publish_at, now())
  where j.id = p_job_id
  returning j.* into v_job;
  perform private.set_state_context('');

  perform private.append_job_event(
    p_job_id, 'job.rescheduled', v_job.status, v_job.status, 'admin', v_member.user_id::text,
    v_job.lock_version, null,
    jsonb_build_object('desired_publish_at', v_job.desired_publish_at, 'previous_publish_at', v_previous)
  );

  return query select v_job.desired_publish_at, v_job.lock_version;
end;
$$;

grant execute on function public.admin_reschedule_job(uuid, integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Opt-in auto-publish for discovered articles
-- ---------------------------------------------------------------------------

alter table public.site_settings
  add column discovery_auto_publish boolean not null default false;

comment on column public.site_settings.discovery_auto_publish is
  'When true, discovered articles publish as soon as their audit passes instead of waiting for an editor.';

-- The previous signature is dropped rather than overloaded, so a caller that omits the new
-- argument keeps the current auto-publish value instead of reaching an ambiguous overload.
drop function public.admin_update_discovery_settings(boolean, integer, integer);

create function public.admin_update_discovery_settings(
  p_enabled boolean,
  p_interval_minutes integer,
  p_image_count integer,
  p_auto_publish boolean default null
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
    discovery_auto_publish = coalesce(p_auto_publish, discovery_auto_publish),
    updated_by = v_member.user_id
  where site_id = v_member.site_id;
end;
$$;

grant execute on function public.admin_update_discovery_settings(boolean, integer, integer, boolean)
  to authenticated;

-- Unchanged from 20260921150000 except that `auto_publish` now follows the publication setting.
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
    coalesce(p_article_type, 'news'), v_settings.discovery_image_count, v_settings.discovery_auto_publish, v_category.name,
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
