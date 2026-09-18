-- Phase 8: manual subscription-provider workflows.
--
-- The local worker prepares and snapshots a prompt, then releases its lease through
-- request_manual_action. These functions are the only authenticated continuation boundary. They
-- re-authorize the editor, lock the job and run, persist a normalized artifact, finish the run,
-- clear the action-required state, and advance the state machine in one transaction.

create function private.require_manual_run(
  p_job_id uuid,
  p_run_id uuid,
  p_expected_stage public.pipeline_stage default null
)
returns public.provider_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
  v_job public.article_jobs;
  v_run public.provider_runs;
begin
  v_job := private.lock_job(p_job_id);
  if v_job.site_id is distinct from v_member.site_id then
    raise exception 'job % is not in the editor publication', p_job_id using errcode = '42501';
  end if;

  select * into v_run
  from public.provider_runs r
  where r.id = p_run_id and r.job_id = p_job_id
  for update;
  if v_run.id is null then
    raise exception 'provider run % was not found for job %', p_run_id, p_job_id using errcode = 'P0002';
  end if;
  if v_run.status <> 'action_required' then
    raise exception 'manual run % is already %; accepted output: %',
      p_run_id, v_run.status, coalesce(v_run.output_ref, '{}'::jsonb)::text
      using errcode = 'FT004';
  end if;
  if v_job.action_required_kind is distinct from 'manual_input'
     or v_job.action_required_run_id is distinct from p_run_id
     or v_job.lease_token is not null then
    raise exception 'job % is not waiting for this manual run', p_job_id using errcode = 'FT002';
  end if;
  if private.stage_for_status(v_job.status) is distinct from v_run.stage then
    raise exception 'run stage % does not match job status %', v_run.stage, v_job.status using errcode = 'FT001';
  end if;
  if p_expected_stage is not null and v_run.stage is distinct from p_expected_stage then
    raise exception 'expected a % manual run, received %', p_expected_stage, v_run.stage using errcode = '22023';
  end if;
  if v_run.mode not in ('manual_chatgpt', 'manual_claude', 'manual_gemini') then
    raise exception 'run % is not a manual provider run', p_run_id using errcode = '22023';
  end if;
  if private.mode_for_stage(v_job, v_run.stage) is distinct from v_run.mode then
    raise exception 'run mode no longer matches the job snapshot' using errcode = 'FT002';
  end if;
  return v_run;
end;
$$;

