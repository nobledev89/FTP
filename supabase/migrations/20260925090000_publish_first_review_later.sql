-- Publish-first automation for discovered articles.
--
-- Discovery jobs already carry an explicit auto_publish choice. Keep the automated audit and two
-- rewrite attempts, but do not turn a residual finding into daily editor work: publish the best
-- revised draft, retain the audit and resolution event, and let the owner withdraw it during the
-- same-day review. Malformed provider JSON is retried by the worker; legacy JSON holds are resumed.

alter table public.site_settings
  alter column auto_publish_spacing_minutes set default 60;

-- Fifteen minutes was the original default and caused bursts. One article per hour produces the
-- intended "a few posts every few hours" cadence without rewriting an owner's custom setting.
update public.site_settings
set auto_publish_spacing_minutes = 60
where auto_publish_spacing_minutes = 15;

-- The requested transition remains part of the worker contract. When an automated discovery audit
-- asks for a person, the database instead uses another revision while one is available, then records
-- a system resolution and approves the best audited draft. Hand-created jobs remain strict.
create or replace function private.complete_stage_core(
  p_job public.article_jobs,
  p_to public.job_status,
  p_actor_type public.actor_type,
  p_actor_id text,
  p_note text,
  p_metadata jsonb
)
returns public.article_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.article_jobs;
  v_from public.job_status := p_job.status;
  v_to public.job_status := p_to;
  v_next public.job_status;
  v_audit public.audits;
  v_draft_id uuid;
  v_publish_at timestamptz;
  v_hold_reason text;
  v_hold_detail text;
  v_review_deferred boolean := false;
  v_note text := p_note;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if (v_from::text || '>' || p_to::text) <> all (array[
    'RESEARCHING>RESEARCH_COMPLETE', 'DRAFTING>DRAFT_COMPLETE', 'IMAGES_PROCESSING>AUDIT_PENDING',
    'AUDITING>APPROVED', 'AUDITING>REVISION_REQUIRED', 'AUDITING>NEEDS_HUMAN', 'REVISING>RE_AUDIT_PENDING'
  ]) then
    raise exception 'cannot complete % as %', v_from, p_to using errcode = 'FT001';
  end if;
  if p_to = 'NEEDS_HUMAN' and char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'escalation requires a reason' using errcode = '22023';
  end if;

  perform private.assert_gate(p_job, p_to);

  if p_to = 'NEEDS_HUMAN' and p_job.origin = 'discovery' and p_job.auto_publish then
    v_audit := private.latest_audit(p_job.id);
    v_draft_id := private.latest_valid_draft_id(p_job.id);
    if v_audit.id is not null
       and v_audit.draft_id = v_draft_id
       and v_audit.verdict in ('REVISION_REQUIRED', 'NEEDS_HUMAN') then
      if p_job.revision_count < 2 then
        v_to := 'REVISION_REQUIRED';
        v_note := format(
          'Audit v%s requested review; automatic publishing will revise it instead.', v_audit.version
        );
        v_metadata := v_metadata || jsonb_build_object('human_review_deferred', true);
      else
        v_to := 'APPROVED';
        v_review_deferred := true;
        v_note := format(
          'Audit v%s still had findings after two revisions; queued for same-day post-publication review.',
          v_audit.version
        );
        v_metadata := v_metadata || jsonb_build_object(
          'human_review_deferred', true,
          'post_publish_review', true
        );
      end if;
    end if;
  end if;

  if v_to = 'APPROVED' then
    if v_audit.id is null then v_audit := private.latest_audit(p_job.id); end if;
    v_draft_id := v_audit.draft_id;
  end if;

  perform private.set_state_context('transition');
  update public.article_jobs set
    status = v_to,
    lease_owner = null,
    lease_token = null,
    lease_expires_at = null,
    attempt_count = 0,
    next_attempt_at = null,
    revision_count = case when v_to = 'RE_AUDIT_PENDING' then revision_count + 1 else revision_count end,
    approved_draft_id = case when v_to = 'APPROVED' then v_draft_id else approved_draft_id end,
    approved_audit_id = case when v_to = 'APPROVED' then v_audit.id else approved_audit_id end,
    needs_human_stage = case when v_to = 'NEEDS_HUMAN' then 'audit'::public.pipeline_stage else null end,
    action_required_kind = case when v_to = 'NEEDS_HUMAN' then 'editorial_review'::public.action_required_kind end,
    action_required_message = case when v_to = 'NEEDS_HUMAN' then v_note end,
    action_required_run_id = null,
    action_required_at = case when v_to = 'NEEDS_HUMAN' then now() end
  where id = p_job.id
  returning * into v_job;
  perform private.set_state_context('');

  perform private.append_job_event(
    v_job.id,
    case
      when v_review_deferred then 'job.resolved'
      when v_to = 'NEEDS_HUMAN' then 'job.needs_human'
      else 'stage.completed'
    end,
    v_from, v_to,
    case when v_review_deferred then 'system'::public.actor_type else p_actor_type end,
    case when v_review_deferred then null else p_actor_id end,
    v_job.lock_version, v_note, v_metadata
  );

  if v_to = 'APPROVED' and v_job.auto_publish and v_job.origin = 'discovery' then
    select plan.publish_at, plan.hold_reason, plan.detail
    into v_publish_at, v_hold_reason, v_hold_detail
    from private.auto_publish_plan(v_job) plan;

    perform private.set_state_context('transition');
    update public.article_jobs set
      auto_publish = (v_hold_reason is null),
      desired_publish_at = coalesce(v_publish_at, desired_publish_at),
      auto_publish_hold_reason = v_hold_reason
    where id = v_job.id
    returning * into v_job;
    perform private.set_state_context('');

    perform private.append_job_event(
      v_job.id,
      case when v_hold_reason is null then 'job.auto_publish_scheduled' else 'job.auto_publish_held' end,
      v_job.status, v_job.status, 'system', null, v_job.lock_version, null,
      jsonb_strip_nulls(jsonb_build_object(
        'reason', v_hold_reason, 'detail', v_hold_detail, 'desired_publish_at', v_publish_at
      ))
    );
  end if;

  loop
    v_next := case
      when v_job.status = 'RESEARCH_COMPLETE' then 'DRAFT_PENDING'
      when v_job.status = 'DRAFT_COMPLETE' and v_job.image_count > 0 then 'IMAGES_PENDING'
      when v_job.status = 'DRAFT_COMPLETE' then 'AUDIT_PENDING'
      when v_job.status = 'APPROVED' and v_job.auto_publish and v_job.desired_publish_at > now() then 'SCHEDULED'
      else null
    end::public.job_status;
    exit when v_next is null;

    perform private.assert_gate(v_job, v_next);
    v_from := v_job.status;
    perform private.set_state_context('transition');
    update public.article_jobs set status = v_next where id = v_job.id returning * into v_job;
    perform private.set_state_context('');

    perform private.append_job_event(
      v_job.id, 'status.advanced', v_from, v_next, 'system', null, v_job.lock_version, null,
      case when v_from = 'DRAFT_COMPLETE' and v_next = 'AUDIT_PENDING'
        then jsonb_build_object('images_skipped', true, 'reason', 'image_count is 0')
        else '{}'::jsonb end
    );
  end loop;

  return v_job;
