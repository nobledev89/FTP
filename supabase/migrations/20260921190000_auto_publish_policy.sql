-- Automatic publication policy for discovered articles.
--
-- 20260921170000 added `discovery_auto_publish`, which let a discovered article go live the moment
-- its audit passed: immediately, however many had already gone out that day, and with no check that
-- the same story was already on the front page. This migration turns that switch into a policy and
-- turns it on by default. A discovered article publishes by itself only when all four hold:
--
--   1. it is complete     — a PASS audit over the approved draft (already enforced by the gates);
--   2. it has a hero      — a ready image in slot 0, so nothing goes out as a bare headline;
--   3. it is not a repeat — its headline does not restate an article already live or scheduled;
--   4. the day has room   — the publication's articles-per-day count is not already used up.
--
-- Articles that pass are spaced `auto_publish_spacing_minutes` apart (15 by default) rather than
-- published in a burst, so the front page fills through the day. An article that fails any check
-- keeps its place: `auto_publish` is cleared, `auto_publish_hold_reason` records why, and it waits
-- on the dashboard under "Needs your decision" exactly as it did before auto-publish existed.
--
-- The policy applies to `origin = 'discovery'` only. An editor who creates a job with auto-publish
-- has made that decision themselves, and "Publish now" on the dashboard is untouched: it goes
-- through `admin_transition_job` / `admin_reschedule_job`, which never consult this policy.

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

alter table public.site_settings
  add column auto_publish_spacing_minutes smallint not null default 15
    check (auto_publish_spacing_minutes between 5 and 240);

comment on column public.site_settings.auto_publish_spacing_minutes is
  'Minimum gap between two automatically published articles. Editor-driven publication ignores it.';

-- Automatic publication is now the default, guarded by the four checks above. An automatically
-- published article needs a hero image, so a publication set to "No image" is moved to one image
-- rather than left in a state where every article is held and the settings form cannot be saved.
alter table public.site_settings alter column discovery_auto_publish set default true;
update public.site_settings set
  discovery_auto_publish = true,
  discovery_image_count = greatest(discovery_image_count, 1);

comment on column public.site_settings.discovery_auto_publish is
  'When true, a discovered article publishes on its passing audit if it has a hero image, is not a repeat of a live story, and the day has room. Otherwise it waits for an editor.';

-- ---------------------------------------------------------------------------
-- 2. Why an article was held
-- ---------------------------------------------------------------------------

alter table public.article_jobs
  add column auto_publish_hold_reason text
    check (auto_publish_hold_reason is null
           or auto_publish_hold_reason in ('no_image', 'duplicate', 'daily_cap'));

comment on column public.article_jobs.auto_publish_hold_reason is
  'Set when automatic publication was declined for this article, so the console can say why.';