create function public.admin_import_manual_result(
  p_job_id uuid,
  p_run_id uuid,
  p_output jsonb
)
returns table (
  imported_stage public.pipeline_stage,
  artifact_id uuid,
  artifact_version integer,
  job_status public.job_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
  v_job public.article_jobs;
  v_run public.provider_runs;
  v_artifact_id uuid;
  v_version integer;
  v_research_id uuid;
  v_parent_draft_id uuid;
  v_audit_id uuid;
  v_claim_id uuid;
  v_source_id uuid;
  v_source_refs jsonb := '[]'::jsonb;
  v_source jsonb;
  v_claim jsonb;
  v_evidence jsonb;
  v_to public.job_status;
  v_note text;
  v_metadata jsonb;
begin
  v_run := private.require_manual_run(p_job_id, p_run_id);
  v_job := private.lock_job(p_job_id);

  if v_run.stage = 'images' or v_run.stage in ('publish', 'verify') then
    raise exception 'stage % does not accept a JSON-only manual result', v_run.stage using errcode = '22023';
  end if;
  if p_output is null or pg_catalog.jsonb_typeof(p_output) <> 'object'
     or pg_catalog.pg_column_size(p_output) > 1000000 then
    raise exception 'manual output must be a JSON object no larger than 1 MB' using errcode = '22023';
  end if;

  -- The console validates the full artifact schema first. These checks keep a direct RPC call from
  -- storing a packet the pipeline cannot use, and add the one rule the schema cannot know: a draft
  -- must brief every image slot this job requested, or the image step could never complete.
  if v_run.stage = 'research' and (
       pg_catalog.jsonb_typeof(p_output->'sources') is distinct from 'array'
       or pg_catalog.jsonb_array_length(p_output->'sources') = 0
       or pg_catalog.jsonb_typeof(p_output->'claims') is distinct from 'array'
     ) then
    raise exception 'a research packet needs a sources array with at least one entry and a claims array'
      using errcode = '22023';
  end if;
  if v_run.stage in ('draft', 'revision') and (
       pg_catalog.jsonb_typeof(coalesce(p_output->'imageBriefs', '[]'::jsonb)) <> 'array'
       or (
         select count(distinct brief->>'slot')
         from pg_catalog.jsonb_array_elements(coalesce(p_output->'imageBriefs', '[]'::jsonb)) brief
         where brief->>'slot' ~ '^[0-9]$' and (brief->>'slot')::integer < v_job.image_count
       ) <> v_job.image_count
     ) then
    raise exception 'the draft must include an image brief for each of the % requested image slots (0 to %)',
      v_job.image_count, greatest(v_job.image_count - 1, 0)
      using errcode = '22023';
  end if;
  if v_run.stage = 'audit' and pg_catalog.jsonb_typeof(p_output->'findings') is distinct from 'array' then
    raise exception 'an audit needs a findings array' using errcode = '22023';
  end if;

  if v_run.stage = 'research' then
    select coalesce(max(r.version), 0) + 1 into v_version
    from public.research_packets r where r.job_id = p_job_id;

    insert into public.research_packets
      (job_id, version, packet, summary, provider_run_id, prompt_template_id, prompt_version,
       schema_version, validation_status, reviewed_by, reviewed_at)
    values
      (p_job_id, v_version, p_output,
       left(pg_catalog.concat_ws(E'\n', p_output->>'topicInterpretation', p_output->>'angle'), 5000),
       p_run_id, v_run.prompt_template_id, v_run.prompt_version, v_run.schema_version, 'valid',
       v_member.user_id, now())
    returning id into v_artifact_id;

    for v_source in select value from pg_catalog.jsonb_array_elements(p_output->'sources') loop
      insert into public.sources
        (job_id, research_packet_id, source_key, url, title, publisher, published_on, source_type,
         quality, jurisdiction, accessed_at, excerpt, is_private)
      values
        (p_job_id, v_artifact_id, v_source->>'sourceKey', v_source->>'url', v_source->>'title',
         v_source->>'publisher', nullif(v_source->>'publishedOn', '')::date,
         (v_source->>'sourceType')::public.source_type,
         (v_source->>'quality')::public.source_quality, v_source->>'jurisdiction',
         (v_source->>'accessedAt')::timestamptz, v_source->>'excerpt',
         coalesce((v_source->>'isPrivate')::boolean, false));
    end loop;

    for v_claim in select value from pg_catalog.jsonb_array_elements(p_output->'claims') loop
      insert into public.claims
        (job_id, research_packet_id, claim_key, text, status, confidence, jurisdiction,
         effective_date, as_of_date, entities, notes)
      values
        (p_job_id, v_artifact_id, v_claim->>'claimKey', v_claim->>'text',
         (v_claim->>'status')::public.claim_status, nullif(v_claim->>'confidence', '')::numeric,
         v_claim->>'jurisdiction', nullif(v_claim->>'effectiveDate', '')::date,
         nullif(v_claim->>'asOfDate', '')::date,
         array(select value from pg_catalog.jsonb_array_elements_text(coalesce(v_claim->'entities', '[]'::jsonb))),
         v_claim->>'notes')
      returning id into v_claim_id;

      for v_evidence in select value from pg_catalog.jsonb_array_elements(v_claim->'evidence') loop
        select s.id into v_source_id
        from public.sources s
        where s.research_packet_id = v_artifact_id
          and s.source_key = v_evidence->>'sourceKey';
        if v_source_id is null then
          raise exception 'claim evidence references unknown source key %', v_evidence->>'sourceKey'
            using errcode = '22023';
        end if;
        insert into public.claim_sources (claim_id, source_id, research_packet_id, relation, locator)
        values (v_claim_id, v_source_id, v_artifact_id,
                (v_evidence->>'relation')::public.evidence_relation, v_evidence->>'locator')
        on conflict (claim_id, source_id) do nothing;
      end loop;
    end loop;

    v_to := 'RESEARCH_COMPLETE';
    v_note := pg_catalog.format('Manual research packet v%s imported', v_version);
    v_metadata := pg_catalog.jsonb_build_object(
      'research_packet_id', v_artifact_id,
      'version', v_version,
      'sources', pg_catalog.jsonb_array_length(p_output->'sources'),
      'claims', pg_catalog.jsonb_array_length(p_output->'claims')
    );

  elsif v_run.stage in ('draft', 'revision') then
    select r.id into v_research_id
    from public.research_packets r
    where r.job_id = p_job_id and r.validation_status = 'valid'
    order by r.version desc limit 1;
    if v_research_id is null then
      raise exception 'a valid research packet is required' using errcode = 'FT005';
    end if;

    if v_run.stage = 'revision' then
      select d.id into v_parent_draft_id
      from public.drafts d
      where d.job_id = p_job_id and d.validation_status = 'valid'
      order by d.version desc limit 1;
      select a.id into v_audit_id
      from public.audits a where a.job_id = p_job_id order by a.version desc limit 1;
      if v_parent_draft_id is null or v_audit_id is null then
        raise exception 'a revision requires an existing draft and audit' using errcode = 'FT005';
      end if;
    end if;

    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s.id::text) order by refs.ordinality), '[]'::jsonb)
    into v_source_refs
    from pg_catalog.jsonb_array_elements_text(coalesce(p_output->'sourceReferences', '[]'::jsonb))
      with ordinality as refs(source_key, ordinality)
    join public.sources s
      on s.research_packet_id = v_research_id and s.source_key = refs.source_key and not s.is_private;

    select coalesce(max(d.version), 0) + 1 into v_version
    from public.drafts d where d.job_id = p_job_id;
    insert into public.drafts
      (job_id, version, origin, parent_draft_id, research_packet_id, responds_to_audit_id,
       title, slug, excerpt, body_markdown, meta_title, meta_description, category,
       internal_links, image_briefs, source_refs, provider_run_id, prompt_template_id,
       prompt_version, schema_version, validation_status, reviewed_by, reviewed_at)
    values
      (p_job_id, v_version, 'provider', v_parent_draft_id, v_research_id, v_audit_id,
       p_output->>'title', p_output->>'slug', p_output->>'excerpt', p_output->>'bodyMarkdown',
       p_output->>'metaTitle', p_output->>'metaDescription', p_output->>'category',
       coalesce(p_output->'internalLinks', '[]'::jsonb), coalesce(p_output->'imageBriefs', '[]'::jsonb),
       v_source_refs, p_run_id, v_run.prompt_template_id, v_run.prompt_version,
       v_run.schema_version, 'valid', v_member.user_id, now())
    returning id into v_artifact_id;

    v_to := (case when v_run.stage = 'revision' then 'RE_AUDIT_PENDING' else 'DRAFT_COMPLETE' end)::public.job_status;
    v_note := case when v_run.stage = 'revision'
      then pg_catalog.format('Manual revised draft v%s imported', v_version)
      else pg_catalog.format('Manual draft v%s imported: %s', v_version, p_output->>'title') end;
    v_metadata := pg_catalog.jsonb_build_object(
      'draft_id', v_artifact_id, 'version', v_version, 'slug', p_output->>'slug',
      'image_briefs', pg_catalog.jsonb_array_length(coalesce(p_output->'imageBriefs', '[]'::jsonb))
    ) || case when v_audit_id is not null
      then pg_catalog.jsonb_build_object('responds_to_audit_id', v_audit_id)
      else '{}'::jsonb end;

  elsif v_run.stage = 'audit' then
    select d.id into v_parent_draft_id
    from public.drafts d
    where d.job_id = p_job_id and d.validation_status = 'valid'
    order by d.version desc limit 1;
    if v_parent_draft_id is null then
      raise exception 'a valid draft is required' using errcode = 'FT005';
    end if;

    select coalesce(max(a.version), 0) + 1 into v_version
    from public.audits a where a.job_id = p_job_id;
    insert into public.audits
      (job_id, version, draft_id, cycle, verdict, findings, summary, provider_run_id,
       prompt_template_id, prompt_version, schema_version, reviewed_by, reviewed_at)
    values
      (p_job_id, v_version, v_parent_draft_id, v_job.revision_count,
       (p_output->>'verdict')::public.audit_verdict, p_output->'findings', p_output->>'summary',
       p_run_id, v_run.prompt_template_id, v_run.prompt_version, v_run.schema_version,
       v_member.user_id, now())
    returning id into v_artifact_id;

    v_to := (case
      when p_output->>'verdict' = 'PASS' then 'APPROVED'
      when p_output->>'verdict' = 'REVISION_REQUIRED' and v_job.revision_count < 2 then 'REVISION_REQUIRED'
      else 'NEEDS_HUMAN'
    end)::public.job_status;
    v_note := case
      when p_output->>'verdict' = 'REVISION_REQUIRED' and v_job.revision_count >= 2
        then pg_catalog.format('Manual audit v%s still requires revision after %s cycles; an editor has to decide.',
                               v_version, v_job.revision_count)
      when p_output->>'verdict' = 'NEEDS_HUMAN'
        then left(pg_catalog.format('Manual audit v%s escalated: %s', v_version, p_output->>'summary'), 2000)
      else pg_catalog.format('Manual audit v%s: %s', v_version, p_output->>'verdict')
    end;
    v_metadata := pg_catalog.jsonb_build_object(
      'audit_id', v_artifact_id, 'version', v_version, 'verdict', p_output->>'verdict',
      'findings', pg_catalog.jsonb_array_length(p_output->'findings'), 'cycle', v_job.revision_count
    );
  else
    raise exception 'unsupported manual stage %', v_run.stage using errcode = '22023';
  end if;

  update public.provider_runs r set
    status = 'succeeded', finished_at = now(), output_ref = v_metadata,
    error_class = null, error_summary = null, retryable = null
  where r.id = p_run_id and r.status = 'action_required';
  if not found then
    raise exception 'manual run % was completed concurrently', p_run_id using errcode = 'FT002';
  end if;

  v_job := private.complete_stage_core(
    v_job, v_to, 'admin', v_member.user_id::text, v_note,
    v_metadata || pg_catalog.jsonb_build_object('provider_run_id', p_run_id, 'manual_import', true)
  );

  return query select v_run.stage, v_artifact_id, v_version, v_job.status;
