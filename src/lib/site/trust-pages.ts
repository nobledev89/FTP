/**
 * Publisher trust pages (docs/SEO-GROWTH-PLAN.md section 5.1).
 *
 * The copy describes what the publishing system actually does, as implemented in this repository:
 * the discovery, research, drafting, image, audit, and auto-publication stages, and the admin
 * controls an editor has. Publisher facts come from `publisherFacts` and are omitted when unknown.
 * When the pipeline changes, change this copy in the same commit.
 */

import type { InfoPageContent } from "@/components/public/info-page";

import { EDITORIAL_TEAM, publisherFacts, siteConfig, type PublisherFacts } from "./config";
import { authorHref } from "./structured-data";
import { topicHref, TOPICS } from "./topics";

const name = siteConfig.name;

function publisherSection(facts: PublisherFacts): string {
  const lines = [
    facts.legalName ? `- **Publisher:** ${facts.legalName}` : null,
    facts.location ? `- **Based in:** ${facts.location}` : null,
    facts.foundingYear ? `- **Publishing since:** ${facts.foundingYear}` : null,
    facts.editor ? `- **${facts.editor.role}:** ${facts.editor.name}` : null,
  ].filter((line): line is string => line !== null);
  return lines.length > 0 ? `## Who publishes ${name}\n\n${lines.join("\n")}\n` : "";
}

export function aboutPage(facts: PublisherFacts = publisherFacts): InfoPageContent {
  const topics = TOPICS.map((topic) => `- [${topic.title}](${topicHref(topic)})`).join("\n");
  return {
    path: "/about",
    eyebrow: "About",
    title: `About ${name}`,
    summary: `${name} is a UK publication covering payments, open banking, fintech regulation, fraud, and the companies building financial services.`,
    markdown: `
${name} reports on the rules, institutions, products, and technology that shape UK finance, and on what a policy change means for the firms and people it affects. It is written for people who build, run, invest in, regulate, or use UK financial services.

## What we cover

${topics}

Every article is written for a UK reader. Rules and figures carry their jurisdiction and effective date, and a development outside the UK is labelled as such.

## How articles are made

${name} is produced with an automated editorial pipeline. AI systems help find stories, gather and check sources, draft articles, create illustrations, and audit drafts before publication, under rules and limits an editor sets. The [AI policy](/ai-policy) explains each stage and where a person is involved; the [editorial standards](/editorial-standards) set out how sources are chosen and checked.

Articles from the desk carry the byline [${EDITORIAL_TEAM.name}](${authorHref(EDITORIAL_TEAM.name)}).

${publisherSection(facts)}
## What ${name} is not

${siteConfig.disclosure} Nothing here is a recommendation to buy, sell, or apply for any product. Where a reader might act on an article, it points to the official source.

## Corrections

How material errors are handled is set out in the [corrections policy](/corrections).
`,
  };
}

export function editorialStandardsPage(): InfoPageContent {
  return {
    path: "/editorial-standards",
    eyebrow: "Standards",
    title: "Editorial standards",
    summary: `How ${name} chooses sources, checks claims, labels content, and updates or withdraws articles.`,
    markdown: `
## Sources

Articles are built from published, citable sources. Primary sources come first, in this order where they apply: the FCA, the PRA and Bank of England, HM Treasury, the Payment Systems Regulator, the CMA, Companies House, the ONS, UK legislation, and official filings; then a company's own announcements; then other reporting.

- Every claim a reasonable reader could dispute is traceable to a listed source.
- Sources, URLs, quotations, filing numbers, and dates are never invented.
- When sources conflict, the conflict is reported rather than resolved silently.
- A fact that cannot be sourced is left out and recorded as an uncertainty.
- ${name} does not currently use anonymous sources.

Each article ends with its source list, showing the publisher, the publication date where known, and the date the source was accessed.

## Figures, dates, and jurisdiction

Every figure carries its unit, currency, period, and as-of date. Rates, fees, thresholds, and rules carry an effective date. UK rules are distinguished from EU, US, or other rules, and a non-UK development is labelled.

## Risk and advice

A product that can lose money or affect credit is described with its risk. ${siteConfig.disclosure}

## Checks before publication

Before an article can be published it is audited against its research and this style guide for:

- factual errors and claims with no source behind them;
- contradictions with the sources or within the article;
- weaker sources used where a primary source was available;
- stale or undated rates, fees, and rules, and missing jurisdiction;
- missing risk context;
- wording lifted from a source rather than written fresh;
- repetition, unclear sentences, grammar, and British spelling;
- whether the article answers what a UK reader came to find out.

An article with a serious finding is revised and audited again. One that still fails, or that raises a compliance question or a genuine conflict between sources, is held for an editor. An article that repeats a story already published is held rather than published.

## Labelling

Articles are labelled by topic, and the type of piece (news, analysis, explainer, or guide) determines how it is structured. Published and updated dates are shown on every article.

## Commercial content

${name} does not currently publish sponsored articles, advertorials, or affiliate links, and no one pays for coverage. If that changes, paid content will be labelled clearly on the article and any paid links will carry \`rel="sponsored"\`.

## Updates, corrections, and withdrawal

An article changed after publication shows an Updated date. How material errors are handled is set out in the [corrections policy](/corrections). An article that should not have been published is withdrawn and no longer served.

## Automation

How AI systems are used, and where a person is involved, is set out in the [AI policy](/ai-policy).
`,
  };
}

