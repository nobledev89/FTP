# ADR 0004: Separate root layouts for public and admin

- Status: Accepted
- Date: 2026-09-17

## Context

The public publication follows Paperframe's editorial language: serif mastheads, generous whitespace,
and thin stone borders. The admin is a dense operational tool. A shared layout tends to leak public
chrome (fixed header, masthead fonts, prose styles) into admin screens, and admin concerns (session
checks, client state) into public pages that should stay cacheable.

## Decision

- `src/app/(public)` and `src/app/(admin)` are route groups. Each has its own root layout
  (`<html>`/`<body>`), font loading, and stylesheet.
- Public components live in `src/components/public` and admin components in `src/components/admin`.
  `src/components/shared` holds only primitives with no visual system of their own.
- Admin routes never import public layout components. An ESLint `no-restricted-imports` rule enforces
  this in both directions.
- Metadata routes (`robots`, `sitemap`, `feed.xml`) and API route handlers sit outside both groups.

## Consequences

- Navigating between public and admin triggers a full page load. This is acceptable: they are separate
  applications that share a deployment.
- Each group defines its own not-found and error UI, and a global not-found page covers unmatched
  URLs.