end;
$$;

create function public.admin_import_manual_image(
  p_job_id uuid,
  p_run_id uuid,
  p_slot integer,
  p_metadata jsonb,
  p_private_path text,
  p_mime_type text,
  p_byte_size integer,
  p_content_hash text,
  p_width integer,
  p_height integer
)
returns table (image_id uuid, image_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
  v_job public.article_jobs;
  v_run public.provider_runs;
  v_id uuid;
  v_version integer;
begin
  v_run := private.require_manual_run(p_job_id, p_run_id, 'images');
  v_job := private.lock_job(p_job_id);
  if v_run.mode <> 'manual_gemini' then
    raise exception 'manual image imports require manual_gemini mode' using errcode = '22023';
  end if;
  if p_slot is null or p_slot < 0 or p_slot >= v_job.image_count then
    raise exception 'image slot % was not requested', p_slot using errcode = '22023';
  end if;
  if p_metadata is null or pg_catalog.jsonb_typeof(p_metadata) <> 'object'
     or (p_metadata->>'role') is distinct from (case when p_slot = 0 then 'hero' else 'supporting' end)
     or char_length(btrim(coalesce(p_metadata->>'altText', ''))) = 0 then
    raise exception 'image metadata is invalid for slot %', p_slot using errcode = '22023';
  end if;
  if p_private_path !~ ('^jobs/' || p_job_id::text || '/[A-Za-z0-9._/-]+$')
     or position('..' in p_private_path) > 0 then
    raise exception 'private image path is outside this job' using errcode = '22023';
  end if;
  if p_mime_type not in ('image/png', 'image/jpeg', 'image/webp', 'image/avif')
     or p_byte_size not between 1 and 10485760
     or p_content_hash !~ '^[a-f0-9]{64}$'
     or p_width not between 1 and 20000 or p_height not between 1 and 20000 then
    raise exception 'uploaded image file metadata is invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'article-work' and o.name = p_private_path
  ) then
    raise exception 'uploaded image object was not found' using errcode = 'P0002';
  end if;
  -- The console measures the bytes it uploads; the stored object must agree with that record.
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'article-work' and o.name = p_private_path
      and o.metadata->>'size' = p_byte_size::text
      and o.metadata->>'mimetype' = p_mime_type
  ) then
    raise exception 'the recorded size or type does not match the uploaded object' using errcode = '22023';
  end if;

  select coalesce(max(i.version), 0) + 1 into v_version
  from public.images i where i.job_id = p_job_id and i.slot = p_slot;
  insert into public.images
    (job_id, slot, version, role, purpose, prompt, alt_text, caption, aspect_ratio,
     focal_x, focal_y, width, height, mime_type, byte_size, content_hash, status,
     private_path, provider_run_id, reviewed_by, reviewed_at)
  values
    (p_job_id, p_slot, v_version, (p_metadata->>'role')::public.image_role,
     p_metadata->>'purpose', p_metadata->>'prompt', p_metadata->>'altText',
     p_metadata->>'caption', p_metadata->>'aspectRatio',
     nullif(p_metadata->>'focalX', '')::numeric, nullif(p_metadata->>'focalY', '')::numeric,
     p_width, p_height, p_mime_type, p_byte_size, p_content_hash, 'ready', p_private_path,
     p_run_id, v_member.user_id, now())
  returning id into v_id;

  perform private.append_job_event(
    p_job_id, 'manual.image_imported', v_job.status, v_job.status, 'admin',
    v_member.user_id::text, v_job.lock_version,
    pg_catalog.format('Manual image slot %s v%s uploaded', p_slot, v_version),
    pg_catalog.jsonb_build_object('provider_run_id', p_run_id, 'image_id', v_id,
                                  'slot', p_slot, 'version', v_version)
  );
  return query select v_id, v_version;
