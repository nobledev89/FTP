-- Move jobs held by the superseded usage-limit policy onto the autonomous cooldown path.
-- Editorial review, authentication, invalid output, and every other human decision stay untouched.

do $$
declare
  v_job public.article_jobs;
  v_updated public.article_jobs;
  v_settings public.site_settings;
  v_to public.job_status;
  v_key text;
  v_resume_at timestamptz;
begin
  for v_job in
    select j.* from public.article_jobs j
    where j.status = 'NEEDS_HUMAN'
      and j.action_required_kind = 'usage_limit'
      and j.needs_human_stage in ('research', 'draft', 'images', 'audit', 'revision')
    order by j.action_required_at, j.created_at
    for update
  loop
    select * into v_settings from public.site_settings s where s.site_id = v_job.site_id;
    v_to := private.pending_status_for_stage(v_job.needs_human_stage, v_job.revision_count);
    v_key := private.provider_cooldown_key(
      private.mode_for_stage(v_job, v_job.needs_human_stage)
    );
    v_resume_at := greatest(
      coalesce(v_job.action_required_at, v_job.updated_at)
        + make_interval(mins => v_settings.processing_window_minutes)
        + interval '5 minutes',
      now()
    );

    if v_key is not null then
      insert into public.provider_cooldowns as pc
        (site_id, provider_key, blocked_until, reason, source_job_id)
      values (
        v_job.site_id, v_key, v_resume_at,
        left(coalesce(v_job.action_required_message, 'Legacy usage limit'), 2000), v_job.id
      )
      on conflict (site_id, provider_key) do update set
        blocked_until = greatest(pc.blocked_until, excluded.blocked_until),
        reason = excluded.reason,
        source_job_id = excluded.source_job_id;
    end if;

    perform private.set_state_context('transition');
    update public.article_jobs set
      status = v_to,
      attempt_count = greatest(attempt_count - 1, 0),
      next_attempt_at = v_resume_at,
      needs_human_stage = null,
      action_required_kind = null,
      action_required_message = null,
      action_required_run_id = null,
      action_required_at = null,
      failed_stage = null,
      failure_summary = null
    where id = v_job.id
    returning * into v_updated;
    perform private.set_state_context('');

    perform private.append_job_event(
      v_job.id, 'stage.usage_migrated', 'NEEDS_HUMAN', v_to, 'system', null,
      v_updated.lock_version, 'Moved from the legacy human hold to automatic provider cooldown.',
      jsonb_build_object('provider', v_key, 'resume_at', v_resume_at)
    );
  end loop;
end;
$$;
