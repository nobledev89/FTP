-- Phase 4: functions the authenticated admin console needs.
--
-- `authenticated` holds no table write privileges (migration 20260917100400), so every admin write
-- goes through a SECURITY DEFINER function that authorizes its own caller. Reads that PostgREST can
-- express directly (job lists, artifacts, logs, prompts, provider settings) stay as RLS-filtered
-- selects; only the dashboard needs server-side aggregation, which is what admin_dashboard does.

-- ---------------------------------------------------------------------------
-- Authorization helpers. Callable only from the definer functions below.
-- ---------------------------------------------------------------------------

-- Any active membership, including `viewer`. Mirrors private.require_editor's ordering so a user
-- with several memberships resolves to their most privileged one.
create function private.require_admin()
returns public.admin_users
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users;
begin
  select * into v_member from public.admin_users
  where user_id = (select auth.uid()) and is_active
  order by case role when 'owner' then 0 when 'editor' then 1 else 2 end
  limit 1;
  if v_member.user_id is null then
    raise exception 'an active admin membership is required' using errcode = '42501';
  end if;
  return v_member;
end;
$$;

create function private.require_owner()
returns public.admin_users
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users;
begin
  select * into v_member from public.admin_users
  where user_id = (select auth.uid()) and is_active and role = 'owner'
  limit 1;
  if v_member.user_id is null then
    raise exception 'an active owner membership is required' using errcode = '42501';
  end if;
  return v_member;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_dashboard: one round trip for the queue summary (plan section 12).
-- ---------------------------------------------------------------------------

create function public.admin_dashboard(
  p_list_limit integer default 8
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_admin();
  v_site uuid := v_member.site_id;
  v_limit integer := least(greatest(coalesce(p_list_limit, 8), 1), 50);
  v_stale integer;
  v_offline integer;
begin
  select worker_stale_after_seconds, worker_offline_after_seconds
  into v_stale, v_offline
  from public.site_settings
  where site_id = v_site;

  v_stale := coalesce(v_stale, 60);
  v_offline := coalesce(v_offline, 120);

  return jsonb_build_object(
    'site_id', v_site,
    'role', v_member.role,
    'generated_at', now(),

    'status_counts', (
      select coalesce(jsonb_object_agg(status, total), '{}'::jsonb)
      from (
        select status::text as status, count(*) as total
        from public.article_jobs
        where site_id = v_site
        group by status
      ) s
    ),

    'stage_counts', (
      select coalesce(jsonb_object_agg(stage, total), '{}'::jsonb)
      from (
        select private.stage_for_status(status)::text as stage, count(*) as total
        from public.article_jobs
        where site_id = v_site and private.stage_for_status(status) is not null
        group by 1
      ) s
    ),

    'totals', jsonb_build_object(
      'jobs', (select count(*) from public.article_jobs where site_id = v_site),
      'active', (
        select count(*) from public.article_jobs
        where site_id = v_site and private.is_active_status(status)
      ),
      'awaiting_action', (
        select count(*) from public.article_jobs
        where site_id = v_site and action_required_kind is not null
      ),
      'failed', (select count(*) from public.article_jobs where site_id = v_site and status = 'FAILED'),
      'needs_human', (
        select count(*) from public.article_jobs where site_id = v_site and status = 'NEEDS_HUMAN'
      ),
      'paused', (select count(*) from public.article_jobs where site_id = v_site and status = 'PAUSED'),
      'published_last_7_days', (
        select count(*) from public.articles
        where site_id = v_site
          and status in ('published', 'verified')
          and published_at > now() - interval '7 days'
      )
    ),

    -- Jobs waiting on a person: manual provider input, expired CLI auth, escalations.
    'action_required', (
      select coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) from (
        select id, topic, status, action_required_kind as kind, action_required_message as message,
               action_required_at as since, lock_version
        from public.article_jobs
        where site_id = v_site and action_required_kind is not null
        order by action_required_at
        limit v_limit
      ) rows
    ),

    'blocked', (
      select coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) from (
        select id, topic, status, failed_stage, needs_human_stage, failure_summary,
               attempt_count, max_attempts, next_attempt_at, updated_at, lock_version
        from public.article_jobs
        where site_id = v_site and status in ('FAILED', 'NEEDS_HUMAN')
        order by updated_at desc
        limit v_limit
      ) rows
    ),

    'in_progress', (
      select coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) from (
        select id, topic, status, lease_owner, lease_expires_at, revision_count, updated_at,
               lock_version
        from public.article_jobs
        where site_id = v_site and private.is_active_status(status)
        order by updated_at desc
        limit v_limit
      ) rows
    ),

    'upcoming', (
      select coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) from (
        select id, topic, status, desired_publish_at, auto_publish, lock_version
        from public.article_jobs
        where site_id = v_site and status in ('APPROVED', 'SCHEDULED')
        order by desired_publish_at nulls last, updated_at desc
        limit v_limit
      ) rows
    ),

    'recent_publications', (
      select coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) from (
        select a.id, a.slug, a.title, a.status, a.published_at, a.verified_at, j.id as job_id
        from public.articles a
        left join public.article_jobs j on j.article_id = a.id
        where a.site_id = v_site
        order by a.published_at desc
        limit v_limit
      ) rows
    ),

    -- Worker health is observed from heartbeats; the console never connects to the PC.
    'workers', (
      select coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) from (
        select worker_id, host_label, version, started_at, last_seen_at, current_job_id,
               current_stage,
               case
                 when last_seen_at > now() - make_interval(secs => v_stale) then 'online'
                 when last_seen_at > now() - make_interval(secs => v_offline) then 'stale'
                 else 'offline'
               end as state
        from public.worker_instances
        order by last_seen_at desc
        limit v_limit
      ) rows
    ),

    'worker_thresholds', jsonb_build_object(
      'stale_after_seconds', v_stale,
      'offline_after_seconds', v_offline
    )
  );
