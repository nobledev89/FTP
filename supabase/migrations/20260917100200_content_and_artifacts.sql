-- Jobs, versioned artifacts, provider runs, published articles, and append-only logs.
-- Composite foreign keys on (id, job_id) guarantee every artifact reference stays inside one job.

-- ---------------------------------------------------------------------------
-- article_jobs: the queue row and state machine subject.
-- ---------------------------------------------------------------------------

create table public.article_jobs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete restrict,

  -- Brief
  topic text not null check (char_length(btrim(topic)) between 3 and 300),
  keywords text[] not null default '{}' check (cardinality(keywords) <= 20),
  requirements text check (char_length(requirements) <= 5000),
  article_type public.article_type not null default 'analysis',
  target_word_count integer check (target_word_count between 300 and 6000),
  image_count smallint not null default 1 check (image_count between 0 and 3),
  desired_publish_at timestamptz,
  auto_publish boolean not null default false,
  byline_name text check (char_length(byline_name) <= 120),
  byline_role text check (char_length(byline_role) <= 120),
  category text check (char_length(category) <= 60),

  -- Provider selection snapshot, taken at creation (plan section 10.2).
  research_mode public.provider_mode not null,
  writing_mode public.provider_mode not null,
  images_mode public.provider_mode not null,
  audit_mode public.provider_mode not null,

  -- State
  status public.job_status not null default 'IDEA',
  lock_version integer not null default 0 check (lock_version >= 0),
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 20),
  revision_count smallint not null default 0 check (revision_count between 0 and 2),
  next_attempt_at timestamptz,

  -- Lease (plan section 9)
  lease_owner text check (lease_owner ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  lease_token uuid,
  lease_expires_at timestamptz,

  -- Waiting for input or escalation
  action_required_kind public.action_required_kind,
  action_required_message text check (char_length(action_required_message) <= 2000),
  action_required_run_id uuid,
  action_required_at timestamptz,

  -- Exceptional state details
  paused_from_status public.job_status,
  failed_stage public.pipeline_stage,
  failure_summary text check (char_length(failure_summary) <= 2000),
  needs_human_stage public.pipeline_stage,

  -- Publication linkage (set by the publishing functions only)
  approved_draft_id uuid,
  approved_audit_id uuid,
  article_id uuid unique,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, site_id),

  constraint article_jobs_modes_allowed check (
    private.provider_mode_allowed('research', research_mode)
    and private.provider_mode_allowed('draft', writing_mode)
    and private.provider_mode_allowed('images', images_mode)
    and private.provider_mode_allowed('audit', audit_mode)
  ),
  constraint article_jobs_lease_complete check (
    (lease_owner is null and lease_token is null and lease_expires_at is null)
    or (lease_owner is not null and lease_token is not null and lease_expires_at is not null)
  ),
  -- Leases exist only while a stage runs, or while a published article is being verified.
  constraint article_jobs_lease_status check (
    lease_token is null or private.is_active_status(status) or status = 'PUBLISHED'
  ),
  -- Manual waits and escalations never hold a lease (plan section 8.2).
  constraint article_jobs_action_without_lease check (
    action_required_kind is null or lease_token is null
  ),
  constraint article_jobs_action_complete check (
    (action_required_kind is null) = (action_required_at is null)
  ),
  constraint article_jobs_action_status check (
    action_required_kind is null
    or private.is_active_status(status)
    or status in ('PAUSED', 'NEEDS_HUMAN', 'PUBLISHED')
  ),
  constraint article_jobs_paused check ((status = 'PAUSED') = (paused_from_status is not null)),
  constraint article_jobs_paused_from check (
    paused_from_status is null or private.is_pausable_status(paused_from_status)
  ),
  constraint article_jobs_failed check (status <> 'FAILED' or failed_stage is not null),
  constraint article_jobs_needs_human check (status <> 'NEEDS_HUMAN' or needs_human_stage is not null),
  constraint article_jobs_published_linkage check (
    status not in ('PUBLISHED', 'VERIFIED') or (article_id is not null and approved_draft_id is not null)
  ),
  constraint article_jobs_approved_linkage check (
    status not in ('APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'VERIFIED')
    or approved_draft_id is not null
  ),
  constraint article_jobs_scheduled check (status <> 'SCHEDULED' or desired_publish_at is not null)
);