-- The reason is part of the workflow: only the state machine may write it.
create or replace function private.guard_article_job()
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
       or new.approved_draft_id is not null or new.approved_audit_id is not null
       or new.auto_publish_hold_reason is not null then
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
    new.created_by, new.created_at, new.auto_publish_hold_reason
  ) is distinct from (
    old.site_id, old.lock_version, old.attempt_count, old.max_attempts, old.revision_count, old.next_attempt_at,
    old.lease_owner, old.lease_token, old.lease_expires_at, old.action_required_kind, old.action_required_message,
    old.action_required_run_id, old.action_required_at, old.paused_from_status, old.failed_stage,
    old.failure_summary, old.needs_human_stage, old.approved_draft_id, old.approved_audit_id, old.article_id,
    old.created_by, old.created_at, old.auto_publish_hold_reason
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

-- ---------------------------------------------------------------------------
-- 3. Recognising the same story twice
-- ---------------------------------------------------------------------------

-- Two headlines about one story share their distinctive words. Tokens shorter than four characters
-- and the ordinary connective words carry no story, so they are dropped; what is left is compared
-- as a set. This is deliberately cheap and explainable: no extension, no embedding, no ranking
-- model. It catches "Revolut wins its UK banking licence" against "Revolut granted UK banking
-- licence" and leaves genuinely different Revolut stories alone.
create function private.editorial_tokens(p_text text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct token order by token), '{}'::text[])
  from unnest(
    string_to_array(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g'), ' ')
  ) as token
  where char_length(token) >= 4
    and token <> all (array[
      'about','after','again','against','amid','among','around','because','been','before','being',
      'between','both','could','does','down','during','each','from','further','have','here','into',
      'more','most','other','over','same','should','some','such','than','that','their','them',
      'then','there','these','they','this','those','through','under','until','very','were','what',
      'when','where','which','while','will','with','would','your','says','said','week','year',
      'years','news','report','reports'
    ]);
$$;

-- Jaccard overlap of two token sets. Headlines with fewer than three distinctive words are never
-- called duplicates: there is not enough of them to be sure.
create function private.token_similarity(p_left text[], p_right text[])
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_left is null or p_right is null
      or cardinality(p_left) < 3 or cardinality(p_right) < 3 then 0
    else (select count(*)::numeric from (select unnest(p_left) intersect select unnest(p_right)) s)
       / (select count(*)::numeric from (select unnest(p_left) union select unnest(p_right)) u)
  end;
$$;

-- The headline of an existing story that `p_headline` restates, or null when it is new.
--
-- `p_committed_only` chooses the field of comparison. Automatic publication compares against what
-- readers can already see or are about to see, so a story whose twin was abandoned mid-pipeline
-- still runs. Discovery compares against everything in flight as well, because writing the second
-- copy at all is the waste worth avoiding.
create function private.duplicate_headline(
  p_site_id uuid,
  p_job_id uuid,
  p_headline text,
  p_within interval,
  p_committed_only boolean
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with subject as (select private.editorial_tokens(p_headline) as tokens),
  candidate as (
    select a.title as label, private.editorial_tokens(a.title) as tokens
    from public.articles a
    where a.site_id = p_site_id
      and a.status in ('published', 'verified')
      and a.published_at > now() - p_within
    union all
    select coalesce(d.title, j.topic), private.editorial_tokens(coalesce(d.title, j.topic))
    from public.article_jobs j
    left join public.drafts d on d.id = j.approved_draft_id
    where j.site_id = p_site_id
      and j.id is distinct from p_job_id
      and j.created_at > now() - p_within
      and case
            when p_committed_only
              then j.status in ('APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'VERIFIED')
            else j.status not in ('FAILED', 'DISCARDED')
          end
  )
  -- 0.6 of the distinctive words in common. Holding an article costs an editor one click and
  -- publishing a second copy of a story costs the publication's credibility, so the threshold
  -- leans towards asking: "FCA fines Barclays over Qatar deal" and "FCA fines Barclays over Qatar
  -- fundraising" share 0.6, and two unrelated Monzo stories share about 0.1.
  select candidate.label
  from subject, candidate
  where private.token_similarity(subject.tokens, candidate.tokens) >= 0.6
  order by private.token_similarity(subject.tokens, candidate.tokens) desc, candidate.label
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. The policy itself
-- ---------------------------------------------------------------------------

-- Decides when, or whether, a discovered article publishes on its own.
--
-- `publish_at` is the first free slot: now, or one spacing interval after the most recent
-- publication or pending schedule, whichever is later. `hold_reason` is set instead when the
-- article fails a check, and the caller leaves it for an editor.
create function private.auto_publish_plan(p_job public.article_jobs)
returns table (publish_at timestamptz, hold_reason text, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_site public.sites;
  v_settings public.site_settings;
  v_now timestamptz := now();
  v_headline text;
  v_duplicate text;
  v_latest timestamptz;
  v_at timestamptz;
  v_cap integer;
  v_planned integer;
begin
  select * into v_site from public.sites where id = p_job.site_id;
  select * into v_settings from public.site_settings where site_id = p_job.site_id;

  -- 1 and 2. Complete, with a hero. The approved draft and its PASS audit are already guaranteed
  -- by the APPROVED gate; the image is not, because a job may be created asking for none.
  if not exists (
    select 1 from public.images i
    where i.job_id = p_job.id and i.slot = 0 and i.status in ('ready', 'published')
  ) then
    return query select null::timestamptz, 'no_image'::text, null::text;
    return;
  end if;

  -- 3. Not a story readers already have.
  select d.title into v_headline from public.drafts d where d.id = p_job.approved_draft_id;
  v_duplicate := private.duplicate_headline(
    p_job.site_id, p_job.id, coalesce(v_headline, p_job.topic), interval '30 days', true
  );
  if v_duplicate is not null then
    return query select null::timestamptz, 'duplicate'::text, v_duplicate;
    return;
  end if;

  -- The next free slot, one spacing interval clear of everything recent or pending.
  select max(slot.at) into v_latest
  from (
    select a.published_at as at from public.articles a
    where a.site_id = p_job.site_id and a.status in ('published', 'verified')
      and a.published_at > v_now - interval '2 days'
    union all
    select j.desired_publish_at from public.article_jobs j
    where j.site_id = p_job.site_id and j.id <> p_job.id
      and j.status in ('APPROVED', 'SCHEDULED', 'PUBLISHING')
      and j.desired_publish_at is not null
      and j.desired_publish_at > v_now - interval '2 days'
  ) slot;
  v_at := greatest(
    v_now,
    coalesce(v_latest + make_interval(mins => v_settings.auto_publish_spacing_minutes), v_now)
  );

  -- 4. Room on the day this article would actually appear, which is not always today.
  v_cap := (
    select coalesce(sum(c.daily_target), 0)::integer from public.topic_categories c
    where c.site_id = p_job.site_id
  );
  v_planned := (
    select count(*) from (
      select a.published_at as at from public.articles a
      where a.site_id = p_job.site_id and a.status in ('published', 'verified')
      union all
      -- An APPROVED job that is auto-publishing with a time on it is one poll from going live,
      -- so it takes up a place on its day exactly as a scheduled one does.
      select j.desired_publish_at from public.article_jobs j
      where j.site_id = p_job.site_id and j.id <> p_job.id
        and j.desired_publish_at is not null
        and (j.status in ('SCHEDULED', 'PUBLISHING')
             or (j.status = 'APPROVED' and j.auto_publish))
    ) slot
    where (slot.at at time zone v_site.timezone)::date = (v_at at time zone v_site.timezone)::date
  );
  if v_planned >= v_cap then
    return query select null::timestamptz, 'daily_cap'::text,
      format('%s of %s articles for that day', v_planned, v_cap);
    return;
  end if;

  return query select v_at, null::text, null::text;
end;
$$;

revoke execute on function
  private.editorial_tokens(text),
  private.token_similarity(text[], text[]),
  private.duplicate_headline(uuid, uuid, text, interval, boolean),
  private.auto_publish_plan(public.article_jobs)
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Applying the policy when an audit passes
-- ---------------------------------------------------------------------------

-- Unchanged from 20260917100300 except for the block marked below: a discovered article that has
-- just been approved is given its slot, or held with a reason, before the automatic follow-on
-- transitions run. The existing APPROVED -> SCHEDULED rule then picks up the slot, so the
-- transition map is untouched.
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
  v_next public.job_status;
  v_audit public.audits;
  v_draft_id uuid;
  v_publish_at timestamptz;
  v_hold_reason text;
  v_hold_detail text;
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

  -- Automatic publication policy (20260921190000). Discovered articles only: an editor's own job
  -- keeps whatever schedule the editor gave it.
  if p_to = 'APPROVED' and v_job.auto_publish and v_job.origin = 'discovery' then
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

-- ---------------------------------------------------------------------------
-- 6. Not writing the same story twice
-- ---------------------------------------------------------------------------

-- Unchanged from 20260921170000 except for the headline check marked below. The URL check catches
-- the same report twice; this catches the same story told by two outlets, which is what the URL
-- check misses and what fills a front page with near-identical articles.
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
     or char_length(v_headline) not between 3 and 300 then
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

  -- The same story from a second outlet, or in a second category (20260921190000).
  if private.duplicate_headline(
       v_run.site_id, null, v_topic || ' ' || v_headline, interval '30 days', false
     ) is not null then
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
      'headline', left(v_headline, 300),
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

-- ---------------------------------------------------------------------------
-- 7. Settings the owner can reach
-- ---------------------------------------------------------------------------

-- Replaced rather than overloaded, for the reason given in 20260921170000: an omitted argument
-- must keep the stored value, not pick a second signature.
drop function public.admin_update_discovery_settings(boolean, integer, integer, boolean);

create function public.admin_update_discovery_settings(
  p_enabled boolean,
  p_interval_minutes integer,
  p_image_count integer,
  p_auto_publish boolean default null,
  p_spacing_minutes integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
  v_auto_publish boolean;
begin
  if p_interval_minutes not between 15 and 720 or p_image_count not between 0 and 1 then
    raise exception 'scan every 15 to 720 minutes, with 0 or 1 image per article' using errcode = '22023';
  end if;
  if p_spacing_minutes is not null and p_spacing_minutes not between 5 and 240 then
    raise exception 'space automatic articles 5 to 240 minutes apart' using errcode = '22023';
  end if;

  select coalesce(p_auto_publish, s.discovery_auto_publish) into v_auto_publish
  from public.site_settings s where s.site_id = v_member.site_id;

  -- An automatically published article needs a hero image, so the two settings cannot disagree:
  -- otherwise every discovered article would be held and nothing would ever say why.
  if v_auto_publish and p_image_count = 0 then
    raise exception 'automatic publishing needs a hero image: choose one image per article, or turn automatic publishing off'
      using errcode = '22023';
  end if;

  update public.site_settings set
    discovery_enabled = coalesce(p_enabled, false),
    discovery_interval_minutes = p_interval_minutes,
    discovery_image_count = p_image_count,
    discovery_auto_publish = v_auto_publish,
    auto_publish_spacing_minutes = coalesce(p_spacing_minutes, auto_publish_spacing_minutes),
    updated_by = v_member.user_id
  where site_id = v_member.site_id;
end;
$$;

grant execute on function
  public.admin_update_discovery_settings(boolean, integer, integer, boolean, integer)
to authenticated;
