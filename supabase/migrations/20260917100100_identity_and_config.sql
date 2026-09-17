-- Publication identity, admin membership, configuration, prompts, and worker health.

-- ---------------------------------------------------------------------------
-- sites: one row in v1; site_id keeps a future multi-site migration cheap.
-- ---------------------------------------------------------------------------

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 80),
  canonical_origin text not null check (canonical_origin ~ '^https?://[a-z0-9.-]+(:[0-9]{2,5})?$'),
  locale text not null default 'en-GB' check (locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  timezone text not null default 'Europe/London',
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  description text not null default '' check (char_length(description) <= 500),
  disclosure text not null default '' check (char_length(disclosure) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sites is 'Publication identity. Public read; every column is publication-safe.';

create function private.validate_site_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger sites_validate_timezone
  before insert or update of timezone on public.sites
  for each row execute function private.validate_site_timezone();

create trigger sites_set_updated_at
  before update on public.sites
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- admin_users: membership comes from this table, never from a client-editable claim.
-- ---------------------------------------------------------------------------

create table public.admin_users (
  user_id uuid not null references auth.users (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete restrict,
  role public.admin_role not null default 'editor',
  is_active boolean not null default true,
  display_name text check (char_length(display_name) <= 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, site_id)
);

comment on table public.admin_users is
  'Admin membership. Removing an auth user removes the membership only; audit history keeps the user id.';

create trigger admin_users_set_updated_at
  before update on public.admin_users
  for each row execute function private.set_updated_at();

-- Authorization helpers. SECURITY DEFINER so RLS policies can consult admin_users without
-- recursive policy evaluation; they only ever describe the calling user.
create function private.admin_role()
returns public.admin_role
language sql
stable
security definer
set search_path = ''
as $$
  select au.role
  from public.admin_users au
  where au.user_id = (select auth.uid())
    and au.is_active
  order by case au.role when 'owner' then 0 when 'editor' then 1 else 2 end
  limit 1;
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.admin_role() is not null;
$$;

create function private.can_edit()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.admin_role() in ('owner', 'editor');
$$;

-- ---------------------------------------------------------------------------
-- prompt_templates: immutable versions; activation is the only mutable state.
-- ---------------------------------------------------------------------------

create table public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete restrict,
  key text not null check (key ~ '^[a-z][a-z0-9-]{1,63}$'),
  version integer not null check (version > 0),
  content text not null check (char_length(content) between 1 and 100000),
  variables_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(variables_schema) = 'object'),
  notes text check (char_length(notes) <= 2000),
  is_active boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (site_id, key, version)
);

create unique index prompt_templates_one_active_idx
  on public.prompt_templates (site_id, key)
  where is_active;

create trigger prompt_templates_immutable
  before update or delete on public.prompt_templates
  for each row execute function private.guard_immutable_row('is_active');

-- ---------------------------------------------------------------------------
-- site_settings: editable publication and operations settings (admin only).
-- ---------------------------------------------------------------------------

create table public.site_settings (
  site_id uuid primary key references public.sites (id) on delete restrict,
  default_byline_name text not null default 'FinTechPulse Editorial'
    check (char_length(default_byline_name) between 1 and 120),
  default_byline_role text check (char_length(default_byline_role) <= 120),
  editorial_contact_email text check (editorial_contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  seo_default_title text check (char_length(seo_default_title) <= 70),
  seo_default_description text check (char_length(seo_default_description) <= 320),
  share_image_path text check (char_length(share_image_path) <= 512),
  worker_stale_after_seconds integer not null default 60 check (worker_stale_after_seconds between 10 and 3600),
  worker_offline_after_seconds integer not null default 120 check (worker_offline_after_seconds between 20 and 7200),
  auto_publish_default boolean not null default false,
  style_guide_template_id uuid references public.prompt_templates (id) on delete restrict,
  extra jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (worker_offline_after_seconds > worker_stale_after_seconds)
);

create trigger site_settings_set_updated_at
  before update on public.site_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- provider_settings: per-stage mode selection. Never holds secrets.
-- ---------------------------------------------------------------------------

create table public.provider_settings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete restrict,
  stage public.pipeline_stage not null,
  mode public.provider_mode not null,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  -- API modes are billable and require an explicit, recorded confirmation (plan section 10).
  api_mode_confirmed_at timestamptz,
  api_mode_confirmed_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, stage),
  check (private.provider_mode_allowed(stage, mode)),
  check (not private.is_api_mode(mode) or api_mode_confirmed_at is not null),
  -- Guard against secrets being pasted into non-secret settings.
  check (not (settings ?| array['api_key', 'apiKey', 'secret', 'token', 'password', 'authorization']))
);

create trigger provider_settings_set_updated_at
  before update on public.provider_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- worker_instances: heartbeat observation, written only by the local worker.
-- ---------------------------------------------------------------------------

create table public.worker_instances (
  worker_id text primary key check (worker_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  host_label text check (char_length(host_label) <= 120),
  version text check (char_length(version) <= 64),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  current_job_id uuid,
  current_stage public.pipeline_stage,
  health jsonb not null default '{}'::jsonb check (jsonb_typeof(health) = 'object'),
  created_at timestamptz not null default now()
);