-- ---------------------------------------------------------------------------
-- provider_runs: every prepared/executed provider call, with its prompt snapshot.
-- ---------------------------------------------------------------------------

create table public.provider_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.article_jobs (id) on delete restrict,
  stage public.pipeline_stage not null,
  provider public.provider_kind not null,
  mode public.provider_mode not null,
  cycle smallint not null default 0 check (cycle between 0 and 2),
  attempt smallint not null default 1 check (attempt >= 1),
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 200),
  prompt_template_id uuid references public.prompt_templates (id) on delete restrict,
  prompt_version integer check (prompt_version > 0),
  prompt_snapshot text check (char_length(prompt_snapshot) <= 400000),
  schema_version text not null check (char_length(schema_version) between 1 and 40),
  input_refs jsonb not null default '{}'::jsonb check (jsonb_typeof(input_refs) = 'object'),
  output_ref jsonb check (output_ref is null or jsonb_typeof(output_ref) = 'object'),
  status public.run_status not null default 'running',
  error_class public.error_class,
  error_summary text check (char_length(error_summary) <= 2000),
  retryable boolean,
  worker_id text check (worker_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  usage jsonb check (usage is null or jsonb_typeof(usage) = 'object'),
  cost_amount numeric(12, 6) check (cost_amount >= 0),
  cost_currency text check (cost_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  unique (id, job_id),
  check (private.provider_mode_allowed(stage, mode)),
  -- Mock runs record the provider they simulate; every other mode implies its provider.
  check (provider = private.provider_of_mode(mode) or (mode = 'mock' and provider <> 'internal')),
  check (finished_at is null or finished_at >= started_at),
  check ((status in ('succeeded', 'failed', 'cancelled')) = (finished_at is not null)),
  check (status <> 'failed' or error_class is not null),
  check ((cost_amount is null) = (cost_currency is null))
);

-- A run may be updated while it is running or waiting for manual input; afterwards it is history.
create function private.guard_provider_run_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'provider_runs rows are retained permanently' using errcode = 'FT004';
  end if;
  if old.status in ('succeeded', 'failed', 'cancelled') then
    raise exception 'provider run % is finished and immutable', old.id using errcode = 'FT004';
  end if;
  if (to_jsonb(new) - array['status', 'error_class', 'error_summary', 'retryable', 'finished_at',
                            'output_ref', 'usage', 'cost_amount', 'cost_currency'])
     is distinct from
     (to_jsonb(old) - array['status', 'error_class', 'error_summary', 'retryable', 'finished_at',
                            'output_ref', 'usage', 'cost_amount', 'cost_currency']) then
    raise exception 'only the outcome of provider run % may change', old.id using errcode = 'FT004';
  end if;
  return new;
end;
$$;

create trigger provider_runs_guard
  before update or delete on public.provider_runs
  for each row execute function private.guard_provider_run_update();

-- ---------------------------------------------------------------------------
-- Research artifacts
-- ---------------------------------------------------------------------------

create table public.research_packets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.article_jobs (id) on delete restrict,
  version integer not null check (version > 0),
  packet jsonb not null check (jsonb_typeof(packet) = 'object'),
  summary text check (char_length(summary) <= 5000),
  provider_run_id uuid,
  prompt_template_id uuid references public.prompt_templates (id) on delete restrict,
  prompt_version integer check (prompt_version > 0),
  schema_version text not null check (char_length(schema_version) between 1 and 40),
  validation_status public.artifact_validation not null,
  validation_errors jsonb check (validation_errors is null or jsonb_typeof(validation_errors) = 'array'),
  review_note text check (char_length(review_note) <= 2000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, version),
  unique (id, job_id),
  foreign key (provider_run_id, job_id) references public.provider_runs (id, job_id) on delete restrict,
  check (validation_status = 'valid' or validation_errors is not null)
);

