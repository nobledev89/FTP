-- State machine, queue leases, and the publication boundary (plan sections 8 and 9).
--
-- Every status change goes through a function in this file. A trigger on article_jobs rejects
-- direct status or lease edits, transitions missing from private.job_transitions, and any
-- PUBLISHED/VERIFIED change that does not come from publish_article/record_verification.
--
-- Error codes (SQLSTATE) used for classification by callers:
--   FT001 invalid transition      FT002 stale lock_version      FT003 lease not held
--   FT004 immutable history       FT005 stage gate not met      FT006 slug conflict
--   42501 not authorized          22023 invalid argument        P0002 job not found

-- ---------------------------------------------------------------------------
-- Transition map (mirrored by the TypeScript map in Phase 3)
-- ---------------------------------------------------------------------------

create table private.job_transitions (
  from_status public.job_status not null,
  to_status public.job_status not null,
  path text not null check (path in ('normal', 'pause', 'resume', 'failure', 'escalate', 'resolve', 'retry', 'recovery')),
  primary key (from_status, to_status)
);

insert into private.job_transitions (from_status, to_status, path) values
  ('IDEA', 'RESEARCH_PENDING', 'normal'),
  ('RESEARCH_PENDING', 'RESEARCHING', 'normal'),
  ('RESEARCHING', 'RESEARCH_COMPLETE', 'normal'),
  ('RESEARCH_COMPLETE', 'DRAFT_PENDING', 'normal'),
  ('DRAFT_PENDING', 'DRAFTING', 'normal'),
  ('DRAFTING', 'DRAFT_COMPLETE', 'normal'),
  ('DRAFT_COMPLETE', 'IMAGES_PENDING', 'normal'),
  ('DRAFT_COMPLETE', 'AUDIT_PENDING', 'normal'),
  ('IMAGES_PENDING', 'IMAGES_PROCESSING', 'normal'),
  ('IMAGES_PROCESSING', 'AUDIT_PENDING', 'normal'),
  ('AUDIT_PENDING', 'AUDITING', 'normal'),
  ('AUDITING', 'APPROVED', 'normal'),
  ('AUDITING', 'REVISION_REQUIRED', 'normal'),
  ('AUDITING', 'NEEDS_HUMAN', 'normal'),
  ('REVISION_REQUIRED', 'REVISING', 'normal'),
  ('REVISING', 'RE_AUDIT_PENDING', 'normal'),
  ('RE_AUDIT_PENDING', 'AUDITING', 'normal'),
  ('APPROVED', 'SCHEDULED', 'normal'),
  ('APPROVED', 'PUBLISHING', 'normal'),
  ('SCHEDULED', 'PUBLISHING', 'normal'),
  ('PUBLISHING', 'PUBLISHED', 'normal'),
  ('PUBLISHED', 'VERIFIED', 'normal');

-- Pause from any nonterminal pre-publication status; resume to a pausable status.
insert into private.job_transitions (from_status, to_status, path)
select s, 'PAUSED', 'pause' from unnest(enum_range(null::public.job_status)) s where private.is_pausable_status(s)
union all
select 'PAUSED', s, 'resume' from unnest(enum_range(null::public.job_status)) s where private.is_pausable_status(s)
on conflict do nothing;

-- Failure after retries are exhausted, and admin retry back to the stage's pending status.
insert into private.job_transitions (from_status, to_status, path)
select s, 'FAILED', 'failure' from unnest(enum_range(null::public.job_status)) s where private.is_active_status(s)
union all
select 'FAILED', s, 'retry'
from unnest(array['RESEARCH_PENDING', 'DRAFT_PENDING', 'IMAGES_PENDING', 'AUDIT_PENDING', 'RE_AUDIT_PENDING',
                  'REVISION_REQUIRED', 'APPROVED', 'SCHEDULED']::public.job_status[]) s
on conflict do nothing;

-- Escalation to a human and resolution to an explicit destination.
insert into private.job_transitions (from_status, to_status, path)
select s, 'NEEDS_HUMAN', 'escalate' from unnest(enum_range(null::public.job_status)) s
where private.is_pausable_status(s) or s = 'PUBLISHING'
union all
select 'NEEDS_HUMAN', s, 'resolve'
from unnest(array['RESEARCH_PENDING', 'DRAFT_PENDING', 'IMAGES_PENDING', 'AUDIT_PENDING', 'RE_AUDIT_PENDING',
                  'REVISION_REQUIRED', 'APPROVED']::public.job_status[]) s
on conflict do nothing;

-- Transient retries and expired-lease recovery return active work to its pending status.
insert into private.job_transitions (from_status, to_status, path) values
  ('RESEARCHING', 'RESEARCH_PENDING', 'recovery'),
  ('DRAFTING', 'DRAFT_PENDING', 'recovery'),
  ('IMAGES_PROCESSING', 'IMAGES_PENDING', 'recovery'),
  ('AUDITING', 'AUDIT_PENDING', 'recovery'),
  ('AUDITING', 'RE_AUDIT_PENDING', 'recovery'),
  ('REVISING', 'REVISION_REQUIRED', 'recovery'),
  ('PUBLISHING', 'SCHEDULED', 'recovery'),
  ('PUBLISHING', 'APPROVED', 'recovery')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

create function private.state_context()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('fintechpulse.state_context', true), ''), 'none');
$$;

create function private.set_state_context(p_context text)
returns void
language sql
set search_path = ''
as $$
  select set_config('fintechpulse.state_context', coalesce(p_context, ''), true);
$$;

