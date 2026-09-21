-- Phase 13 — replacing the hero image of an article that is already published.
--
-- The published snapshot carries exactly one image (articles.hero_image), so this is a single-slot
-- operation. It deliberately does not re-enter the pipeline: the job keeps its PUBLISHED or
-- VERIFIED status and its approved draft and audit are untouched, exactly as admin_withdraw_article
-- acts on the snapshot rather than on the job. Only the picture changes.
--
-- The work is split between the console and the worker because it has to be. No browser role can
-- write to the article-public bucket and the web app is forbidden the service-role key, so the
-- bytes of a new hero can only be placed by the worker. The console therefore records the request
-- and the editorial decision; the worker draws, copies, and applies. This runs on its own lane,
-- like topic discovery, and never touches claim_next_job.
--
-- Image rows remain append-only. A replacement is a new version of slot 0, and the superseded row
-- keeps its own published path and history for good.

create type public.hero_replacement_mode as enum ('regenerate', 'upload');

-- pending          waiting for the worker (regenerate) or for the editor's file (upload)
-- drawing          the worker is generating a candidate
-- awaiting_review  a candidate exists and the editor has not decided
-- approved         the editor accepted it; the worker has still to publish the bytes
-- applying         the worker is copying and swapping
-- applied          the live article carries the new hero
-- rejected         the editor turned the candidate down
-- cancelled        the editor abandoned the request
-- failed           the worker could not produce or apply a candidate
create type public.hero_replacement_status as enum (
  'pending', 'drawing', 'awaiting_review', 'approved', 'applying', 'applied',
  'rejected', 'cancelled', 'failed'
);

