-- Discarding a job.
--
-- Topic discovery creates articles the editor did not ask for one by one, so the editor needs to
-- turn one down at any point before publication. DISCARDED is terminal: nothing leaves it, the
-- queue never claims it, and the job and every artifact stay as history. Published work is taken
-- down with admin_withdraw_article instead; PUBLISHING, PUBLISHED, and VERIFIED cannot be discarded.

alter table private.job_transitions drop constraint job_transitions_path_check;
alter table private.job_transitions add constraint job_transitions_path_check
  check (path in ('normal', 'pause', 'resume', 'failure', 'escalate', 'resolve', 'retry', 'recovery', 'discard'));

insert into private.job_transitions (from_status, to_status, path)
select s, 'DISCARDED', 'discard' from unnest(enum_range(null::public.job_status)) s
where private.is_pausable_status(s) or s in ('PAUSED', 'FAILED', 'NEEDS_HUMAN')
on conflict do nothing;

create function public.admin_discard_job(
  p_job_id uuid,
  p_expected_lock_version integer,
  p_reason text
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
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'a discard reason of 3 to 500 characters is required' using errcode = '22023';
  end if;

  v_job := private.lock_job(p_job_id);
  if v_job.site_id <> v_member.site_id then
    raise exception 'job % belongs to another site', p_job_id using errcode = '42501';
  end if;
  if v_job.lock_version <> p_expected_lock_version then
    raise exception 'job % changed since it was loaded (lock_version % <> %)', p_job_id, v_job.lock_version,
      p_expected_lock_version using errcode = 'FT002';
  end if;
  v_from := v_job.status;
  if not exists (
    select 1 from private.job_transitions t where t.from_status = v_from and t.to_status = 'DISCARDED'
  ) then
    raise exception '% jobs cannot be discarded', v_from using errcode = 'FT001';
  end if;
  -- A stage in flight finishes or is paused first, so its result is never written to a discarded job.
  if v_job.lease_token is not null and v_job.lease_expires_at > now() then
    raise exception 'job % is being worked on by worker %', p_job_id, v_job.lease_owner using errcode = 'FT003';
  end if;

  perform private.set_state_context('transition');
  update public.article_jobs j set
    status = 'DISCARDED',
    lease_owner = null, lease_token = null, lease_expires_at = null,
    next_attempt_at = null, paused_from_status = null,
    action_required_kind = null, action_required_message = null,
    action_required_run_id = null, action_required_at = null
  where j.id = p_job_id
  returning j.* into v_job;
  perform private.set_state_context('');

  perform private.append_job_event(
    p_job_id, 'job.discarded', v_from, 'DISCARDED', 'admin', v_member.user_id::text, v_job.lock_version,
    v_reason, jsonb_build_object('action', 'discard')
  );

  return query select v_job.status, v_job.lock_version;
end;
$$;

grant execute on function public.admin_discard_job(uuid, integer, text) to authenticated;