create trigger research_packets_immutable
  before update or delete on public.research_packets
  for each row execute function private.guard_immutable_row('review_note', 'reviewed_by', 'reviewed_at');

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.article_jobs (id) on delete restrict,
  research_packet_id uuid not null,
  source_key text not null check (source_key ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  url text not null check (url ~ '^https?://' and char_length(url) <= 2048),
  title text not null check (char_length(title) between 1 and 500),
  publisher text check (char_length(publisher) <= 200),
  published_on date,
  source_type public.source_type not null default 'other',
  quality public.source_quality not null default 'secondary',
  jurisdiction text check (jurisdiction ~ '^[A-Z]{2,6}$'),
  accessed_at timestamptz not null,
  excerpt text check (char_length(excerpt) <= 2000),
  content_hash text check (content_hash ~ '^[a-f0-9]{64}$'),
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  unique (research_packet_id, source_key),
  unique (id, research_packet_id),
  unique (id, job_id),
  foreign key (research_packet_id, job_id) references public.research_packets (id, job_id) on delete restrict
);

create trigger sources_immutable
  before update or delete on public.sources
  for each row execute function private.guard_immutable_row();

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.article_jobs (id) on delete restrict,
  research_packet_id uuid not null,
  claim_key text not null check (claim_key ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  text text not null check (char_length(text) between 1 and 2000),
  status public.claim_status not null default 'unverified',
  confidence numeric(3, 2) check (confidence between 0 and 1),
  -- Claims keep jurisdiction and effective dates so non-UK rules are never presented as UK rules.
  jurisdiction text check (jurisdiction ~ '^[A-Z]{2,6}$'),
  effective_date date,
  as_of_date date,
  entities text[] not null default '{}' check (cardinality(entities) <= 50),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  unique (research_packet_id, claim_key),
  unique (id, research_packet_id),
  foreign key (research_packet_id, job_id) references public.research_packets (id, job_id) on delete restrict
);

create trigger claims_immutable
  before update or delete on public.claims
  for each row execute function private.guard_immutable_row();

create table public.claim_sources (
  claim_id uuid not null,
  source_id uuid not null,
  research_packet_id uuid not null,
  relation public.evidence_relation not null default 'supports',
  locator text check (char_length(locator) <= 500),
  created_at timestamptz not null default now(),
  primary key (claim_id, source_id),
  foreign key (claim_id, research_packet_id) references public.claims (id, research_packet_id) on delete restrict,
  foreign key (source_id, research_packet_id) references public.sources (id, research_packet_id) on delete restrict
);

create trigger claim_sources_immutable
  before update or delete on public.claim_sources
  for each row execute function private.guard_immutable_row();

-- ---------------------------------------------------------------------------
-- Drafts and audits
-- ---------------------------------------------------------------------------

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.article_jobs (id) on delete restrict,
  version integer not null check (version > 0),
  origin public.draft_origin not null default 'provider',
  parent_draft_id uuid,
  research_packet_id uuid not null,
  responds_to_audit_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  excerpt text not null check (char_length(btrim(excerpt)) between 1 and 500),
  body_markdown text not null check (char_length(btrim(body_markdown)) between 1 and 200000),
  meta_title text check (char_length(meta_title) <= 70),
  meta_description text check (char_length(meta_description) <= 320),
  category text check (char_length(category) <= 60),
  internal_links jsonb not null default '[]'::jsonb check (jsonb_typeof(internal_links) = 'array'),
  image_briefs jsonb not null default '[]'::jsonb check (jsonb_typeof(image_briefs) = 'array'),
  source_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs) = 'array'),
  provider_run_id uuid,
  prompt_template_id uuid references public.prompt_templates (id) on delete restrict,
  prompt_version integer check (prompt_version > 0),
  schema_version text not null check (char_length(schema_version) between 1 and 40),
  validation_status public.artifact_validation not null,
  validation_errors jsonb check (validation_errors is null or jsonb_typeof(validation_errors) = 'array'),
  created_by uuid references auth.users (id) on delete set null,
  review_note text check (char_length(review_note) <= 2000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, version),
  unique (id, job_id),
  foreign key (parent_draft_id, job_id) references public.drafts (id, job_id) on delete restrict,
  foreign key (research_packet_id, job_id) references public.research_packets (id, job_id) on delete restrict,
  foreign key (provider_run_id, job_id) references public.provider_runs (id, job_id) on delete restrict,
  check (origin = 'admin_edit' or provider_run_id is not null),
  check (origin = 'provider' or created_by is not null),
  check (validation_status = 'valid' or validation_errors is not null)
);

create trigger drafts_immutable
  before update or delete on public.drafts
  for each row execute function private.guard_immutable_row('review_note', 'reviewed_by', 'reviewed_at');

