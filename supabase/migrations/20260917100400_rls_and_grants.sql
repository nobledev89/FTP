-- Row Level Security and explicit privileges (plan section 7.4).
--
-- Browser roles:
--   anon           publication-safe reads only (sites, published articles)
--   authenticated  same as anon; admins (active admin_users) read editorial data
--   service_role   local worker on the owner's PC; bypasses RLS, calls worker functions
-- All mutations by admins go through SECURITY DEFINER functions that authorize the caller.

-- ---------------------------------------------------------------------------
-- Enable RLS on every table in public
-- ---------------------------------------------------------------------------

alter table public.sites enable row level security;
alter table public.admin_users enable row level security;
alter table public.prompt_templates enable row level security;
alter table public.site_settings enable row level security;
alter table public.provider_settings enable row level security;
alter table public.worker_instances enable row level security;
alter table public.article_jobs enable row level security;
alter table public.provider_runs enable row level security;
alter table public.research_packets enable row level security;
alter table public.sources enable row level security;
alter table public.claims enable row level security;
alter table public.claim_sources enable row level security;
alter table public.drafts enable row level security;
alter table public.audits enable row level security;
alter table public.images enable row level security;
alter table public.articles enable row level security;
alter table public.article_slug_aliases enable row level security;
alter table public.job_events enable row level security;
alter table public.publishing_logs enable row level security;
alter table public.originality_checks enable row level security;

-- ---------------------------------------------------------------------------
-- Reset privileges, then grant explicitly
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Publication-safe reads.
grant select on public.sites, public.articles, public.article_slug_aliases to anon, authenticated;

-- Editorial reads for admins (RLS narrows to active memberships).
grant select on
  public.admin_users,
  public.prompt_templates,
  public.site_settings,
  public.provider_settings,
  public.worker_instances,
  public.article_jobs,
  public.provider_runs,
  public.research_packets,
  public.sources,
  public.claims,
  public.claim_sources,
  public.drafts,
  public.audits,
  public.images,
  public.job_events,
  public.publishing_logs,
  public.originality_checks
to authenticated;

-- Private helpers: nothing by default. Internal SECURITY DEFINER helpers (for example
-- complete_stage_core, which skips lease and role checks) stay callable only from the public
-- functions that authorize their callers.
revoke execute on all functions in schema private from public, anon, authenticated, service_role;

-- Policy helpers evaluated as the signed-in user.
grant execute on function private.admin_role(), private.is_admin(), private.can_edit() to authenticated;

-- Immutable helpers referenced by CHECK constraints on tables the worker writes directly.
grant execute on function
  private.provider_of_mode(public.provider_mode),
  private.provider_mode_allowed(public.pipeline_stage, public.provider_mode),
  private.is_api_mode(public.provider_mode),
  private.is_active_status(public.job_status),
  private.is_pausable_status(public.job_status)
to service_role;

-- Worker API: service role only.
grant execute on function
  public.heartbeat_worker(text, text, text, timestamptz, uuid, public.pipeline_stage, jsonb),
  public.recover_expired_leases(),
  public.claim_next_job(text, integer, public.pipeline_stage[]),
  public.renew_lease(uuid, text, uuid, integer),
  public.complete_stage(uuid, text, uuid, public.job_status, text, jsonb),
  public.request_manual_action(uuid, text, uuid, uuid, text),
  public.fail_stage(uuid, text, uuid, text, public.error_class, text, timestamptz, uuid),
  public.publish_article(uuid, text, uuid, jsonb),
  public.record_verification(uuid, text, uuid, jsonb, timestamptz)
to service_role;

-- Admin API: authenticated callers, authorized inside each function.
grant execute on function
  public.create_article_job(text, text[], text, public.article_type, integer, integer, timestamptz, boolean, text,
                            public.provider_mode, public.provider_mode, public.provider_mode, public.provider_mode),
  public.admin_transition_job(uuid, text, integer, text, public.job_status, timestamptz)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create policy "Sites are public"
  on public.sites for select
  to anon, authenticated
  using (true);

create policy "Published articles are public once their publish time arrives"
  on public.articles for select
  to anon, authenticated
  using (status in ('published', 'verified') and published_at <= now());

create policy "Admins read every article"
  on public.articles for select
  to authenticated
  using ((select private.is_admin()));

create policy "Slug aliases of public articles are public"
  on public.article_slug_aliases for select
  to anon, authenticated
  using (exists (
    select 1 from public.articles a
    where a.id = article_slug_aliases.article_id and a.status in ('published', 'verified') and a.published_at <= now()
  ));

create policy "Members read their own membership; admins read all"
  on public.admin_users for select
  to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

-- Admin-only reads for editorial and operational tables.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'prompt_templates', 'site_settings', 'provider_settings', 'worker_instances', 'article_jobs', 'provider_runs',
    'research_packets', 'sources', 'claims', 'claim_sources', 'drafts', 'audits', 'images', 'job_events',
    'publishing_logs', 'originality_checks'
  ] loop
    execute format(
      'create policy "Admins read %1$s" on public.%1$I for select to authenticated using ((select private.is_admin()))',
      v_table
    );
  end loop;
end;
$$;