export function aiPolicyPage(): InfoPageContent {
  return {
    path: "/ai-policy",
    eyebrow: "Standards",
    title: "AI policy",
    summary: `Exactly how ${name} uses automation to find, research, write, illustrate, check, and publish articles, and what a person decides.`,
    markdown: `
${name} is produced with an automated editorial pipeline. This page describes each stage as it works today.

## Discovery

Through the day, an automated search looks at recent news in each topic the editor has switched on and proposes stories. The editor sets the topics, what each covers, and how many articles each may produce per day. A proposed story that repeats one already published or scheduled is dropped.

## Research

An AI system gathers sources for the story, preferring the primary UK sources listed in the [editorial standards](/editorial-standards). It records each disputable claim with the sources that support or contradict it, the jurisdiction and effective date where they apply, and what it could not establish.

## Drafting

An AI system writes the article from that research, under a written style guide. The style guide requires every disputable claim to be traceable to a source and forbids invented sources, quotations, people, and dates.

## Illustration

Hero images are editorial illustrations, not photographs. Most are created by an AI image model from a brief written for the article. They are illustrative only and do not depict real events. The image rules forbid text, real logos and trade dress, and recognisable real people. An editor can replace any image.

## Audit

A separate AI audit checks the draft against its research and the style guide: facts, sourcing, contradictions, stale figures, jurisdiction, risk context, copied wording, clarity, and usefulness. A draft with a serious finding is revised and audited again. Articles opted into automatic publishing use both revision cycles before publication; any remaining findings stay attached to the internal record for the owner's same-day review and possible withdrawal. Editor-created articles continue to wait for explicit approval.

## Publication

Not every article is read by a person before it is published. An article that automated discovery proposed may publish on its own only when all of these hold:

- its automated audit and revision cycle has completed;
- it has a hero image;
- its headline does not repeat an article already published or scheduled;
- the day's article limit set by the editor has not been reached.

Automatically published articles are spaced through the day. A missing image, likely duplicate, or full daily schedule still holds an article back. Residual audit findings do not create an approval task after both automatic revisions have been used; they remain visible to the owner for the same-day review. Articles an editor commissions directly are published when the editor chooses.

## What a person decides

The editor sets the topics, daily volume, style guide, and the instructions each stage follows; reviews published output and any article held by the pipeline; and can correct, replace the image of, or withdraw any published article. Responsibility for everything ${name} publishes rests with the publisher, not with the software.

## What automation is never used for

- inventing sources, quotations, interviews, data, or people;
- presenting an AI illustration as a photograph of a real event;
- personalised financial, investment, tax, or legal advice.
`,
  };
}

export function correctionsPage(): InfoPageContent {
  return {
    path: "/corrections",
    eyebrow: "Standards",
    title: "Corrections",
    summary: `How ${name} handles errors in published articles.`,
    markdown: `
${name} takes material errors seriously and handles them in the open.

## What counts as a material error

A wrong fact, figure, date, name, or rule; a claim the listed sources do not support; or a misdescribed jurisdiction or risk.

## How an error is handled

Published articles are fixed snapshots: their text is not silently rewritten. When a material error is found, the article is withdrawn and no longer served. Where the story still merits coverage, a corrected article is published in its place.

## Reporting an error

To report an error, use the [contact form](/contact) and choose "Report an error or correction". Include the article address, what you believe is wrong, and a source if you have one.

Our approach to sources and checking is set out in the [editorial standards](/editorial-standards).
`,
  };
}

export function contactPage(): InfoPageContent {
  return {
    path: "/contact",
    eyebrow: "Contact",
    title: `Contact ${name}`,
    summary: `Write to ${name} about an article, a correction, rights, or anything else.`,
    markdown: `
Messages go to the editor. We read everything and reply by email when a response is needed. Corrections are handled under the [corrections policy](/corrections).
`,
  };
}