create table public.audits (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.article_jobs (id) on delete restrict,
  version integer not null check (version > 0),
  draft_id uuid not null,
  cycle smallint not null check (cycle between 0 and 2),
  verdict public.audit_verdict not null,
  findings jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array'),
  summary text check (char_length(summary) <= 5000),
  provider_run_id uuid,
  prompt_template_id uuid references public.prompt_templates (id) on delete restrict,
  prompt_version integer check (prompt_version > 0),
  schema_version text not null check (char_length(schema_version) between 1 and 40),
  review_note text check (char_length(review_note) <= 2000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, version),
  unique (id, job_id),
  foreign key (draft_id, job_id) references public.drafts (id, job_id) on delete restrict,
  foreign key (provider_run_id, job_id) references public.provider_runs (id, job_id) on delete restrict,
  check (verdict = 'PASS' or jsonb_array_length(findings) > 0)
);

create trigger audits_immutable
  before update or delete on public.audits
  for each row execute function private.guard_immutable_row('review_note', 'reviewed_by', 'reviewed_at');

alter table public.drafts
  add foreign key (responds_to_audit_id, job_id) references public.audits (id, job_id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Images
-- ---------------------------------------------------------------------------

create table public.images (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.article_jobs (id) on delete restrict,
  slot smallint not null check (slot between 0 and 3),
  version integer not null check (version > 0),
  role public.image_role not null,
  purpose text check (char_length(purpose) <= 500),
  prompt text check (char_length(prompt) <= 10000),
  alt_text text check (char_length(alt_text) <= 300),
  caption text check (char_length(caption) <= 500),
  aspect_ratio text not null check (aspect_ratio in ('16:9', '4:5', '3:2', '1:1')),
  focal_x numeric(5, 2) check (focal_x between 0 and 100),
  focal_y numeric(5, 2) check (focal_y between 0 and 100),
  width integer check (width between 1 and 20000),
  height integer check (height between 1 and 20000),
  mime_type text check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/avif')),
  byte_size integer check (byte_size between 1 and 10485760),
  content_hash text check (content_hash ~ '^[a-f0-9]{64}$'),
  status public.image_status not null default 'briefed',
  private_path text check (private_path ~ '^jobs/[0-9a-f-]{36}/'),
  public_path text check (public_path ~ '^articles/'),
  provider_run_id uuid,
  review_note text check (char_length(review_note) <= 2000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, slot, version),
  unique (id, job_id),
  foreign key (provider_run_id, job_id) references public.provider_runs (id, job_id) on delete restrict,
  check ((role = 'hero') = (slot = 0)),
  check ((focal_x is null) = (focal_y is null)),
  -- Alt text is required before an image can be approved (plan section 6.4).
  check (status not in ('ready', 'published')
         or (char_length(btrim(alt_text)) > 0 and private_path is not null and mime_type is not null)),
  check ((status = 'published') = (public_path is not null and published_at is not null))
);

-- Core image data is fixed once uploaded; lifecycle status, publication path, and review metadata
-- may move forward.
create function private.guard_image_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable text[] := array['status', 'public_path', 'published_at', 'review_note', 'reviewed_by', 'reviewed_at',
                            'alt_text', 'caption', 'focal_x', 'focal_y'];
begin
  if tg_op = 'DELETE' then
    raise exception 'images rows are retained permanently' using errcode = 'FT004';
  end if;
  if old.status in ('ready', 'published') then
    v_mutable := array['status', 'public_path', 'published_at', 'review_note', 'reviewed_by', 'reviewed_at'];
  end if;
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'image % is immutable in status %', old.id, old.status using errcode = 'FT004';
  end if;
  if old.status = 'published' and new.status <> 'published' then
    raise exception 'published image % cannot change status', old.id using errcode = 'FT004';
  end if;
  if old.public_path is not null and new.public_path is distinct from old.public_path then
    raise exception 'published image path cannot change' using errcode = 'FT004';
  end if;
  return new;
end;
$$;

create trigger images_guard
  before update or delete on public.images
  for each row execute function private.guard_image_update();

-- ---------------------------------------------------------------------------
-- articles: publication-safe snapshot. Every column may be read publicly once published.
-- Internal linkage (job, approved draft, image ids) lives on article_jobs.
-- ---------------------------------------------------------------------------

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  excerpt text not null check (char_length(btrim(excerpt)) between 1 and 500),
  body_markdown text not null check (char_length(btrim(body_markdown)) between 1 and 200000),
  meta_title text not null check (char_length(btrim(meta_title)) between 1 and 70),
  meta_description text not null check (char_length(btrim(meta_description)) between 1 and 320),
  category text check (char_length(category) <= 60),
  article_type public.article_type not null,
  byline_name text not null check (char_length(btrim(byline_name)) between 1 and 120),
  byline_role text check (char_length(byline_role) <= 120),
  canonical_url text not null check (canonical_url ~ '^https?://[^/]+/blog/[a-z0-9-]+$'),
  hero_image jsonb check (hero_image is null or jsonb_typeof(hero_image) = 'object'),
  source_references jsonb not null default '[]'::jsonb check (jsonb_typeof(source_references) = 'array'),
  status public.article_status not null,
  published_at timestamptz not null,
  content_updated_at timestamptz,
  verified_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, slug),
  check (hero_image is null or (hero_image ? 'path' and char_length(btrim(hero_image ->> 'alt')) > 0)),
  check ((status = 'verified') = (verified_at is not null) or status = 'withdrawn'),
  check ((status = 'withdrawn') = (withdrawn_at is not null))
);

