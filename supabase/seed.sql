-- Seed data for local development and fresh environments. Idempotent.
-- Publication identity follows implementation plan section 2.1.

insert into public.sites (slug, name, canonical_origin, locale, timezone, currency, description, disclosure)
values (
  'fintechpulse',
  'FinTechPulse',
  'https://fintechpulse.co.uk',
  'en-GB',
  'Europe/London',
  'GBP',
  'News, analysis, and explainers on UK banking, payments, lending, investing, insurance, and regulation.',
  'FinTechPulse publishes general editorial information, not personalised financial, investment, tax, or legal advice.'
)
on conflict (slug) do nothing;

insert into public.site_settings (site_id, default_byline_name, seo_default_title, seo_default_description)
select id, 'FinTechPulse Editorial', 'FinTechPulse: UK finance and fintech',
       'News, analysis, and explainers on UK banking, payments, lending, investing, insurance, and regulation.'
from public.sites
where slug = 'fintechpulse'
on conflict (site_id) do nothing;

-- Version 1 defaults (plan section 10.2). API modes are never enabled by seed data.
insert into public.provider_settings (site_id, stage, mode)
select s.id, v.stage::public.pipeline_stage, v.mode::public.provider_mode
from public.sites s
cross join (values
  ('research', 'manual_chatgpt'),
  ('draft', 'claude_code'),
  ('revision', 'claude_code'),
  ('images', 'manual_gemini'),
  ('audit', 'manual_chatgpt'),
  ('publish', 'internal'),
  ('verify', 'internal')
) as v(stage, mode)
where s.slug = 'fintechpulse'
on conflict (site_id, stage) do nothing;