end;
$$;

create function public.admin_complete_manual_images(p_job_id uuid, p_run_id uuid)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
  v_job public.article_jobs;
  v_ready integer;
  v_output jsonb;
begin
  perform private.require_manual_run(p_job_id, p_run_id, 'images');
  v_job := private.lock_job(p_job_id);

  select count(distinct i.slot)::integer into v_ready
  from public.images i
  where i.job_id = p_job_id and i.provider_run_id = p_run_id
    and i.slot < v_job.image_count and i.status in ('ready', 'published');
  if v_ready <> v_job.image_count then
    raise exception '% of % requested image slots are ready', v_ready, v_job.image_count using errcode = 'FT005';
  end if;

  select pg_catalog.jsonb_build_object(
    'images', count(*),
    'slots', coalesce(pg_catalog.jsonb_agg(latest.slot order by latest.slot), '[]'::jsonb)
  ) into v_output
  from (
    select distinct on (i.slot) i.slot
    from public.images i
    where i.job_id = p_job_id and i.provider_run_id = p_run_id
      and i.slot < v_job.image_count and i.status in ('ready', 'published')
    order by i.slot, i.version desc
  ) latest;

  update public.provider_runs r set
    status = 'succeeded', finished_at = now(), output_ref = v_output,
    error_class = null, error_summary = null, retryable = null
  where r.id = p_run_id and r.status = 'action_required';
  if not found then
    raise exception 'manual run % was completed concurrently', p_run_id using errcode = 'FT002';
  end if;

  v_job := private.complete_stage_core(
    v_job, 'AUDIT_PENDING', 'admin', v_member.user_id::text,
    pg_catalog.format('%s manual images ready', v_ready),
    v_output || pg_catalog.jsonb_build_object('provider_run_id', p_run_id, 'manual_import', true)
  );
  return v_job.status;
