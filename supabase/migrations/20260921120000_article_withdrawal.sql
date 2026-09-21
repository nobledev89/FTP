-- Phase 12 — article withdrawal.
--
-- Articles are never deleted (guard_article_write), but until now nothing could take one down: the
-- 'withdrawn' article status and the 'withdraw' state context existed without a writer. This adds
-- the one editorial operation that uses them.
--
-- Withdrawal acts on the published snapshot, not on the job's pipeline status. The job keeps its
-- PUBLISHED or VERIFIED history; the article leaves every public read because the RLS policies on
-- articles and slug aliases only expose 'published' and 'verified' rows. The slug stays reserved.

create function public.admin_withdraw_article(
  p_job_id uuid,
  p_expected_lock_version integer,
  p_reason text
)
returns table (slug text, withdrawn_at timestamptz, lock_version integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_member public.admin_users := private.require_editor();
  v_job public.article_jobs;
  v_article public.articles;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'a withdrawal reason of 3 to 500 characters is required' using errcode = '22023';
  end if;

  v_job := private.lock_job(p_job_id);
  if v_job.site_id <> v_member.site_id then
    raise exception 'job % belongs to another site', p_job_id using errcode = '42501';
  end if;
  if v_job.lock_version <> p_expected_lock_version then
    raise exception 'job % changed since it was loaded (lock_version % <> %)', p_job_id, v_job.lock_version,
      p_expected_lock_version using errcode = 'FT002';
  end if;
  if v_job.article_id is null or v_job.status not in ('PUBLISHED', 'VERIFIED') then
    raise exception 'job % has no published article to withdraw', p_job_id using errcode = 'FT001';
  end if;
  -- A live lease on a PUBLISHED job is a verification in flight. Letting it finish keeps
  -- record_verification from racing the withdrawal; the lease lasts seconds in practice.
  if v_job.lease_token is not null and v_job.lease_expires_at > now() then
    raise exception 'job % is being verified by worker %', p_job_id, v_job.lease_owner using errcode = 'FT003';
  end if;

  select * into v_article from public.articles where id = v_job.article_id for update;
  if v_article.status = 'withdrawn' then
    raise exception 'article % is already withdrawn', v_article.slug using errcode = 'FT001';
  end if;

  perform private.set_state_context('withdraw');
  update public.articles set status = 'withdrawn', withdrawn_at = now()
  where id = v_article.id
  returning * into v_article;

  -- A pending or exhausted verification of a withdrawn article can only fail, so it is cancelled
  -- along with any expired lease. The job then leaves the queue: PUBLISHED is claimed only while
  -- next_attempt_at is set.
  perform private.set_state_context('transition');
  update public.article_jobs set
    lease_owner = null, lease_token = null, lease_expires_at = null,
    attempt_count = 0, next_attempt_at = null,
    action_required_kind = null, action_required_message = null,
    action_required_run_id = null, action_required_at = null
  where id = p_job_id
  returning * into v_job;
  perform private.set_state_context('');

  perform private.append_job_event(
    p_job_id, 'article.withdrawn', v_job.status, v_job.status, 'admin', v_member.user_id::text,
    v_job.lock_version, v_reason,
    jsonb_build_object('article_id', v_article.id, 'slug', v_article.slug)
  );

  return query select v_article.slug, v_article.withdrawn_at, v_job.lock_version;
end;
$$;

grant execute on function public.admin_withdraw_article(uuid, integer, text) to authenticated;