end;
$$;

comment on function public.admin_dashboard(integer) is
  'Aggregated queue, blockage, schedule, publication, and worker-health summary for the site of the calling admin.';

-- ---------------------------------------------------------------------------
-- admin_update_site_settings: editorial defaults, SEO defaults, worker thresholds.
-- Every value is passed on each save, so a null argument clears an optional column.
-- ---------------------------------------------------------------------------

create function public.admin_update_site_settings(
  p_default_byline_name text,
  p_default_byline_role text,
  p_editorial_contact_email text,
  p_seo_default_title text,
  p_seo_default_description text,
  p_share_image_path text,
  p_worker_stale_after_seconds integer,
  p_worker_offline_after_seconds integer,
  p_auto_publish_default boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
  v_row public.site_settings;
begin
  update public.site_settings set
    default_byline_name = btrim(p_default_byline_name),
    default_byline_role = nullif(btrim(coalesce(p_default_byline_role, '')), ''),
    editorial_contact_email = nullif(btrim(coalesce(p_editorial_contact_email, '')), ''),
    seo_default_title = nullif(btrim(coalesce(p_seo_default_title, '')), ''),
    seo_default_description = nullif(btrim(coalesce(p_seo_default_description, '')), ''),
    share_image_path = nullif(btrim(coalesce(p_share_image_path, '')), ''),
    worker_stale_after_seconds = p_worker_stale_after_seconds,
    worker_offline_after_seconds = p_worker_offline_after_seconds,
    auto_publish_default = p_auto_publish_default,
    updated_by = v_member.user_id
  where site_id = v_member.site_id
  returning * into v_row;

  if v_row.site_id is null then
    raise exception 'settings row missing for site %', v_member.site_id using errcode = 'P0002';
  end if;
  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_update_site_identity: publication name, description, disclosure, timezone.
-- Owner only, and deliberately narrower than the table: canonical_origin, locale, and currency are
-- deployment-level values. Changing canonical_origin would invalidate the canonical URL already
-- stored on every published article, so it stays a migration/seed decision.
-- ---------------------------------------------------------------------------

create function public.admin_update_site_identity(
  p_name text,
  p_description text,
  p_disclosure text,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_owner();
  v_row public.sites;
begin
  update public.sites set
    name = btrim(p_name),
    description = btrim(coalesce(p_description, '')),
    disclosure = btrim(coalesce(p_disclosure, '')),
    timezone = coalesce(nullif(btrim(coalesce(p_timezone, '')), ''), timezone)
  where id = v_member.site_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'site % not found', v_member.site_id using errcode = 'P0002';
  end if;
  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Private helpers stay ungranted: they run inside the definer functions above.
-- ---------------------------------------------------------------------------

grant execute on function
  public.admin_dashboard(integer),
  public.admin_update_site_settings(text, text, text, text, text, text, integer, integer, boolean),
  public.admin_update_site_identity(text, text, text, text)
to authenticated, service_role;