create function private.guard_article_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context text := private.state_context();
begin
  if tg_op = 'DELETE' then
    raise exception 'article jobs are retained permanently' using errcode = 'FT004';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'IDEA' or new.lock_version <> 0 or new.attempt_count <> 0 or new.revision_count <> 0
       or new.lease_token is not null or new.action_required_kind is not null or new.paused_from_status is not null
       or new.failed_stage is not null or new.needs_human_stage is not null or new.article_id is not null
       or new.approved_draft_id is not null or new.approved_audit_id is not null then
      raise exception 'new jobs start in IDEA with no workflow state' using errcode = 'FT001';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if v_context = 'none' then
      raise exception 'job status changes must use the state machine functions' using errcode = 'FT001';
    end if;
    if not exists (
      select 1 from private.job_transitions t where t.from_status = old.status and t.to_status = new.status
    ) then
      raise exception 'transition % -> % is not allowed', old.status, new.status using errcode = 'FT001';
    end if;
    if new.status = 'PUBLISHED' and v_context <> 'publish' then
      raise exception 'only publish_article may move a job to PUBLISHED' using errcode = 'FT001';
    end if;
    if new.status = 'VERIFIED' and v_context <> 'verify' then
      raise exception 'only record_verification may move a job to VERIFIED' using errcode = 'FT001';
    end if;
  end if;

  if v_context = 'none' and (
    new.site_id, new.lock_version, new.attempt_count, new.max_attempts, new.revision_count, new.next_attempt_at,
    new.lease_owner, new.lease_token, new.lease_expires_at, new.action_required_kind, new.action_required_message,
    new.action_required_run_id, new.action_required_at, new.paused_from_status, new.failed_stage,
    new.failure_summary, new.needs_human_stage, new.approved_draft_id, new.approved_audit_id, new.article_id,
    new.created_by, new.created_at
  ) is distinct from (
    old.site_id, old.lock_version, old.attempt_count, old.max_attempts, old.revision_count, old.next_attempt_at,
    old.lease_owner, old.lease_token, old.lease_expires_at, old.action_required_kind, old.action_required_message,
    old.action_required_run_id, old.action_required_at, old.paused_from_status, old.failed_stage,
    old.failure_summary, old.needs_human_stage, old.approved_draft_id, old.approved_audit_id, old.article_id,
    old.created_by, old.created_at
  ) then
    raise exception 'job workflow columns change only through the state machine functions' using errcode = 'FT001';
  end if;

  -- Optimistic concurrency: any meaningful change bumps lock_version. Lease renewal does not,
  -- so an admin's form stays valid while a worker keeps its lease alive.
  if (to_jsonb(new) - array['lease_expires_at', 'updated_at', 'lock_version'])
     is distinct from (to_jsonb(old) - array['lease_expires_at', 'updated_at', 'lock_version']) then
    new.lock_version := old.lock_version + 1;
  else
    new.lock_version := old.lock_version;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger article_jobs_guard
  before insert or update or delete on public.article_jobs
  for each row execute function private.guard_article_job();

