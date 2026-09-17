-- FinTechPulse foundation: schemas, privilege hardening, enums, and pure helper functions.
-- Implementation plan sections 7 and 8. Later migrations depend on every object here.

-- ---------------------------------------------------------------------------
-- Schemas and default privileges
-- ---------------------------------------------------------------------------

-- `private` holds helpers and the transition map. It is not exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- New objects never become reachable by browser roles by accident. Every grant to `anon` or
-- `authenticated` is explicit (see the grants migration), regardless of the project's
-- `auto_expose_new_tables` setting.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
-- PUBLIC EXECUTE on functions is a global default, and per-schema default privileges cannot remove
-- global ones, so this revoke must be global. Every function grant in later migrations is explicit.
alter default privileges for role postgres revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Article job lifecycle (plan section 8). Order follows the normal path.
create type public.job_status as enum (
  'IDEA',
  'RESEARCH_PENDING',
  'RESEARCHING',
  'RESEARCH_COMPLETE',
  'DRAFT_PENDING',
  'DRAFTING',
  'DRAFT_COMPLETE',
  'IMAGES_PENDING',
  'IMAGES_PROCESSING',
  'AUDIT_PENDING',
  'AUDITING',
  'REVISION_REQUIRED',
  'REVISING',
  'RE_AUDIT_PENDING',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'VERIFIED',
  'PAUSED',
  'FAILED',
  'NEEDS_HUMAN'
);

create type public.pipeline_stage as enum (
  'research', 'draft', 'images', 'audit', 'revision', 'publish', 'verify'
);

create type public.provider_kind as enum ('openai', 'anthropic', 'gemini', 'internal');

-- Concrete provider modes (plan section 10.2). Which modes a stage accepts is enforced by
-- private.provider_mode_allowed().
create type public.provider_mode as enum (
  'mock',
  'manual_chatgpt',
  'codex_cli',
  'openai_api',
  'claude_code',
  'manual_claude',
  'anthropic_api',
  'manual_gemini',
  'gemini_api',
  'internal'
);

create type public.actor_type as enum ('system', 'worker', 'admin');

create type public.admin_role as enum ('owner', 'editor', 'viewer');

create type public.action_required_kind as enum (
  'manual_input',        -- expected manual provider step, not a failure
  'cli_auth',            -- subscription CLI missing or logged out
  'usage_limit',         -- subscription usage limit reached; never falls back to API
  'invalid_output',      -- provider output failed validation after repair
  'editorial_review',    -- conflicting facts, exhausted revisions, or admin escalation
  'publish_conflict',    -- slug conflict or other publication precondition failure
  'verification_failed'  -- live verification retries exhausted
);

create type public.artifact_validation as enum ('valid', 'invalid');

create type public.audit_verdict as enum ('PASS', 'REVISION_REQUIRED', 'NEEDS_HUMAN');

create type public.image_role as enum ('hero', 'supporting');

create type public.image_status as enum ('briefed', 'uploaded', 'ready', 'published', 'rejected');

create type public.run_status as enum ('running', 'action_required', 'succeeded', 'failed', 'cancelled');

create type public.error_class as enum (
  'transient', 'rate_limit', 'usage_limit', 'auth', 'invalid_output', 'permanent_config', 'unknown'
);

create type public.article_status as enum ('published', 'verified', 'withdrawn');

create type public.publish_log_kind as enum ('publish', 'revalidate', 'verify_check', 'verify_summary');

create type public.log_outcome as enum ('succeeded', 'failed', 'skipped');

create type public.source_type as enum (
  'regulator', 'government', 'central_bank', 'legislation', 'company_filing', 'company',
  'statistics', 'academic', 'news', 'other'
);

create type public.source_quality as enum ('primary', 'secondary', 'tertiary');

create type public.claim_status as enum ('unverified', 'supported', 'contradicted', 'mixed');

create type public.evidence_relation as enum ('supports', 'contradicts', 'context');

create type public.draft_origin as enum ('provider', 'admin_edit');

create type public.article_type as enum ('news', 'analysis', 'explainer', 'guide', 'company', 'interview');

-- ---------------------------------------------------------------------------
-- Pure helpers (immutable, safe to use in CHECK constraints)
-- ---------------------------------------------------------------------------

create function private.provider_of_mode(p_mode public.provider_mode)
returns public.provider_kind
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_mode
    when 'manual_chatgpt' then 'openai'
    when 'codex_cli' then 'openai'
    when 'openai_api' then 'openai'
    when 'claude_code' then 'anthropic'
    when 'manual_claude' then 'anthropic'
    when 'anthropic_api' then 'anthropic'
    when 'manual_gemini' then 'gemini'
    when 'gemini_api' then 'gemini'
    else 'internal'
  end::public.provider_kind;
