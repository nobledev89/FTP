-- Phase 11 — publishing, scheduling, and verification hardening.
--
-- Three changes, all on the publication boundary:
--   1. a schedule horizon guard, so a mistyped year cannot park a job in the queue forever;
--   2. record_revalidation, which gives the previously unused 'revalidate' log kind a writer so a
--      failed cache invalidation is visible instead of silent;
--   3. record_verification bounds the retry the worker asks for and names the checks that failed
--      when the attempts are exhausted.

-- ---------------------------------------------------------------------------
-- 1. Schedule horizon
-- ---------------------------------------------------------------------------

-- A schedule is only meaningful if a worker will ever claim it. Anything beyond a year is a typed
-- year, not an editorial decision, and it would otherwise sit claimable-never with no error.
create function private.guard_schedule_horizon()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.desired_publish_at is not null
     and (tg_op = 'INSERT' or new.desired_publish_at is distinct from old.desired_publish_at)
     and new.desired_publish_at > now() + interval '1 year' then
    raise exception 'desired_publish_at % is more than a year away', new.desired_publish_at
      using errcode = 'FT005';
  end if;
  return new;
end;
$$;

create trigger article_jobs_schedule_horizon
  before insert or update of desired_publish_at on public.article_jobs
  for each row execute function private.guard_schedule_horizon();

-- ---------------------------------------------------------------------------
-- 2. Cache revalidation logging
-- ---------------------------------------------------------------------------

-- Publication commits before the cache is invalidated (plan section 8.3 step 8), so a revalidation
-- failure must never roll the article back. It is recorded instead, and live verification remains
-- the backstop that decides whether readers can actually see the article.
create function public.record_revalidation(
  p_job_id uuid,
  p_worker_id text,
  p_outcome public.log_outcome,
  p_attempts integer default 1,
  p_http_status smallint default null,
  p_duration_ms integer default null,
  p_request_summary jsonb default '{}'::jsonb,
  p_error text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.article_jobs;
  v_id bigint;
begin
  -- Publication clears the lease before revalidation runs, so this is keyed on the published
  -- article rather than a lease token. Locking the job still serializes it against a concurrent
  -- publish attempt on the same job.
  v_job := private.lock_job(p_job_id);
  if v_job.article_id is null or v_job.status not in ('PUBLISHED', 'VERIFIED') then
    raise exception 'job % has no published article to revalidate', p_job_id using errcode = 'FT001';
  end if;
  if jsonb_typeof(coalesce(p_request_summary, '{}'::jsonb)) <> 'object' then
    raise exception 'request summary must be an object' using errcode = '22023';
  end if;

  insert into public.publishing_logs
    (job_id, article_id, kind, outcome, attempt, http_status, duration_ms, request_summary, error, worker_id)
  values
    (p_job_id, v_job.article_id, 'revalidate', p_outcome, greatest(coalesce(p_attempts, 1), 1),
     p_http_status, p_duration_ms, coalesce(p_request_summary, '{}'::jsonb),
     left(p_error, 2000), p_worker_id)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function
  public.record_revalidation(uuid, text, public.log_outcome, integer, smallint, integer, jsonb, text)
to service_role;

-- ---------------------------------------------------------------------------
-- 3. Bounded verification retries
-- ---------------------------------------------------------------------------

-- Replaces the Phase 2 definition. The behaviour is unchanged except that the worker's requested
-- retry time is clamped into a sane window and an exhausted job names the checks that failed.
create or replace function public.record_verification(
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
  v_max_retry constant interval := interval '1 hour';
  v_job public.article_jobs;
  v_check jsonb;
  v_name text;
  v_passed boolean := true;
  v_failed text[] := array[]::text[];
  v_attempt integer;
  v_retry_at timestamptz;
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
      v_failed := v_failed || v_name;
    end if;
  end loop;

  insert into public.publishing_logs (job_id, article_id, kind, outcome, attempt, result_summary, worker_id)
  values (p_job_id, v_job.article_id, 'verify_summary', case when v_passed then 'succeeded' else 'failed' end::public.log_outcome,
          greatest(v_attempt, 1),
          jsonb_build_object('checks', jsonb_array_length(p_checks), 'failed', to_jsonb(v_failed)), p_worker_id);

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
    -- The worker chooses the backoff, but a bad clock or argument must not park the job: the retry
    -- is clamped forward to now and no further out than an hour.
    v_retry_at := least(greatest(coalesce(p_retry_at, now() + interval '2 minutes'), now()), now() + v_max_retry);
    perform private.set_state_context('transition');
    update public.article_jobs set
      lease_owner = null, lease_token = null, lease_expires_at = null,
      next_attempt_at = case when v_attempt >= max_attempts then null else v_retry_at end,
      action_required_kind = case when v_attempt >= max_attempts then 'verification_failed'::public.action_required_kind end,
      action_required_message = case when v_attempt >= max_attempts
                                     then 'Live verification failed after ' || v_attempt || ' attempts: '
                                          || array_to_string(v_failed, ', ') end,
      action_required_at = case when v_attempt >= max_attempts then now() end
    where id = p_job_id
    returning * into v_job;
    perform private.set_state_context('');
    perform private.append_job_event(
      p_job_id, case when v_job.action_required_kind is not null then 'verification.exhausted' else 'verification.failed' end,
      'PUBLISHED', 'PUBLISHED', 'worker', p_worker_id, v_job.lock_version, null,
      jsonb_build_object('attempt', v_attempt, 'next_attempt_at', v_job.next_attempt_at, 'failed', to_jsonb(v_failed))
    );
  end if;

  update public.worker_instances set current_job_id = null, current_stage = null where worker_id = p_worker_id;
  return v_job.status;
end;
$$;