create function private.guard_article_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'articles are withdrawn, never deleted' using errcode = 'FT004';
  end if;
  if private.state_context() not in ('publish', 'verify', 'withdraw') then
    raise exception 'articles are written only by the publishing service' using errcode = 'FT001';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger articles_guard
  before insert or update or delete on public.articles
  for each row execute function private.guard_article_write();

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create function private.append_job_event(
  p_job_id uuid,
  p_event_type text,
  p_from public.job_status,
  p_to public.job_status,
  p_actor_type public.actor_type,
  p_actor_id text,
  p_lock_version integer,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.job_events (job_id, event_type, from_status, to_status, actor_type, actor_id, lock_version, note, metadata)
  values (p_job_id, p_event_type, p_from, p_to, p_actor_type, p_actor_id, p_lock_version, p_note, coalesce(p_metadata, '{}'::jsonb))
  returning id;
$$;

create function private.lock_job(p_job_id uuid)
returns public.article_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.article_jobs;
begin
  select * into v_job from public.article_jobs where id = p_job_id for update;
  if not found then
    raise exception 'job % not found', p_job_id using errcode = 'P0002';
  end if;
  return v_job;
end;
$$;

create function private.assert_lease(p_job public.article_jobs, p_worker_id text, p_lease_token uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_job.lease_token is null
     or p_job.lease_owner is distinct from p_worker_id
     or p_job.lease_token is distinct from p_lease_token
     or p_job.lease_expires_at <= now() then
    raise exception 'worker % does not hold a valid lease on job %', p_worker_id, p_job.id using errcode = 'FT003';
  end if;
end;
$$;

create function private.assert_valid_worker_args(p_worker_id text, p_lease_seconds integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_worker_id is null or p_worker_id !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'invalid worker id' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then
    raise exception 'lease seconds must be between 30 and 3600' using errcode = '22023';
  end if;
end;
$$;

create function private.mode_for_stage(p_job public.article_jobs, p_stage public.pipeline_stage)
returns public.provider_mode
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'research' then p_job.research_mode
    when 'draft' then p_job.writing_mode
    when 'revision' then p_job.writing_mode
    when 'images' then p_job.images_mode
    when 'audit' then p_job.audit_mode
    else 'internal'
  end;
$$;

create function private.latest_valid_draft_id(p_job_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id from public.drafts d
  where d.job_id = p_job_id and d.validation_status = 'valid'
  order by d.version desc
  limit 1;
$$;

create function private.latest_audit(p_job_id uuid)
returns public.audits
language sql
stable
security definer
set search_path = ''
as $$
  select a.* from public.audits a where a.job_id = p_job_id order by a.version desc limit 1;
$$;

-- Artifact preconditions for a transition (the "Gate" column of plan section 8.1).
create function private.assert_gate(p_job public.article_jobs, p_to public.job_status)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_audit public.audits;
  v_latest_draft uuid;
begin
  if p_to in ('RESEARCH_COMPLETE', 'DRAFT_PENDING') and not exists (
    select 1 from (
      select r.validation_status from public.research_packets r
      where r.job_id = p_job.id order by r.version desc limit 1
    ) latest where latest.validation_status = 'valid'
  ) then
    raise exception 'a valid research packet is required' using errcode = 'FT005';
  end if;

  if p_to in ('DRAFT_COMPLETE', 'IMAGES_PENDING', 'AUDIT_PENDING', 'RE_AUDIT_PENDING', 'REVISION_REQUIRED',
              'APPROVED', 'SCHEDULED') and not exists (
    select 1 from (
      select d.validation_status from public.drafts d
      where d.job_id = p_job.id order by d.version desc limit 1
    ) latest where latest.validation_status = 'valid'
  ) then
    raise exception 'a valid draft is required' using errcode = 'FT005';
  end if;

  if p_to = 'IMAGES_PENDING' and p_job.image_count = 0 then
    raise exception 'no images were requested' using errcode = 'FT005';
  end if;

  -- Images are skipped only when none were requested (plan section 8.1).
  if p_job.status = 'DRAFT_COMPLETE' and p_to = 'AUDIT_PENDING' and p_job.image_count > 0 then
    raise exception 'requested images must be produced before audit' using errcode = 'FT005';
  end if;

  if p_to in ('AUDIT_PENDING', 'RE_AUDIT_PENDING') and p_job.status <> 'DRAFT_COMPLETE' and p_job.image_count > 0
     and (
       select count(distinct i.slot) from public.images i
       where i.job_id = p_job.id and i.slot < p_job.image_count and i.status in ('ready', 'published')
     ) < p_job.image_count then
    raise exception 'all % requested images must be ready with alt text', p_job.image_count using errcode = 'FT005';
  end if;

  if p_to = 'RE_AUDIT_PENDING' then
    if p_job.status = 'REVISING' then
      v_audit := private.latest_audit(p_job.id);
      if v_audit.id is null or not exists (
        select 1 from public.drafts d
        where d.id = private.latest_valid_draft_id(p_job.id) and d.responds_to_audit_id = v_audit.id
      ) then
        raise exception 'a valid revised draft responding to the latest audit is required' using errcode = 'FT005';
      end if;
    elsif p_job.revision_count = 0 then
      raise exception 'RE_AUDIT_PENDING requires at least one completed revision' using errcode = 'FT005';
    end if;
  end if;

  if p_job.status = 'AUDITING' and p_to in ('APPROVED', 'REVISION_REQUIRED') then
    v_audit := private.latest_audit(p_job.id);
    v_latest_draft := private.latest_valid_draft_id(p_job.id);
    if v_audit.id is null or v_audit.draft_id is distinct from v_latest_draft then
      raise exception 'the latest audit must cover the latest valid draft' using errcode = 'FT005';
    end if;
    if p_to = 'APPROVED' and v_audit.verdict <> 'PASS' then
      raise exception 'approval requires a PASS audit verdict' using errcode = 'FT005';
    end if;
    if p_to = 'REVISION_REQUIRED' and v_audit.verdict <> 'REVISION_REQUIRED' then
      raise exception 'revision requires a REVISION_REQUIRED audit verdict' using errcode = 'FT005';
    end if;
  end if;

  if p_to = 'REVISION_REQUIRED' and p_job.revision_count >= 2 then
    raise exception 'automatic revision cycles are exhausted; escalate to NEEDS_HUMAN' using errcode = 'FT005';
  end if;

  if p_to = 'SCHEDULED' and p_job.approved_draft_id is null then
    raise exception 'scheduling requires an approved draft' using errcode = 'FT005';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Worker functions (service_role only)
-- ---------------------------------------------------------------------------

create function public.heartbeat_worker(
  p_worker_id text,
  p_host_label text default null,
  p_version text default null,
  p_started_at timestamptz default null,
  p_current_job_id uuid default null,
  p_current_stage public.pipeline_stage default null,
  p_health jsonb default '{}'::jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen timestamptz := now();
begin
  perform private.assert_valid_worker_args(p_worker_id, 60);
  insert into public.worker_instances as w
    (worker_id, host_label, version, started_at, last_seen_at, current_job_id, current_stage, health)
  values
    (p_worker_id, p_host_label, p_version, coalesce(p_started_at, v_seen), v_seen, p_current_job_id, p_current_stage,
     coalesce(p_health, '{}'::jsonb))
  on conflict (worker_id) do update set
    host_label = excluded.host_label,
    version = excluded.version,
    started_at = coalesce(p_started_at, w.started_at),
    last_seen_at = excluded.last_seen_at,
    current_job_id = excluded.current_job_id,
    current_stage = excluded.current_stage,
    health = excluded.health;
  return v_seen;
end;
$$;

create function private.recover_expired_leases_core()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.article_jobs;
  v_updated public.article_jobs;
  v_to public.job_status;
  v_count integer := 0;
  v_stage public.pipeline_stage;
begin
  for v_job in
    select * from public.article_jobs
    where lease_expires_at is not null and lease_expires_at <= now()
    order by lease_expires_at
    for update skip locked
  loop
    v_stage := private.stage_for_status(v_job.status);
    if v_job.status = 'PUBLISHED' then
      v_to := 'PUBLISHED';
    elsif v_job.attempt_count >= v_job.max_attempts then
      v_to := 'FAILED';
    elsif v_job.status = 'PUBLISHING' then
      v_to := case when v_job.desired_publish_at is not null then 'SCHEDULED' else 'APPROVED' end::public.job_status;
    else
      v_to := private.pending_status_for_stage(v_stage, v_job.revision_count);
    end if;

    perform private.set_state_context('transition');
    update public.article_jobs set
      status = v_to,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      next_attempt_at = case
        when v_to = 'FAILED' then null
        when v_to = 'PUBLISHED' and v_job.attempt_count >= v_job.max_attempts then null
        else now() end,
      failed_stage = case when v_to = 'FAILED' then v_stage else failed_stage end,
      failure_summary = case when v_to = 'FAILED' then 'Lease expired on the final attempt' else failure_summary end,
      action_required_kind = case when v_to = 'PUBLISHED' and v_job.attempt_count >= v_job.max_attempts
                                  then 'verification_failed'::public.action_required_kind else action_required_kind end,
      action_required_message = case when v_to = 'PUBLISHED' and v_job.attempt_count >= v_job.max_attempts
                                     then 'Verification lease expired on the final attempt' else action_required_message end,
      action_required_at = case when v_to = 'PUBLISHED' and v_job.attempt_count >= v_job.max_attempts
                                then now() else action_required_at end
    where id = v_job.id
    returning * into v_updated;
    perform private.set_state_context('');

    perform private.append_job_event(
      v_job.id, 'lease.expired', v_job.status, v_to, 'system', null, v_updated.lock_version, null,
      jsonb_build_object('worker_id', v_job.lease_owner, 'attempt', v_job.attempt_count, 'stage', coalesce(v_stage::text, 'verify'))
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create function public.recover_expired_leases()
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.recover_expired_leases_core();
$$;

create function public.claim_next_job(
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
  v_from public.job_status;
  v_to public.job_status;
  v_stage public.pipeline_stage;
  v_token uuid := gen_random_uuid();
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
      or (case when j.status = 'PUBLISHED' then 'verify'::public.pipeline_stage
               when j.status in ('SCHEDULED', 'APPROVED') then 'publish'::public.pipeline_stage
               else private.stage_for_status(j.status) end) = any (p_stages)
    )
  order by
    case when j.status in ('SCHEDULED', 'APPROVED') then 0 when j.status = 'PUBLISHED' then 1 else 2 end,
    coalesce(j.next_attempt_at, j.desired_publish_at, j.created_at),
    j.created_at
  limit 1
  for update skip locked;

  if not found then
    return;
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
  v_stage := case when v_from = 'PUBLISHED' then 'verify'::public.pipeline_stage else private.stage_for_status(v_to) end;

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
    jsonb_build_object('stage', v_stage, 'attempt', v_job.attempt_count, 'lease_expires_at', v_job.lease_expires_at)
  );

  update public.worker_instances w
  set current_job_id = v_job.id, current_stage = v_stage, last_seen_at = now()
  where w.worker_id = p_worker_id;

  return query select
    v_job.id, v_stage, v_job.status, v_token, v_job.lease_expires_at, v_job.lock_version,
    v_job.attempt_count::integer, v_job.revision_count::integer, private.mode_for_stage(v_job, v_stage);
end;
$$;

create function public.renew_lease(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_lease_seconds integer default 900
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.article_jobs;
begin
  perform private.assert_valid_worker_args(p_worker_id, p_lease_seconds);
  v_job := private.lock_job(p_job_id);
  perform private.assert_lease(v_job, p_worker_id, p_lease_token);

  perform private.set_state_context('transition');
  update public.article_jobs
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = p_job_id
  returning * into v_job;
  perform private.set_state_context('');

  return v_job.lease_expires_at;
end;
$$;

-- Completes a stage and applies automatic follow-on transitions. Shared by worker completion and,
-- from Phase 8, admin import of manual provider results.
create function private.complete_stage_core(
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
  v_next public.job_status;
  v_audit public.audits;
  v_draft_id uuid;
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

  if p_to = 'APPROVED' then
    v_audit := private.latest_audit(p_job.id);
    v_draft_id := v_audit.draft_id;
  end if;

  perform private.set_state_context('transition');
  update public.article_jobs set
    status = p_to,
    lease_owner = null,
    lease_token = null,
    lease_expires_at = null,
    attempt_count = 0,
    next_attempt_at = null,
    revision_count = case when p_to = 'RE_AUDIT_PENDING' then revision_count + 1 else revision_count end,
    approved_draft_id = case when p_to = 'APPROVED' then v_draft_id else approved_draft_id end,
    approved_audit_id = case when p_to = 'APPROVED' then v_audit.id else approved_audit_id end,
    needs_human_stage = case when p_to = 'NEEDS_HUMAN' then 'audit'::public.pipeline_stage else null end,
    action_required_kind = case when p_to = 'NEEDS_HUMAN' then 'editorial_review'::public.action_required_kind end,
    action_required_message = case when p_to = 'NEEDS_HUMAN' then p_note end,
    action_required_run_id = null,
    action_required_at = case when p_to = 'NEEDS_HUMAN' then now() end
  where id = p_job.id
  returning * into v_job;
  perform private.set_state_context('');

  perform private.append_job_event(
    v_job.id, case when p_to = 'NEEDS_HUMAN' then 'job.needs_human' else 'stage.completed' end,
    v_from, p_to, p_actor_type, p_actor_id, v_job.lock_version, p_note, p_metadata
  );

  -- Automatic follow-on transitions, each with its own event.
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

create function public.complete_stage(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_to_status public.job_status,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.article_jobs;
begin
  v_job := private.lock_job(p_job_id);
  perform private.assert_lease(v_job, p_worker_id, p_lease_token);
  v_job := private.complete_stage_core(v_job, p_to_status, 'worker', p_worker_id, p_note, p_metadata);
  update public.worker_instances set current_job_id = null, current_stage = null where worker_id = p_worker_id;
  return v_job.status;
end;
$$;

-- A manual provider stage waits for operator input without holding a lease (plan section 8.2).
create function public.request_manual_action(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_run_id uuid,
  p_message text
)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.article_jobs;
begin
  v_job := private.lock_job(p_job_id);
  perform private.assert_lease(v_job, p_worker_id, p_lease_token);
  if v_job.status = 'PUBLISHING' then
    raise exception 'publishing has no manual provider step' using errcode = 'FT001';
  end if;
  if not exists (
    select 1 from public.provider_runs r
    where r.id = p_run_id and r.job_id = p_job_id and r.status = 'action_required'
      and r.stage = private.stage_for_status(v_job.status)
  ) then
    raise exception 'manual action requires a matching provider run in action_required status' using errcode = '22023';
  end if;

  perform private.set_state_context('transition');
  update public.article_jobs set
    lease_owner = null,
    lease_token = null,
    lease_expires_at = null,
    action_required_kind = 'manual_input',
    action_required_message = left(p_message, 2000),
    action_required_run_id = p_run_id,
    action_required_at = now()
  where id = p_job_id
  returning * into v_job;
  perform private.set_state_context('');

  perform private.append_job_event(
    v_job.id, 'action.required', v_job.status, v_job.status, 'worker', p_worker_id, v_job.lock_version, null,
    jsonb_build_object('kind', 'manual_input', 'run_id', p_run_id)
  );
  update public.worker_instances set current_job_id = null, current_stage = null where worker_id = p_worker_id;
  return v_job.status;
end;
$$;

-- Records a stage failure. Outcomes: retry (back to pending with backoff), failed, needs_human.
create function public.fail_stage(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_outcome text,
  p_error_class public.error_class,
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
  v_stage public.pipeline_stage;
  v_to public.job_status;
  v_outcome text := p_outcome;
  v_kind public.action_required_kind;
begin
  if v_outcome not in ('retry', 'failed', 'needs_human') then
    raise exception 'outcome must be retry, failed, or needs_human' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_summary, ''))) = 0 then
    raise exception 'a sanitized failure summary is required' using errcode = '22023';
  end if;
  -- Never retry expired authentication or usage limits in a loop (plan section 9).
  if v_outcome = 'retry' and p_error_class in ('auth', 'usage_limit') then
    raise exception '% errors require human action, not retry', p_error_class using errcode = '22023';
  end if;

  v_job := private.lock_job(p_job_id);
  perform private.assert_lease(v_job, p_worker_id, p_lease_token);
  if not private.is_active_status(v_job.status) then
    raise exception 'job % is not running a stage', p_job_id using errcode = 'FT001';
  end if;

  v_from := v_job.status;
  v_stage := private.stage_for_status(v_from);

  if v_outcome = 'retry' and v_job.attempt_count >= v_job.max_attempts then
    v_outcome := 'failed';
  end if;

  if v_outcome = 'retry' then
    v_to := case
      when v_from = 'PUBLISHING' and v_job.desired_publish_at is not null then 'SCHEDULED'
      else private.pending_status_for_stage(v_stage, v_job.revision_count)
    end;
  elsif v_outcome = 'failed' then
    v_to := 'FAILED';
  else
    v_to := 'NEEDS_HUMAN';
    v_kind := case
      when v_from = 'PUBLISHING' then 'publish_conflict'
      when p_error_class = 'auth' then 'cli_auth'
      when p_error_class = 'usage_limit' then 'usage_limit'
      when p_error_class = 'invalid_output' then 'invalid_output'
      else 'editorial_review'
    end::public.action_required_kind;
  end if;

  perform private.set_state_context('transition');
  update public.article_jobs set
    status = v_to,
    lease_owner = null,
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = case when v_to = 'FAILED' or v_to = 'NEEDS_HUMAN' then null
                           else greatest(coalesce(p_retry_at, now()), now()) end,
    failed_stage = case when v_to = 'FAILED' then v_stage end,
    failure_summary = case when v_to = 'FAILED' then left(p_summary, 2000) end,
    needs_human_stage = case when v_to = 'NEEDS_HUMAN' then v_stage end,
    action_required_kind = v_kind,
    action_required_message = case when v_to = 'NEEDS_HUMAN' then left(p_summary, 2000) end,
    action_required_run_id = case when v_to = 'NEEDS_HUMAN' then p_run_id end,
    action_required_at = case when v_to = 'NEEDS_HUMAN' then now() end
  where id = p_job_id
  returning * into v_job;
  perform private.set_state_context('');

  perform private.append_job_event(
    v_job.id,
    case v_outcome when 'retry' then 'stage.retry_scheduled' when 'failed' then 'job.failed' else 'job.needs_human' end,
    v_from, v_to, 'worker', p_worker_id, v_job.lock_version, left(p_summary, 2000),
    jsonb_build_object('error_class', p_error_class, 'attempt', v_job.attempt_count, 'run_id', p_run_id,
                       'next_attempt_at', v_job.next_attempt_at)
  );
  update public.worker_instances set current_job_id = null, current_stage = null where worker_id = p_worker_id;
  return v_job.status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publication boundary (plan section 8.3)
-- ---------------------------------------------------------------------------

-- p_published_images: [{"image_id": uuid, "public_path": "articles/<slug>/<file>"}] for images the
-- worker has already copied to the public bucket.
create function public.publish_article(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_published_images jsonb default '[]'::jsonb
)
returns table (article_id uuid, slug text, canonical_url text, published_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_job public.article_jobs;
  v_draft public.drafts;
  v_audit public.audits;
  v_site public.sites;
  v_settings public.site_settings;
  v_hero public.images;
  v_image jsonb;
  v_article_id uuid;
  v_canonical text;
  v_sources jsonb;
  v_now timestamptz := now();
begin
  v_job := private.lock_job(p_job_id);
  if v_job.status <> 'PUBLISHING' then
    raise exception 'job % is %, not PUBLISHING', p_job_id, v_job.status using errcode = 'FT001';
  end if;
  perform private.assert_lease(v_job, p_worker_id, p_lease_token);

  if v_job.desired_publish_at is not null and v_job.desired_publish_at > v_now then
    raise exception 'job % is scheduled for %', p_job_id, v_job.desired_publish_at using errcode = 'FT005';
  end if;

  select * into v_draft from public.drafts where id = v_job.approved_draft_id;
  if v_draft.id is null or v_draft.validation_status <> 'valid' then
    raise exception 'publication requires a valid approved draft' using errcode = 'FT005';
  end if;

  v_audit := private.latest_audit(p_job_id);
  if v_audit.id is null or v_audit.id is distinct from v_job.approved_audit_id
     or v_audit.draft_id <> v_draft.id then
    raise exception 'the approved audit must be the latest audit and cover the approved draft' using errcode = 'FT005';
  end if;
  if v_audit.verdict <> 'PASS' and not exists (
    select 1 from public.job_events e
    where e.job_id = p_job_id and e.event_type = 'job.resolved' and e.to_status = 'APPROVED'
      and e.created_at >= v_audit.created_at
  ) then
    raise exception 'the latest audit did not pass and no admin approval is recorded' using errcode = 'FT005';
  end if;

  select * into v_site from public.sites where id = v_job.site_id;
  select * into v_settings from public.site_settings where site_id = v_job.site_id;

  -- Mark images the worker copied to public storage. Re-running with the same paths is a no-op.
  for v_image in select * from jsonb_array_elements(coalesce(p_published_images, '[]'::jsonb)) loop
    if (v_image ->> 'public_path') is null or (v_image ->> 'public_path') !~ '^articles/' then
      raise exception 'invalid public image path' using errcode = '22023';
    end if;
    update public.images i set
      status = 'published',
      public_path = v_image ->> 'public_path',
      published_at = coalesce(i.published_at, v_now)
    where i.id = (v_image ->> 'image_id')::uuid
      and i.job_id = p_job_id
      and (i.status = 'ready' or (i.status = 'published' and i.public_path = v_image ->> 'public_path'));
    if not found then
      raise exception 'image % is not ready for publication in this job', v_image ->> 'image_id' using errcode = 'FT005';
    end if;
  end loop;

  if v_job.image_count > 0 then
    if (
      select count(distinct i.slot) from public.images i
      where i.job_id = p_job_id and i.slot < v_job.image_count and i.status = 'published'
    ) < v_job.image_count then
      raise exception 'all % requested images must be published first', v_job.image_count using errcode = 'FT005';
    end if;
    select * into v_hero from public.images i
    where i.job_id = p_job_id and i.slot = 0 and i.status = 'published'
    order by i.version desc limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'title', s.title,
           'publisher', s.publisher,
           'url', s.url,
           'published_on', s.published_on,
           'accessed_at', s.accessed_at,
           'jurisdiction', s.jurisdiction
         )) order by refs.ordinality), '[]'::jsonb)
  into v_sources
  from jsonb_array_elements_text(v_draft.source_refs) with ordinality as refs(value, ordinality)
  join public.sources s on s.id::text = refs.value and s.job_id = p_job_id and not s.is_private;

  v_canonical := v_site.canonical_origin || '/blog/' || v_draft.slug;

  if exists (select 1 from public.article_slug_aliases a where a.site_id = v_job.site_id and a.slug = v_draft.slug) then
    raise exception 'slug % is reserved by an existing article alias', v_draft.slug using errcode = 'FT006';
  end if;

  perform private.set_state_context('publish');
  begin
    insert into public.articles (
      site_id, slug, title, excerpt, body_markdown, meta_title, meta_description, category, article_type,
      byline_name, byline_role, canonical_url, hero_image, source_references, status, published_at
    ) values (
      v_job.site_id, v_draft.slug, v_draft.title, v_draft.excerpt, v_draft.body_markdown,
      coalesce(nullif(btrim(v_draft.meta_title), ''), left(v_draft.title, 70)),
      coalesce(nullif(btrim(v_draft.meta_description), ''), left(v_draft.excerpt, 320)),
      coalesce(v_draft.category, v_job.category), v_job.article_type,
      coalesce(v_job.byline_name, v_settings.default_byline_name, v_site.name),
      coalesce(v_job.byline_role, v_settings.default_byline_role),
      v_canonical,
      case when v_hero.id is null then null else jsonb_strip_nulls(jsonb_build_object(
        'path', v_hero.public_path, 'alt', v_hero.alt_text, 'caption', v_hero.caption,
        'aspect_ratio', v_hero.aspect_ratio, 'width', v_hero.width, 'height', v_hero.height,
        'focal_x', v_hero.focal_x, 'focal_y', v_hero.focal_y
      )) end,
      v_sources, 'published', v_now
    )
    returning id into v_article_id;
  exception when unique_violation then
    perform private.set_state_context('');
    raise exception 'slug % is already used by another article', v_draft.slug using errcode = 'FT006';
  end;

  update public.article_jobs set
    status = 'PUBLISHED',
    article_id = v_article_id,
    lease_owner = null,
    lease_token = null,
    lease_expires_at = null,
    attempt_count = 0,
    next_attempt_at = v_now,
    action_required_kind = null,
    action_required_message = null,
    action_required_run_id = null,
    action_required_at = null
  where id = p_job_id
  returning * into v_job;
  perform private.set_state_context('');

  insert into public.publishing_logs (job_id, article_id, kind, outcome, request_summary, result_summary, worker_id)
  values (p_job_id, v_article_id, 'publish', 'succeeded',
          jsonb_build_object('slug', v_draft.slug, 'draft_id', v_draft.id, 'images', v_job.image_count),
          jsonb_build_object('canonical_url', v_canonical), p_worker_id);

  perform private.append_job_event(
    p_job_id, 'job.published', 'PUBLISHING', 'PUBLISHED', 'worker', p_worker_id, v_job.lock_version, null,
    jsonb_build_object('article_id', v_article_id, 'slug', v_draft.slug, 'canonical_url', v_canonical)
  );
  update public.worker_instances set current_job_id = null, current_stage = null where worker_id = p_worker_id;

  return query select v_article_id, v_draft.slug, v_canonical, v_now;
end;
$$;

-- p_checks: [{"name": "status_ok", "outcome": "succeeded", "http_status": 200, "duration_ms": 120, "detail": "..."}]
create function public.record_verification(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_checks jsonb,
  p_retry_at timestamptz default null
)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_required constant text[] := array['status_ok', 'canonical_matches', 'title_present', 'body_present',
                                       'hero_image_ok', 'meta_present', 'json_ld_valid', 'no_placeholders'];
  v_job public.article_jobs;
  v_check jsonb;
  v_name text;
  v_passed boolean := true;
  v_attempt integer;
begin
  v_job := private.lock_job(p_job_id);
  if v_job.status <> 'PUBLISHED' then
    raise exception 'job % is %, not PUBLISHED', p_job_id, v_job.status using errcode = 'FT001';
  end if;
  perform private.assert_lease(v_job, p_worker_id, p_lease_token);
  if jsonb_typeof(p_checks) <> 'array' then
    raise exception 'checks must be an array' using errcode = '22023';
  end if;
  v_attempt := v_job.attempt_count;

  for v_check in select * from jsonb_array_elements(p_checks) loop
    v_name := v_check ->> 'name';
    if v_name is null or v_name <> all (v_required) then
      raise exception 'unknown verification check %', v_name using errcode = '22023';
    end if;
    insert into public.publishing_logs
      (job_id, article_id, kind, check_name, outcome, attempt, http_status, duration_ms, result_summary, error, worker_id)
    values
      (p_job_id, v_job.article_id, 'verify_check', v_name, (v_check ->> 'outcome')::public.log_outcome, greatest(v_attempt, 1),
       (v_check ->> 'http_status')::smallint, (v_check ->> 'duration_ms')::integer,
       jsonb_strip_nulls(jsonb_build_object('detail', left(v_check ->> 'detail', 500))),
       left(v_check ->> 'error', 2000), p_worker_id);
  end loop;

  foreach v_name in array v_required loop
    if not exists (
      select 1 from jsonb_array_elements(p_checks) c
      where c ->> 'name' = v_name
        and (c ->> 'outcome' = 'succeeded'
             or (v_name = 'hero_image_ok' and v_job.image_count = 0 and c ->> 'outcome' = 'skipped'))
    ) then
      v_passed := false;
    end if;
  end loop;

  insert into public.publishing_logs (job_id, article_id, kind, outcome, attempt, result_summary, worker_id)
  values (p_job_id, v_job.article_id, 'verify_summary', case when v_passed then 'succeeded' else 'failed' end::public.log_outcome,
          greatest(v_attempt, 1), jsonb_build_object('checks', jsonb_array_length(p_checks)), p_worker_id);

  if v_passed then
    perform private.set_state_context('verify');
    update public.articles set status = 'verified', verified_at = now() where id = v_job.article_id;
    update public.article_jobs set
      status = 'VERIFIED',
      lease_owner = null, lease_token = null, lease_expires_at = null,
      attempt_count = 0, next_attempt_at = null
    where id = p_job_id
    returning * into v_job;
    perform private.set_state_context('');
    perform private.append_job_event(p_job_id, 'job.verified', 'PUBLISHED', 'VERIFIED', 'worker', p_worker_id,
                                     v_job.lock_version, null, jsonb_build_object('attempt', v_attempt));
  else
    -- PUBLISHED never advances on failure; retry with backoff, then ask a human (plan section 8.1).
    perform private.set_state_context('transition');
    update public.article_jobs set
      lease_owner = null, lease_token = null, lease_expires_at = null,
      next_attempt_at = case when v_attempt >= max_attempts then null
                             else greatest(coalesce(p_retry_at, now() + interval '2 minutes'), now()) end,
      action_required_kind = case when v_attempt >= max_attempts then 'verification_failed'::public.action_required_kind end,
      action_required_message = case when v_attempt >= max_attempts
                                     then 'Live verification failed after ' || v_attempt || ' attempts' end,
      action_required_at = case when v_attempt >= max_attempts then now() end
    where id = p_job_id
    returning * into v_job;
    perform private.set_state_context('');
    perform private.append_job_event(
      p_job_id, case when v_job.action_required_kind is not null then 'verification.exhausted' else 'verification.failed' end,
      'PUBLISHED', 'PUBLISHED', 'worker', p_worker_id, v_job.lock_version, null,
      jsonb_build_object('attempt', v_attempt, 'next_attempt_at', v_job.next_attempt_at)
    );
  end if;

  update public.worker_instances set current_job_id = null, current_stage = null where worker_id = p_worker_id;
  return v_job.status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin functions (authenticated users with an active admin_users membership)
-- ---------------------------------------------------------------------------

create function private.require_editor()
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
  where user_id = (select auth.uid()) and is_active and role in ('owner', 'editor')
  order by case role when 'owner' then 0 else 1 end
  limit 1;
  if v_member.user_id is null then
    raise exception 'an active owner or editor membership is required' using errcode = '42501';
  end if;
  return v_member;
end;
$$;

create function public.create_article_job(
  p_topic text,
  p_keywords text[] default '{}',
  p_requirements text default null,
  p_article_type public.article_type default 'analysis',
  p_target_word_count integer default null,
  p_image_count integer default 1,
  p_desired_publish_at timestamptz default null,
  p_auto_publish boolean default null,
  p_category text default null,
  p_research_mode public.provider_mode default null,
  p_writing_mode public.provider_mode default null,
  p_images_mode public.provider_mode default null,
  p_audit_mode public.provider_mode default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
  v_job public.article_jobs;
  v_modes public.provider_mode[];
  v_stages constant public.pipeline_stage[] := array['research', 'draft', 'images', 'audit']::public.pipeline_stage[];
begin
  v_modes := array[
    coalesce(p_research_mode, (select mode from public.provider_settings where site_id = v_member.site_id and stage = 'research'), 'mock'),
    coalesce(p_writing_mode, (select mode from public.provider_settings where site_id = v_member.site_id and stage = 'draft'), 'mock'),
    coalesce(p_images_mode, (select mode from public.provider_settings where site_id = v_member.site_id and stage = 'images'), 'mock'),
    coalesce(p_audit_mode, (select mode from public.provider_settings where site_id = v_member.site_id and stage = 'audit'), 'mock')
  ]::public.provider_mode[];

  -- Billable API modes must already be confirmed for that stage; there is no silent opt-in.
  for v_index in 1..4 loop
    if private.is_api_mode(v_modes[v_index]) and not exists (
      select 1 from public.provider_settings ps
      where ps.site_id = v_member.site_id and ps.stage = v_stages[v_index]
        and ps.mode = v_modes[v_index] and ps.api_mode_confirmed_at is not null
    ) then
      raise exception 'API mode for % must be enabled and confirmed in provider settings first', v_stages[v_index]
        using errcode = '22023';
    end if;
  end loop;

  insert into public.article_jobs (
    site_id, topic, keywords, requirements, article_type, target_word_count, image_count, desired_publish_at,
    auto_publish, category, research_mode, writing_mode, images_mode, audit_mode, created_by
  ) values (
    v_member.site_id, btrim(p_topic), coalesce(p_keywords, '{}'), p_requirements, p_article_type, p_target_word_count,
    p_image_count, p_desired_publish_at,
    coalesce(p_auto_publish, (select auto_publish_default from public.site_settings where site_id = v_member.site_id), false),
    p_category, v_modes[1], v_modes[2], v_modes[3], v_modes[4], v_member.user_id
  )
  returning * into v_job;

  perform private.append_job_event(
    v_job.id, 'job.created', null, 'IDEA', 'admin', v_member.user_id::text, v_job.lock_version, null,
    jsonb_build_object('research_mode', v_modes[1], 'writing_mode', v_modes[2], 'images_mode', v_modes[3],
                       'audit_mode', v_modes[4], 'image_count', p_image_count)
  );
  return v_job.id;
end;
$$;

-- Admin workflow actions with optimistic concurrency.
--   start             IDEA -> RESEARCH_PENDING
--   pause             pausable -> PAUSED (releases any lease)
--   resume            PAUSED -> paused_from_status
--   retry             FAILED -> pending status of failed_stage
--   mark_needs_human  pausable -> NEEDS_HUMAN (note required)
--   resolve           NEEDS_HUMAN -> p_to_status (note required, destination validated)
--   schedule          APPROVED -> SCHEDULED at p_desired_publish_at (default now)
create function public.admin_transition_job(
  p_job_id uuid,
  p_action text,
  p_expected_lock_version integer,
  p_note text default null,
  p_to_status public.job_status default null,
  p_desired_publish_at timestamptz default null
)
returns table (status public.job_status, lock_version integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_member public.admin_users := private.require_editor();
  v_job public.article_jobs;
  v_from public.job_status;
  v_to public.job_status;
  v_stage public.pipeline_stage;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_paused_from public.job_status;
  v_draft_id uuid;
  v_audit_id uuid;
  v_event text;
  v_had_lease boolean;
begin
  v_job := private.lock_job(p_job_id);
  v_had_lease := v_job.lease_token is not null;
  if v_job.site_id <> v_member.site_id then
    raise exception 'job % belongs to another site', p_job_id using errcode = '42501';
  end if;
  if v_job.lock_version <> p_expected_lock_version then
    raise exception 'job % changed since it was loaded (lock_version % <> %)', p_job_id, v_job.lock_version,
      p_expected_lock_version using errcode = 'FT002';
  end if;

  v_from := v_job.status;
  v_stage := private.stage_for_status(v_from);

  case p_action
    when 'start' then
      if v_from <> 'IDEA' then
        raise exception 'only IDEA jobs can be started' using errcode = 'FT001';
      end if;
      v_to := 'RESEARCH_PENDING';
      v_event := 'job.started';

    when 'pause' then
      if not private.is_pausable_status(v_from) then
        raise exception '% jobs cannot be paused', v_from using errcode = 'FT001';
      end if;
      v_to := 'PAUSED';
      -- An interrupted running stage resumes from its pending status; a manual wait resumes as is.
      v_paused_from := case
        when v_job.lease_token is not null then private.pending_status_for_stage(v_stage, v_job.revision_count)
        else v_from
      end;
      v_event := 'job.paused';

    when 'resume' then
      if v_from <> 'PAUSED' then
        raise exception 'only PAUSED jobs can be resumed' using errcode = 'FT001';
      end if;
      v_to := v_job.paused_from_status;
      v_event := 'job.resumed';

    when 'retry' then
      if v_from <> 'FAILED' then
        raise exception 'only FAILED jobs can be retried' using errcode = 'FT001';
      end if;
      v_to := case
        when v_job.failed_stage = 'publish' and v_job.desired_publish_at is not null then 'SCHEDULED'
        else private.pending_status_for_stage(v_job.failed_stage, v_job.revision_count)
      end;
      v_event := 'job.retried';

    when 'mark_needs_human' then
      if not private.is_pausable_status(v_from) then
        raise exception '% jobs cannot be escalated', v_from using errcode = 'FT001';
      end if;
      if v_note is null or char_length(v_note) < 3 then
        raise exception 'escalation requires a note' using errcode = '22023';
      end if;
      v_to := 'NEEDS_HUMAN';
      v_event := 'job.needs_human';

    when 'resolve' then
      if v_from <> 'NEEDS_HUMAN' then
        raise exception 'only NEEDS_HUMAN jobs can be resolved' using errcode = 'FT001';
      end if;
      if v_note is null or char_length(v_note) < 3 then
        raise exception 'resolution requires a note' using errcode = '22023';
      end if;
      v_to := p_to_status;
      if v_to is null or not exists (
        select 1 from private.job_transitions t where t.from_status = 'NEEDS_HUMAN' and t.to_status = v_to
      ) then
        raise exception 'resolution destination % is not allowed', v_to using errcode = 'FT001';
      end if;
      if v_to = 'APPROVED' then
        if v_job.needs_human_stage not in ('audit', 'revision', 'publish') then
          raise exception 'approval is only a valid resolution after an audit' using errcode = 'FT005';
        end if;
        v_draft_id := private.latest_valid_draft_id(p_job_id);
        select a.id into v_audit_id from public.audits a
        where a.job_id = p_job_id and a.draft_id = v_draft_id order by a.version desc limit 1;
        if v_draft_id is null or v_audit_id is null or v_audit_id <> (private.latest_audit(p_job_id)).id then
          raise exception 'approval requires the latest valid draft to have the latest audit' using errcode = 'FT005';
        end if;
      else
        if v_job.needs_human_stage in ('research', 'draft', 'images')
           and private.stage_rank(private.stage_for_status(v_to)) > private.stage_rank(v_job.needs_human_stage) then
          raise exception 'a job escalated at % cannot skip ahead to %', v_job.needs_human_stage, v_to using errcode = 'FT005';
        end if;
        if v_to = 'REVISION_REQUIRED' and (v_job.revision_count >= 2 or (private.latest_audit(p_job_id)).id is null) then
          raise exception 'no automatic revision cycle is available' using errcode = 'FT005';
        end if;
        perform private.assert_gate(v_job, v_to);
      end if;
      v_event := 'job.resolved';

    when 'schedule' then
      if v_from <> 'APPROVED' then
        raise exception 'only APPROVED jobs can be scheduled' using errcode = 'FT001';
      end if;
      v_to := 'SCHEDULED';
      v_event := 'job.scheduled';

    else
      raise exception 'unknown action %', p_action using errcode = '22023';
  end case;

  if p_action = 'schedule' then
    v_job.desired_publish_at := coalesce(p_desired_publish_at, now());
    perform private.assert_gate(v_job, v_to);
  end if;

  perform private.set_state_context('transition');
  update public.article_jobs j set
    status = v_to,
    lease_owner = null,
    lease_token = null,
    lease_expires_at = null,
    desired_publish_at = case when p_action = 'schedule' then coalesce(p_desired_publish_at, now()) else j.desired_publish_at end,
    paused_from_status = case when p_action = 'pause' then v_paused_from else null end,
    attempt_count = case when p_action in ('retry', 'resolve') then 0 else j.attempt_count end,
    next_attempt_at = case when p_action in ('retry', 'resolve', 'start') then null else j.next_attempt_at end,
    failed_stage = case when p_action = 'retry' then null else j.failed_stage end,
    failure_summary = case when p_action = 'retry' then null else j.failure_summary end,
    needs_human_stage = case when p_action = 'mark_needs_human' then coalesce(v_stage, 'research')
                             when p_action = 'resolve' then null else j.needs_human_stage end,
    approved_draft_id = case when p_action = 'resolve' and v_to = 'APPROVED' then v_draft_id else j.approved_draft_id end,
    approved_audit_id = case when p_action = 'resolve' and v_to = 'APPROVED' then v_audit_id else j.approved_audit_id end,
    -- Manual waits keep their action while paused so the prompt is still available on resume.
    action_required_kind = case
      when p_action = 'mark_needs_human' then 'editorial_review'::public.action_required_kind
      when p_action = 'resolve' then null
      when p_action = 'pause' and v_had_lease then null
      else j.action_required_kind end,
    action_required_message = case
      when p_action = 'mark_needs_human' then v_note
      when p_action = 'resolve' then null
      when p_action = 'pause' and v_had_lease then null
      else j.action_required_message end,
    action_required_run_id = case
      when p_action in ('mark_needs_human', 'resolve') then null
      when p_action = 'pause' and v_had_lease then null
      else j.action_required_run_id end,
    action_required_at = case
      when p_action = 'mark_needs_human' then now()
      when p_action = 'resolve' then null
      when p_action = 'pause' and v_had_lease then null
      else j.action_required_at end
  where j.id = p_job_id
  returning j.* into v_job;
  perform private.set_state_context('');

  perform private.append_job_event(
    p_job_id, v_event, v_from, v_to, 'admin', v_member.user_id::text, v_job.lock_version, v_note,
    jsonb_strip_nulls(jsonb_build_object('action', p_action, 'desired_publish_at', v_job.desired_publish_at,
                                         'released_lease', v_had_lease))
  );

  return query select v_job.status, v_job.lock_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap: grant the first owner. Run once from the SQL editor or psql; not exposed via the API.
-- ---------------------------------------------------------------------------

create function private.bootstrap_first_owner(p_email text, p_site_slug text default 'fintechpulse')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_site_id uuid;
begin
  select id into v_site_id from public.sites where slug = p_site_slug;
  if v_site_id is null then
    raise exception 'site % does not exist; apply seed data first', p_site_slug using errcode = 'P0002';
  end if;
  if exists (select 1 from public.admin_users where site_id = v_site_id and role = 'owner' and is_active) then
    raise exception 'an active owner already exists; add further admins from the admin application'
      using errcode = '42501';
  end if;
  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'no auth user with email %; create or invite the user first', p_email using errcode = 'P0002';
  end if;
  insert into public.admin_users (user_id, site_id, role, is_active, display_name)
  values (v_user_id, v_site_id, 'owner', true, split_part(p_email, '@', 1))
  on conflict (user_id, site_id) do update set role = 'owner', is_active = true;
  return v_user_id;
end;
$$;

revoke execute on function private.bootstrap_first_owner(text, text) from public, anon, authenticated, service_role;
