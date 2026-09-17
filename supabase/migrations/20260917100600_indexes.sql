-- Indexes for the access patterns in plan section 7.3. Unique constraints already index
-- (site_id, slug), (job_id, version) artifacts, and provider idempotency keys.

-- Queue claim: eligible statuses without a lease, ordered by due time.
create index article_jobs_claim_idx
  on public.article_jobs (status, desired_publish_at, created_at)
  where lease_token is null
    and action_required_kind is null
    and status in ('RESEARCH_PENDING', 'DRAFT_PENDING', 'IMAGES_PENDING', 'AUDIT_PENDING', 'RE_AUDIT_PENDING',
                   'REVISION_REQUIRED', 'APPROVED', 'SCHEDULED', 'PUBLISHED');

-- Expired lease recovery.
create index article_jobs_lease_expiry_idx
  on public.article_jobs (lease_expires_at)
  where lease_expires_at is not null;

-- Dashboard: jobs waiting for a person.
create index article_jobs_action_required_idx
  on public.article_jobs (action_required_kind, action_required_at)
  where action_required_kind is not null;

-- Dashboard: jobs by status and recency.
create index article_jobs_site_status_idx
  on public.article_jobs (site_id, status, updated_at desc);

-- Public article lists and sitemap.
create index articles_public_idx
  on public.articles (site_id, published_at desc)
  where status in ('published', 'verified');

create index provider_runs_job_stage_idx
  on public.provider_runs (job_id, stage, started_at desc);

create index job_events_timeline_idx
  on public.job_events (job_id, created_at, id);

create index audits_verdict_idx
  on public.audits (verdict, created_at desc);

create index publishing_logs_job_idx
  on public.publishing_logs (job_id, created_at desc);

create index worker_instances_last_seen_idx
  on public.worker_instances (last_seen_at desc);

-- Foreign keys used by artifact detail views.
create index sources_packet_idx on public.sources (research_packet_id);
create index claims_packet_idx on public.claims (research_packet_id);
create index claim_sources_source_idx on public.claim_sources (source_id);
create index drafts_job_idx on public.drafts (job_id, version desc);
create index images_job_idx on public.images (job_id, slot, version desc);
create index originality_checks_job_idx on public.originality_checks (job_id, created_at desc);