$$;

create function private.provider_mode_allowed(p_stage public.pipeline_stage, p_mode public.provider_mode)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_stage
    when 'research' then p_mode in ('mock', 'manual_chatgpt', 'codex_cli', 'openai_api')
    when 'audit' then p_mode in ('mock', 'manual_chatgpt', 'codex_cli', 'openai_api')
    when 'draft' then p_mode in ('mock', 'claude_code', 'manual_claude', 'anthropic_api')
    when 'revision' then p_mode in ('mock', 'claude_code', 'manual_claude', 'anthropic_api')
    when 'images' then p_mode in ('mock', 'manual_gemini', 'gemini_api')
    when 'publish' then p_mode = 'internal'
    when 'verify' then p_mode = 'internal'
  end;
$$;

create function private.is_api_mode(p_mode public.provider_mode)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_mode in ('openai_api', 'anthropic_api', 'gemini_api');
$$;

-- Statuses in which a worker holds (or may hold) a lease.
create function private.is_active_status(p_status public.job_status)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_status in ('RESEARCHING', 'DRAFTING', 'IMAGES_PROCESSING', 'AUDITING', 'REVISING', 'PUBLISHING');
$$;

-- Statuses that may be paused or escalated by an admin (nonterminal, before publication starts).
create function private.is_pausable_status(p_status public.job_status)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_status in (
    'IDEA', 'RESEARCH_PENDING', 'RESEARCHING', 'RESEARCH_COMPLETE', 'DRAFT_PENDING', 'DRAFTING',
    'DRAFT_COMPLETE', 'IMAGES_PENDING', 'IMAGES_PROCESSING', 'AUDIT_PENDING', 'AUDITING',
    'REVISION_REQUIRED', 'REVISING', 'RE_AUDIT_PENDING', 'APPROVED', 'SCHEDULED'
  );
$$;

create function private.stage_for_status(p_status public.job_status)
returns public.pipeline_stage
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_status in ('IDEA', 'RESEARCH_PENDING', 'RESEARCHING', 'RESEARCH_COMPLETE') then 'research'
    when p_status in ('DRAFT_PENDING', 'DRAFTING', 'DRAFT_COMPLETE') then 'draft'
    when p_status in ('IMAGES_PENDING', 'IMAGES_PROCESSING') then 'images'
    when p_status in ('AUDIT_PENDING', 'AUDITING', 'RE_AUDIT_PENDING', 'APPROVED') then 'audit'
    when p_status in ('REVISION_REQUIRED', 'REVISING') then 'revision'
    when p_status in ('SCHEDULED', 'PUBLISHING') then 'publish'
    when p_status in ('PUBLISHED', 'VERIFIED') then 'verify'
    else null
  end::public.pipeline_stage;
$$;

-- The status a stage returns to when it is retried, recovered, or resumed after interruption.
create function private.pending_status_for_stage(p_stage public.pipeline_stage, p_revision_count integer)
returns public.job_status
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_stage
    when 'research' then 'RESEARCH_PENDING'
    when 'draft' then 'DRAFT_PENDING'
    when 'images' then 'IMAGES_PENDING'
    when 'audit' then case when p_revision_count > 0 then 'RE_AUDIT_PENDING' else 'AUDIT_PENDING' end
    when 'revision' then 'REVISION_REQUIRED'
    when 'publish' then 'APPROVED'
    else null
  end::public.job_status;
$$;

-- Stage order, used to decide which earlier stages an escalated job may restart from.
create function private.stage_rank(p_stage public.pipeline_stage)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array_position(
    array['research', 'draft', 'images', 'audit', 'revision', 'publish', 'verify']::public.pipeline_stage[],
    p_stage
  );
$$;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Immutable artifact rows. TG_ARGV lists the only columns that may change after insert
-- (tightly scoped review metadata). Deletes are always rejected.
create function private.guard_immutable_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable text[] := coalesce(tg_argv::text[], array[]::text[]);
begin
  if tg_op = 'DELETE' then
    raise exception '% rows are retained permanently and cannot be deleted', tg_table_name
      using errcode = 'FT004';
  end if;

  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception '% rows are immutable; create a new version instead', tg_table_name
      using errcode = 'FT004',
            hint = 'Mutable columns: ' || coalesce(array_to_string(v_mutable, ', '), 'none');
  end if;

  return new;
end;
$$;

create function private.guard_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only; record a correction as a new row', tg_table_name
    using errcode = 'FT004';
end;
$$;

-- Execute privileges on private helpers are granted explicitly in the grants migration.
