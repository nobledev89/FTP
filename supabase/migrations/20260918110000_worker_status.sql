-- Phase 5: read-only worker/queue health for `pnpm worker:status`.
-- The service-role-only function deliberately performs no recovery, heartbeat, or queue mutation.

create function public.worker_status(p_worker_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_worker jsonb;
  v_thresholds jsonb;
  v_queue jsonb;
begin
  perform private.assert_valid_worker_args(p_worker_id, 60);

  select to_jsonb(worker_row) into v_worker
  from (
    select worker_id, host_label, version, started_at, last_seen_at, current_job_id, current_stage,
           health
    from public.worker_instances
    where worker_id = p_worker_id
  ) worker_row;

  -- Version 1 has one site. A future multi-site worker assignment must make this selection explicit.
  select jsonb_build_object(
    'stale_after_seconds', worker_stale_after_seconds,
    'offline_after_seconds', worker_offline_after_seconds
  ) into v_thresholds
  from public.site_settings
  order by updated_at desc
  limit 1;

  select jsonb_build_object(
    'claimable', count(*) filter (where
      lease_token is null
      and action_required_kind is null
      and (next_attempt_at is null or next_attempt_at <= v_now)
      and attempt_count < max_attempts
      and (
        status in ('RESEARCH_PENDING', 'DRAFT_PENDING', 'IMAGES_PENDING', 'AUDIT_PENDING', 'RE_AUDIT_PENDING')
        or (status = 'REVISION_REQUIRED' and revision_count < 2)
        or (status = 'SCHEDULED' and desired_publish_at <= v_now)
        or (status = 'APPROVED' and auto_publish and (desired_publish_at is null or desired_publish_at <= v_now))
        or (status = 'PUBLISHED' and next_attempt_at is not null)
      )
    ),
    'leased', count(*) filter (where lease_expires_at > v_now),
    'expired_leases', count(*) filter (where lease_expires_at <= v_now),
    'delayed', count(*) filter (where lease_token is null and next_attempt_at > v_now),
    'action_required', count(*) filter (where action_required_kind is not null),
    'failed', count(*) filter (where status = 'FAILED'),
    'oldest_claimable_at', min(coalesce(next_attempt_at, desired_publish_at, created_at)) filter (where
      lease_token is null
      and action_required_kind is null
      and (next_attempt_at is null or next_attempt_at <= v_now)
      and attempt_count < max_attempts
      and (
        status in ('RESEARCH_PENDING', 'DRAFT_PENDING', 'IMAGES_PENDING', 'AUDIT_PENDING', 'RE_AUDIT_PENDING')
        or (status = 'REVISION_REQUIRED' and revision_count < 2)
        or (status = 'SCHEDULED' and desired_publish_at <= v_now)
        or (status = 'APPROVED' and auto_publish and (desired_publish_at is null or desired_publish_at <= v_now))
        or (status = 'PUBLISHED' and next_attempt_at is not null)
      )
    ),
    'by_status', (
      select coalesce(jsonb_object_agg(status, total order by status), '{}'::jsonb)
      from (
        select status, count(*) as total
        from public.article_jobs
        group by status
      ) status_counts
    )
  ) into v_queue
  from public.article_jobs;

  return jsonb_build_object(
    'server_time', v_now,
    'worker', v_worker,
    'thresholds', coalesce(v_thresholds, jsonb_build_object(
      'stale_after_seconds', 60,
      'offline_after_seconds', 120
    )),
    'queue', v_queue
  );
end;
$$;

comment on function public.worker_status(text) is
  'Read-only worker heartbeat and exact queue-health snapshot for the local worker status CLI.';

revoke all on function public.worker_status(text) from public, anon, authenticated;
grant execute on function public.worker_status(text) to service_role;
