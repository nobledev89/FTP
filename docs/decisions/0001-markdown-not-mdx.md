# ADR 0001: Article bodies are Markdown, not MDX

- Status: Accepted
- Date: 2026-09-17

## Context

Paperframe, the public design reference, renders local `.mdx` files through `next-mdx-remote/rsc`.
FinTechPulse article bodies come from AI providers or are pasted in by an operator. They are stored in
Postgres and published without code review. MDX compiles to JavaScript, so every MDX body is
executable code. Treating provider output as code would let a single bad or malicious response cause
cross-site scripting or server-side code execution.

## Decision

- Canonical draft and published bodies are CommonMark/GFM Markdown stored as text.
- Rendering uses a Markdown parser with raw HTML disabled and an explicit component allowlist that
  matches `docs/DESIGN-SYSTEM.md`.
- Links and image sources are validated. Links must use `http(s)` and get safe external-link
  attributes. Images may come only from the configured public Storage origin.
- Sources, captions, and image metadata are structured database fields, not embedded HTML.
- Paperframe's MDX loader, `gray-matter` front matter, and build-time slug enumeration are not used.

## Consequences

- Articles cannot embed interactive components. If that is needed later, it will be a new, reviewed,
  allowlisted directive syntax, not MDX.
- A malicious-Markdown fixture suite is required and runs in CI (Phase 7).
- Provider output is never passed to `dangerouslySetInnerHTML`.