end;
$$;

-- Resume legacy schema-output holds. The attempt number is preserved, so the normal retry ceiling
-- still applies and a persistently malformed provider response ends as FAILED, not editor work.
do $$
declare
  v_job public.article_jobs;
  v_updated public.article_jobs;
begin
  for v_job in
    select j.* from public.article_jobs j
    where j.status = 'NEEDS_HUMAN'
      and j.origin = 'discovery'
      and j.auto_publish
      and j.action_required_kind = 'invalid_output'
      and j.needs_human_stage in ('research', 'draft', 'images', 'audit', 'revision')
    order by j.created_at
    for update
  loop
    perform private.set_state_context('transition');
    update public.article_jobs set
      status = private.pending_status_for_stage(v_job.needs_human_stage, v_job.revision_count),
      next_attempt_at = now(),
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
      v_job.id, 'job.auto_resumed', 'NEEDS_HUMAN', v_updated.status, 'system', null,
      v_updated.lock_version, 'Malformed provider output moved to automatic retry.',
      jsonb_build_object('attempt', v_updated.attempt_count)
    );
  end loop;
end;
$$;

-- Queue existing audit holds under the same publish-first rule. The publication planner runs one
-- row at a time, so each article receives a distinct hourly slot.
do $$
declare
  v_job public.article_jobs;
  v_updated public.article_jobs;
  v_audit public.audits;
  v_draft_id uuid;
  v_publish_at timestamptz;
  v_hold_reason text;
  v_hold_detail text;
begin
  for v_job in
    select j.* from public.article_jobs j
    where j.status = 'NEEDS_HUMAN'
      and j.origin = 'discovery'
      and j.auto_publish
      and j.needs_human_stage = 'audit'
      and j.revision_count >= 2
    order by j.created_at
    for update
  loop
    v_audit := private.latest_audit(v_job.id);
    v_draft_id := private.latest_valid_draft_id(v_job.id);
    if v_audit.id is null or v_audit.draft_id is distinct from v_draft_id then
      continue;
    end if;

    perform private.set_state_context('transition');
    update public.article_jobs set
      status = 'APPROVED',
      approved_draft_id = v_draft_id,
      approved_audit_id = v_audit.id,
      needs_human_stage = null,
      action_required_kind = null,
      action_required_message = null,
      action_required_run_id = null,
      action_required_at = null
    where id = v_job.id
    returning * into v_updated;
    perform private.set_state_context('');

    perform private.append_job_event(
      v_job.id, 'job.resolved', 'NEEDS_HUMAN', 'APPROVED', 'system', null,
      v_updated.lock_version,
      'Residual audit findings queued for same-day post-publication review.',
      jsonb_build_object('human_review_deferred', true, 'post_publish_review', true,
                         'audit_id', v_audit.id)
    );

    select plan.publish_at, plan.hold_reason, plan.detail
    into v_publish_at, v_hold_reason, v_hold_detail
    from private.auto_publish_plan(v_updated) plan;

    perform private.set_state_context('transition');
    update public.article_jobs set
      auto_publish = (v_hold_reason is null),
      desired_publish_at = coalesce(v_publish_at, desired_publish_at),
      auto_publish_hold_reason = v_hold_reason
    where id = v_job.id
    returning * into v_updated;
    perform private.set_state_context('');

    perform private.append_job_event(
      v_job.id,
      case when v_hold_reason is null then 'job.auto_publish_scheduled' else 'job.auto_publish_held' end,
      v_updated.status, v_updated.status, 'system', null, v_updated.lock_version, null,
      jsonb_strip_nulls(jsonb_build_object(
        'reason', v_hold_reason, 'detail', v_hold_detail, 'desired_publish_at', v_publish_at
      ))
    );

    if v_hold_reason is null and v_publish_at > now() then
      perform private.set_state_context('transition');
      update public.article_jobs set status = 'SCHEDULED' where id = v_job.id returning * into v_updated;
      perform private.set_state_context('');
      perform private.append_job_event(
        v_job.id, 'status.advanced', 'APPROVED', 'SCHEDULED', 'system', null,
        v_updated.lock_version, null, '{}'::jsonb
      );
    end if;
  end loop;
end;
$$;