create table public.hero_image_replacements (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete restrict,
  job_id uuid not null references public.article_jobs (id) on delete restrict,
  article_id uuid not null references public.articles (id) on delete restrict,
  mode public.hero_replacement_mode not null,
  status public.hero_replacement_status not null default 'pending',
  -- The editor's steer for this attempt. Null means "use the draft's brief as written".
  direction text check (char_length(direction) <= 2000),
  image_id uuid,
  provider_run_id uuid,
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 2000),
  worker_id text check (worker_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  started_at timestamptz,
  finished_at timestamptz,
  applied_at timestamptz,
  error_summary text check (char_length(error_summary) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (image_id, job_id) references public.images (id, job_id) on delete restrict,
  foreign key (provider_run_id, job_id) references public.provider_runs (id, job_id) on delete restrict,
  check (status <> 'applied' or (image_id is not null and applied_at is not null)),
  check (status <> 'failed' or error_summary is not null),
  check ((reviewed_at is null) = (reviewed_by is null))
);

-- One open request per job. A second "replace this image" is a mistake, not a queue.
create unique index hero_image_replacements_one_open_idx
  on public.hero_image_replacements (job_id)
  where status in ('pending', 'drawing', 'awaiting_review', 'approved', 'applying');

create index hero_image_replacements_worker_idx
  on public.hero_image_replacements (status, requested_at)
  where status in ('pending', 'approved');

create index hero_image_replacements_job_idx
  on public.hero_image_replacements (job_id, requested_at desc);

alter table public.hero_image_replacements enable row level security;

grant select on public.hero_image_replacements to authenticated;

create policy "Admins read hero image replacements"
  on public.hero_image_replacements for select
  to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- The article write guard learns one more caller.
-- ---------------------------------------------------------------------------

create or replace function private.guard_article_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'articles are withdrawn, never deleted' using errcode = 'FT004';
  end if;
  if private.state_context() not in ('publish', 'verify', 'withdraw', 'reimage') then
    raise exception 'articles are written only by the publishing service' using errcode = 'FT001';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create function private.lock_hero_replacement(p_id uuid)
returns public.hero_image_replacements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.hero_image_replacements;
begin
  select * into v_row from public.hero_image_replacements where id = p_id for update;
  if v_row.id is null then
    raise exception 'hero image replacement % was not found', p_id using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

-- Records a new version of slot 0 for the job and points the replacement at it.
create function private.record_hero_candidate(
  p_replacement public.hero_image_replacements,
  p_metadata jsonb,
  p_private_path text,
  p_mime_type text,
  p_byte_size integer,
  p_content_hash text,
  p_width integer,
  p_height integer,
  p_provider_run_id uuid
)
returns public.images
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
  v_image public.images;
begin
  if p_metadata is null or pg_catalog.jsonb_typeof(p_metadata) <> 'object'
     or char_length(btrim(coalesce(p_metadata->>'altText', ''))) = 0 then
    raise exception 'a replacement hero image needs alt text' using errcode = '22023';
  end if;
  if p_private_path !~ ('^jobs/' || p_replacement.job_id::text || '/[A-Za-z0-9._/-]+$')
     or position('..' in p_private_path) > 0 then
    raise exception 'private image path is outside this job' using errcode = '22023';
  end if;
  if p_mime_type not in ('image/png', 'image/jpeg', 'image/webp', 'image/avif')
     or p_byte_size not between 1 and 10485760
     or p_content_hash !~ '^[a-f0-9]{64}$'
     or p_width not between 1 and 20000 or p_height not between 1 and 20000 then
    raise exception 'replacement image file metadata is invalid' using errcode = '22023';
  end if;

  select coalesce(max(i.version), 0) + 1 into v_version
  from public.images i
  where i.job_id = p_replacement.job_id and i.slot = 0;

  insert into public.images (
    job_id, slot, version, role, purpose, prompt, alt_text, caption, aspect_ratio,
    focal_x, focal_y, width, height, mime_type, byte_size, content_hash,
    status, private_path, provider_run_id
  ) values (
    p_replacement.job_id, 0, v_version, 'hero',
    nullif(btrim(coalesce(p_metadata->>'purpose', '')), ''),
    nullif(btrim(coalesce(p_metadata->>'prompt', '')), ''),
    btrim(p_metadata->>'altText'),
    nullif(btrim(coalesce(p_metadata->>'caption', '')), ''),
    coalesce(nullif(p_metadata->>'aspectRatio', ''), '16:9'),
    (p_metadata->>'focalX')::numeric, (p_metadata->>'focalY')::numeric,
    p_width, p_height, p_mime_type, p_byte_size, p_content_hash,
    'ready', p_private_path, p_provider_run_id
  )
  returning * into v_image;

  update public.hero_image_replacements
  set image_id = v_image.id,
      provider_run_id = coalesce(p_provider_run_id, provider_run_id),
      status = 'awaiting_review',
      finished_at = now()
  where id = p_replacement.id;

  return v_image;
end;
$$;

-- ---------------------------------------------------------------------------
-- Console operations
-- ---------------------------------------------------------------------------

create function public.admin_request_hero_replacement(
  p_job_id uuid,
  p_expected_lock_version integer,
  p_mode public.hero_replacement_mode,
  p_direction text default null
)
returns table (replacement_id uuid, status public.hero_replacement_status)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_member public.admin_users := private.require_editor();
  v_job public.article_jobs;
  v_article public.articles;
  v_direction text := nullif(btrim(coalesce(p_direction, '')), '');
  v_row public.hero_image_replacements;
begin
  v_job := private.lock_job(p_job_id);
  if v_job.site_id <> v_member.site_id then
    raise exception 'job % belongs to another site', p_job_id using errcode = '42501';
  end if;
  if v_job.lock_version <> p_expected_lock_version then
    raise exception 'job % changed since it was loaded (lock_version % <> %)', p_job_id,
      v_job.lock_version, p_expected_lock_version using errcode = 'FT002';
  end if;
  if v_job.article_id is null or v_job.status not in ('PUBLISHED', 'VERIFIED') then
    raise exception 'job % has no published article', p_job_id using errcode = 'FT001';
  end if;
  if v_job.image_count < 1 then
    raise exception 'job % was published without a hero image', p_job_id using errcode = 'FT001';
  end if;

  select * into v_article from public.articles where id = v_job.article_id for update;
  if v_article.status = 'withdrawn' then
    raise exception 'article % is withdrawn', v_article.slug using errcode = 'FT001';
  end if;

  begin
    insert into public.hero_image_replacements
      (site_id, job_id, article_id, mode, direction, requested_by)
    values
      (v_job.site_id, p_job_id, v_article.id, p_mode, v_direction, v_member.user_id)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'job % already has an open hero image replacement', p_job_id using errcode = 'FT003';
  end;

  perform private.append_job_event(
    p_job_id, 'hero_image.replacement_requested', v_job.status, v_job.status, 'admin',
    v_member.user_id::text, v_job.lock_version, v_direction,
    jsonb_build_object('replacement_id', v_row.id, 'mode', p_mode)
  );

  return query select v_row.id, v_row.status;
end;
$$;

-- Upload mode: the editor produced the picture themselves and the console stored the bytes.
create function public.admin_attach_hero_replacement_image(
  p_replacement_id uuid,
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
  v_row public.hero_image_replacements;
  v_image public.images;
begin
  v_row := private.lock_hero_replacement(p_replacement_id);
  if v_row.site_id <> v_member.site_id then
    raise exception 'replacement % belongs to another site', p_replacement_id using errcode = '42501';
  end if;
  if v_row.mode <> 'upload' then
    raise exception 'replacement % is generated by the worker, not uploaded', p_replacement_id
      using errcode = 'FT001';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'replacement % is %, not pending', p_replacement_id, v_row.status
      using errcode = 'FT001';
  end if;
  -- The console measures the bytes it uploads; the stored object must agree with that record.
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'article-work' and o.name = p_private_path
      and o.metadata->>'size' = p_byte_size::text
      and o.metadata->>'mimetype' = p_mime_type
  ) then
    raise exception 'the uploaded object was not found, or its size or type does not match'
      using errcode = '22023';
  end if;

  v_image := private.record_hero_candidate(
    v_row, p_metadata, p_private_path, p_mime_type, p_byte_size, p_content_hash,
    p_width, p_height, null
  );

  return query select v_image.id, v_image.version;
end;
$$;

create function public.admin_review_hero_replacement(
  p_replacement_id uuid,
  p_approve boolean,
  p_note text default null
)
returns public.hero_replacement_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
  v_row public.hero_image_replacements;
  v_job public.article_jobs;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_status public.hero_replacement_status;
begin
  v_row := private.lock_hero_replacement(p_replacement_id);
  if v_row.site_id <> v_member.site_id then
    raise exception 'replacement % belongs to another site', p_replacement_id using errcode = '42501';
  end if;
  if v_row.status <> 'awaiting_review' then
    raise exception 'replacement % is %, not awaiting review', p_replacement_id, v_row.status
      using errcode = 'FT001';
  end if;

  v_status := case when p_approve then 'approved' else 'rejected' end::public.hero_replacement_status;

  update public.hero_image_replacements
  set status = v_status, reviewed_by = v_member.user_id, reviewed_at = now(), review_note = v_note
  where id = p_replacement_id
  returning * into v_row;

  -- A rejected candidate keeps its images row: it was really produced, and the history says so.
  select * into v_job from public.article_jobs where id = v_row.job_id;
  perform private.append_job_event(
    v_row.job_id,
    case when p_approve then 'hero_image.replacement_approved' else 'hero_image.replacement_rejected' end,
    v_job.status, v_job.status, 'admin', v_member.user_id::text, v_job.lock_version, v_note,
    jsonb_build_object('replacement_id', v_row.id, 'image_id', v_row.image_id)
  );

  return v_status;
end;
$$;

create function public.admin_cancel_hero_replacement(
  p_replacement_id uuid,
  p_note text default null
)
returns public.hero_replacement_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.admin_users := private.require_editor();
  v_row public.hero_image_replacements;
  v_job public.article_jobs;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  v_row := private.lock_hero_replacement(p_replacement_id);
  if v_row.site_id <> v_member.site_id then
    raise exception 'replacement % belongs to another site', p_replacement_id using errcode = '42501';
  end if;
  -- 'applying' is excluded: the worker is mid-swap and owns the row until it settles.
  if v_row.status not in ('pending', 'drawing', 'awaiting_review', 'approved') then
    raise exception 'replacement % is % and cannot be cancelled', p_replacement_id, v_row.status
      using errcode = 'FT001';
  end if;

  update public.hero_image_replacements
  set status = 'cancelled', reviewed_by = v_member.user_id, reviewed_at = now(), review_note = v_note
  where id = p_replacement_id;

  select * into v_job from public.article_jobs where id = v_row.job_id;
  perform private.append_job_event(
    v_row.job_id, 'hero_image.replacement_cancelled', v_job.status, v_job.status, 'admin',
    v_member.user_id::text, v_job.lock_version, v_note,
    jsonb_build_object('replacement_id', v_row.id)
  );

  return 'cancelled'::public.hero_replacement_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Worker lane
-- ---------------------------------------------------------------------------

-- Claims the oldest replacement that needs the worker: a 'pending' regenerate needs a picture
-- drawn, an 'approved' one needs its bytes published. Upload-mode rows stay in 'pending' until the
-- console attaches a file, so they are never claimed for drawing.
create function public.worker_claim_hero_replacement(p_worker_id text)
returns table (
  replacement_id uuid,
  work text,
  job_id uuid,
  article_id uuid,
  slug text,
  mode public.hero_replacement_mode,
  direction text,
  image_id uuid,
  image_private_path text,
  image_mime_type text,
  images_mode public.provider_mode,
  site_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_row public.hero_image_replacements;
  v_job public.article_jobs;
  v_article public.articles;
  v_image public.images;
  v_work text;
begin
  if p_worker_id !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'worker id is invalid' using errcode = '22023';
  end if;

  select r.* into v_row
  from public.hero_image_replacements r
  where (r.status = 'pending' and r.mode = 'regenerate') or r.status = 'approved'
  order by r.requested_at
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  v_work := case when v_row.status = 'approved' then 'apply' else 'draw' end;

  update public.hero_image_replacements r set
    status = case when v_work = 'apply' then 'applying' else 'drawing' end::public.hero_replacement_status,
    worker_id = p_worker_id,
    started_at = coalesce(r.started_at, now())
  where r.id = v_row.id
  returning * into v_row;

  select * into v_job from public.article_jobs where id = v_row.job_id;
  select * into v_article from public.articles where id = v_row.article_id;
  if v_row.image_id is not null then
    select * into v_image from public.images where id = v_row.image_id;
  end if;

  return query select
    v_row.id, v_work, v_row.job_id, v_row.article_id, v_article.slug, v_row.mode, v_row.direction,
    v_row.image_id, v_image.private_path, v_image.mime_type, v_job.images_mode, v_row.site_id;
end;
$$;

-- The worker drew a candidate and stored it privately; it now waits for the editor.
create function public.worker_record_hero_candidate(
  p_replacement_id uuid,
  p_worker_id text,
  p_metadata jsonb,
  p_private_path text,
  p_mime_type text,
  p_byte_size integer,
  p_content_hash text,
  p_width integer,
  p_height integer,
  p_provider_run_id uuid default null
)
returns table (image_id uuid, image_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.hero_image_replacements;
  v_image public.images;
begin
  v_row := private.lock_hero_replacement(p_replacement_id);
  if v_row.status <> 'drawing' or v_row.worker_id is distinct from p_worker_id then
    raise exception 'replacement % is not being drawn by %', p_replacement_id, p_worker_id
      using errcode = 'FT003';
  end if;

  v_image := private.record_hero_candidate(
    v_row, p_metadata, p_private_path, p_mime_type, p_byte_size, p_content_hash,
    p_width, p_height, p_provider_run_id
  );

  return query select v_image.id, v_image.version;
end;
$$;

-- Publishes the approved bytes and swaps the live hero.
--
-- The superseded image keeps its own row, its own public path, and its published_at. Only the
-- article's pointer moves, and content_updated_at records that the page changed.
create function public.worker_apply_hero_replacement(
  p_replacement_id uuid,
  p_worker_id text,
  p_public_path text
)
returns table (article_id uuid, slug text, public_path text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_row public.hero_image_replacements;
  v_job public.article_jobs;
  v_article public.articles;
  v_image public.images;
  v_now timestamptz := now();
begin
  v_row := private.lock_hero_replacement(p_replacement_id);
  if v_row.status <> 'applying' or v_row.worker_id is distinct from p_worker_id then
    raise exception 'replacement % is not being applied by %', p_replacement_id, p_worker_id
      using errcode = 'FT003';
  end if;
  if p_public_path !~ '^articles/' or position('..' in p_public_path) > 0 then
    raise exception 'invalid public image path' using errcode = '22023';
  end if;

  select * into v_image from public.images where id = v_row.image_id for update;
  if v_image.id is null or v_image.status not in ('ready', 'published') then
    raise exception 'replacement image % is not ready', v_row.image_id using errcode = 'FT005';
  end if;

  select * into v_article from public.articles where id = v_row.article_id for update;
  if v_article.status = 'withdrawn' then
    raise exception 'article % was withdrawn while the replacement was in flight', v_article.slug
      using errcode = 'FT001';
  end if;

  update public.images i set
    status = 'published',
    public_path = p_public_path,
    published_at = coalesce(i.published_at, v_now)
  where i.id = v_image.id
  returning * into v_image;

  perform private.set_state_context('reimage');
  update public.articles a set
    hero_image = jsonb_strip_nulls(jsonb_build_object(
      'path', v_image.public_path, 'alt', v_image.alt_text, 'caption', v_image.caption,
      'aspect_ratio', v_image.aspect_ratio, 'width', v_image.width, 'height', v_image.height,
      'focal_x', v_image.focal_x, 'focal_y', v_image.focal_y
    )),
    content_updated_at = v_now
  where a.id = v_article.id
  returning * into v_article;
  perform private.set_state_context('');

  update public.hero_image_replacements r set
    status = 'applied', applied_at = v_now, finished_at = v_now
  where r.id = p_replacement_id;

  select * into v_job from public.article_jobs where id = v_row.job_id;
  insert into public.publishing_logs
    (job_id, article_id, kind, outcome, request_summary, result_summary, worker_id)
  values
    (v_row.job_id, v_article.id, 'publish', 'succeeded',
     jsonb_build_object('replacement_id', p_replacement_id, 'image_id', v_image.id, 'slot', 0),
     jsonb_build_object('public_path', v_image.public_path, 'slug', v_article.slug), p_worker_id);

  perform private.append_job_event(
    v_row.job_id, 'hero_image.replaced', v_job.status, v_job.status, 'worker', p_worker_id,
    v_job.lock_version, null,
    jsonb_build_object('replacement_id', p_replacement_id, 'image_id', v_image.id,
                       'public_path', v_image.public_path)
  );

  return query select v_article.id, v_article.slug, v_image.public_path;
end;
$$;

create function public.worker_fail_hero_replacement(
  p_replacement_id uuid,
  p_worker_id text,
  p_error text,
  p_retry boolean default false
)
returns public.hero_replacement_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.hero_image_replacements;
  v_job public.article_jobs;
  v_error text := left(btrim(coalesce(p_error, 'unknown error')), 2000);
  v_status public.hero_replacement_status;
begin
  v_row := private.lock_hero_replacement(p_replacement_id);
  if v_row.status not in ('drawing', 'applying') or v_row.worker_id is distinct from p_worker_id then
    raise exception 'replacement % is not held by %', p_replacement_id, p_worker_id using errcode = 'FT003';
  end if;

  -- A retry returns the row to the state the worker claimed it from, so the lane picks it up again.
  v_status := case
    when not coalesce(p_retry, false) then 'failed'
    when v_row.status = 'applying' then 'approved'
    else 'pending'
  end::public.hero_replacement_status;

  update public.hero_image_replacements r set
    status = v_status,
    worker_id = case when coalesce(p_retry, false) then null else r.worker_id end,
    error_summary = v_error,
    finished_at = case when coalesce(p_retry, false) then null else now() end
  where r.id = p_replacement_id;

  select * into v_job from public.article_jobs where id = v_row.job_id;
  perform private.append_job_event(
    v_row.job_id, 'hero_image.replacement_failed', v_job.status, v_job.status, 'worker', p_worker_id,
    v_job.lock_version, v_error,
    jsonb_build_object('replacement_id', p_replacement_id, 'retry', coalesce(p_retry, false))
  );

  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: the console uploads a replacement into the job's own private folder.
-- ---------------------------------------------------------------------------

create function private.is_hero_replacement_upload_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_match text[];
begin
  if p_name is null or position('..' in p_name) > 0 then
    return false;
  end if;

  v_match := pg_catalog.regexp_match(
    p_name,
    '^jobs/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/replacement/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/hero-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|avif)$'
  );
  if v_match is null then
    return false;
  end if;

  return exists (
    select 1
    from public.hero_image_replacements r
    where r.id = v_match[2]::uuid
      and r.job_id = v_match[1]::uuid
      and r.mode = 'upload'
      and r.status = 'pending'
  );
end;
$$;

revoke execute on function private.is_hero_replacement_upload_path(text) from public, anon, service_role;
grant execute on function private.is_hero_replacement_upload_path(text) to authenticated;

create policy "Editors upload hero replacements"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'article-work'
    and (select private.can_edit())
    and private.is_hero_replacement_upload_path(name)
  );

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  private.lock_hero_replacement(uuid),
  private.record_hero_candidate(public.hero_image_replacements, jsonb, text, text, integer, text, integer, integer, uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.admin_request_hero_replacement(uuid, integer, public.hero_replacement_mode, text),
  public.admin_attach_hero_replacement_image(uuid, jsonb, text, text, integer, text, integer, integer),
  public.admin_review_hero_replacement(uuid, boolean, text),
  public.admin_cancel_hero_replacement(uuid, text)
to authenticated, service_role;

grant execute on function
  public.worker_claim_hero_replacement(text),
  public.worker_record_hero_candidate(uuid, text, jsonb, text, text, integer, text, integer, integer, uuid),
  public.worker_apply_hero_replacement(uuid, text, text),
  public.worker_fail_hero_replacement(uuid, text, text, boolean)
to service_role;