end;
$$;

-- A manual run is finished by an import, or by leaving it: escalation and resolution clear the job's
-- action_required_run_id, and a later claim prepares a fresh prompt. Without this, the abandoned run
-- would read as "waiting for input" in the audit trail forever. Pausing keeps the run on the job, so
-- the same prompt is still available on resume.
create function private.cancel_superseded_manual_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.provider_runs r set
    status = 'cancelled',
    finished_at = now(),
    error_summary = 'The job left this manual step before a response was imported.'
  where r.id = old.action_required_run_id and r.status = 'action_required';
  return null;
end;
$$;

create trigger article_jobs_cancel_superseded_manual_run
  after update of action_required_run_id on public.article_jobs
  for each row
  when (old.action_required_run_id is not null
        and new.action_required_run_id is distinct from old.action_required_run_id)
  execute function private.cancel_superseded_manual_run();

-- Phase 8 exposes only modes that have real adapters. Draft and revision share the job's single
-- writing-mode snapshot, so changing the writing default keeps both setting rows in sync.
create function public.admin_update_provider_setting(
  p_stage public.pipeline_stage,
  p_mode public.provider_mode
)
returns table (updated_stage public.pipeline_stage, updated_mode public.provider_mode)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
begin
  if not (
    (p_stage in ('research', 'audit') and p_mode in ('mock', 'manual_chatgpt'))
    or (p_stage = 'draft' and p_mode in ('mock', 'manual_claude'))
    or (p_stage = 'images' and p_mode in ('mock', 'manual_gemini'))
  ) then
    raise exception 'mode % is not implemented for stage %', p_mode, p_stage using errcode = '22023';
  end if;

  insert into public.provider_settings as ps (site_id, stage, mode, updated_by)
  values (v_member.site_id, p_stage, p_mode, v_member.user_id)
  on conflict (site_id, stage) do update set mode = excluded.mode, updated_by = excluded.updated_by,
    api_mode_confirmed_at = null, api_mode_confirmed_by = null;

  if p_stage = 'draft' then
    insert into public.provider_settings as ps (site_id, stage, mode, updated_by)
    values (v_member.site_id, 'revision', p_mode, v_member.user_id)
    on conflict (site_id, stage) do update set mode = excluded.mode, updated_by = excluded.updated_by,
      api_mode_confirmed_at = null, api_mode_confirmed_by = null;
  end if;

  return query
    select ps.stage, ps.mode from public.provider_settings ps
    where ps.site_id = v_member.site_id
      and ps.stage = any (case when p_stage = 'draft'
        then array['draft', 'revision']::public.pipeline_stage[]
        else array[p_stage]::public.pipeline_stage[] end)
    order by ps.stage;
end;
$$;

revoke execute on function
  private.require_manual_run(uuid, uuid, public.pipeline_stage),
  private.cancel_superseded_manual_run()
from public, anon, authenticated, service_role;

grant execute on function
  public.admin_import_manual_result(uuid, uuid, jsonb),
  public.admin_import_manual_image(uuid, uuid, integer, jsonb, text, text, integer, text, integer, integer),
  public.admin_complete_manual_images(uuid, uuid),
  public.admin_update_provider_setting(public.pipeline_stage, public.provider_mode)
to authenticated, service_role;