comment on table public.articles is
  'Published snapshots. Written only by publish_article/record_verification; public read via RLS.';

create table public.article_slug_aliases (
  site_id uuid not null references public.sites (id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  article_id uuid not null references public.articles (id) on delete restrict,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (site_id, slug)
);

create trigger article_slug_aliases_immutable
  before update or delete on public.article_slug_aliases
  for each row execute function private.guard_immutable_row();

-- Link jobs to their approved artifacts and article now that the targets exist.
alter table public.article_jobs
  add foreign key (approved_draft_id, id) references public.drafts (id, job_id) on delete restrict,
  add foreign key (approved_audit_id, id) references public.audits (id, job_id) on delete restrict,
  add foreign key (article_id) references public.articles (id) on delete restrict,
  add foreign key (action_required_run_id, id) references public.provider_runs (id, job_id) on delete restrict;

alter table public.worker_instances
  add foreign key (current_job_id) references public.article_jobs (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Append-only history
-- ---------------------------------------------------------------------------

create table public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.article_jobs (id) on delete restrict,
  event_type text not null check (event_type ~ '^[a-z]+(\.[a-z_]+)+$'),
  from_status public.job_status,
  to_status public.job_status,
  actor_type public.actor_type not null,
  actor_id text check (char_length(actor_id) <= 64),
  lock_version integer,
  note text check (char_length(note) <= 2000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create trigger job_events_append_only
  before update or delete on public.job_events
  for each row execute function private.guard_append_only();

create table public.publishing_logs (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.article_jobs (id) on delete restrict,
  article_id uuid references public.articles (id) on delete restrict,
  kind public.publish_log_kind not null,
  check_name text check (check_name ~ '^[a-z][a-z0-9_]{1,40}$'),
  outcome public.log_outcome not null,
  attempt smallint not null default 1 check (attempt >= 1),
  http_status smallint check (http_status between 100 and 599),
  duration_ms integer check (duration_ms >= 0),
  request_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(request_summary) = 'object'),
  result_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(result_summary) = 'object'),
  error text check (char_length(error) <= 2000),
  worker_id text check (worker_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  created_at timestamptz not null default now(),
  check ((kind = 'verify_check') = (check_name is not null))
);

create trigger publishing_logs_append_only
  before update or delete on public.publishing_logs
  for each row execute function private.guard_append_only();

create table public.originality_checks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.article_jobs (id) on delete restrict,
  draft_id uuid not null,
  checker text not null check (char_length(checker) between 1 and 60),
  status public.run_status not null,
  -- A similarity signal only; never presented as a "plagiarism-free" guarantee.
  similarity_score numeric(5, 4) check (similarity_score between 0 and 1),
  matches jsonb not null default '[]'::jsonb check (jsonb_typeof(matches) = 'array'),
  provider_run_id uuid,
  created_at timestamptz not null default now(),
  foreign key (draft_id, job_id) references public.drafts (id, job_id) on delete restrict,
  foreign key (provider_run_id, job_id) references public.provider_runs (id, job_id) on delete restrict
);

create trigger originality_checks_immutable
  before update or delete on public.originality_checks
  for each row execute function private.guard_immutable_row();
