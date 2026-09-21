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

-- Topic discovery categories (20260921150000_topic_discovery.sql). Every daily target starts at 0,
-- so nothing is discovered until an editor sets one.
insert into public.topic_categories (site_id, slug, name, guidance, sort_order)
select s.id, c.slug, c.name, c.guidance, c.sort_order
from public.sites s
cross join (values
  (1, 'fintech-news', 'Fintech News',
   'Company news from Revolut, Monzo, Wise, Stripe, Klarna, PayPal, Adyen, Starling and other fintechs active in the UK: launches, results, funding, licences, leadership changes, and regulatory action.'),
  (2, 'ai-finance', 'AI & Finance',
   'AI advisers, agentic AI, AI trading tools, bank automation, and how financial institutions use AI in fraud, credit, compliance, and risk management.'),
  (3, 'payments', 'Payments',
   'Apple Pay, Google Pay, QR and instant payments, cross-border payments, payment APIs, merchant tools, and payment infrastructure.'),
  (4, 'open-banking', 'Open Banking',
   'UK open banking and open finance: APIs, variable recurring payments, bank connectivity, and the regulatory roadmap.'),
  (5, 'digital-banks', 'Digital Banks',
   'Revolut, Monzo, Starling, Chase UK, Kroo, bunq, N26, and other digital banks serving UK customers.'),
  (6, 'crypto-tokenisation', 'Crypto, Stablecoins & Tokenisation',
   'The financial and business side only: stablecoins, tokenised deposits and assets, institutional adoption, and UK regulation. Never crypto-price speculation.'),
  (7, 'fraud-security', 'Fraud & Cybersecurity',
   'Scams, APP fraud and reimbursement, AI-powered fraud, data breaches, AML, and identity verification.'),
  (8, 'business-fintech', 'Fintech for Business',
   'Payment processors, accounting fintech, expense cards, business banking, payroll, and embedded finance.'),
  (9, 'explainers', 'Explainers & Guides',
   'Evergreen explainers and guides that stay useful for years, prompted by a current development but written to last.'),
  (10, 'uk-fintech', 'UK Fintech',
   'The UK fintech sector itself: FCA, Bank of England, and Treasury decisions, investment, listings, and the London ecosystem.')
) as c (sort_order, slug, name, guidance)
where s.slug = 'fintechpulse'
on conflict (site_id, slug) do nothing;
