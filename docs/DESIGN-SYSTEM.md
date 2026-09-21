# Design system

Status: design lock for Phase 1, pending owner design review  
Public baseline: [Afeng01/paperframe](https://github.com/Afeng01/paperframe) at commit
`c4a904200dc39fbffd8adaac5c726886d8893ac9` (`v0.2.0`, 2026-06-21), frozen  
Source of the rules: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md), section 6

FinTechPulse has two visual systems that share a deployment and nothing else:

- **Public publication**: Paperframe's editorial grammar, adapted for a UK financial publication.
- **Admin**: a dense, sans-first operations tool.

This document is the gate for public UI work. A change that breaks a rule here needs a recorded
deviation (section 12) before it merges. Upstream Paperframe changes are never adopted automatically.

## 1. Implementation map

| Concern                    | Location                                                                     |
| -------------------------- | ---------------------------------------------------------------------------- |
| Public tokens, base styles | `src/styles/public.css`                                                      |
| Public fonts               | `src/styles/public-fonts.ts`                                                 |
| Public components          | `src/components/public/`                                                     |
| Public root layout         | `src/app/(public)/layout.tsx`                                                |
| Public design fixtures     | `src/app/(public)/design-review/` (disabled in Vercel production)            |
| Admin tokens, base styles  | `src/styles/admin.css`                                                       |
| Admin components           | `src/components/admin/`                                                      |
| Admin root layout          | `src/app/(admin)/admin/layout.tsx`                                           |
| Admin token sheet          | `src/app/(admin)/admin/design-review/` (disabled in Vercel production)       |
| Unmatched-URL 404          | `src/app/global-not-found.tsx` (public styling)                              |
| Automated guards           | `src/components/public/design-guard.test.ts`, ESLint `no-restricted-imports` |

Public CSS scans only public sources and admin CSS only admin sources, so utilities from one system
never ship in the other's stylesheet.

## 2. Typography (public)

### 2.1 Families

| Role           | Token        | Stack                                                                        | Use                                                                   |
| -------------- | ------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Editorial      | `font-serif` | Noto Serif SC (400, 600, 700; Latin subset), Georgia, Times New Roman, serif | Masthead, page and article headings, pull quotes, featured-story text |
| Interface/body | `font-sans`  | Geist Sans, Arial, Helvetica, sans-serif                                     | Navigation, summaries, article body, UI labels                        |
| Metadata       | `font-mono`  | Geist Mono, ui-monospace, Consolas, monospace                                | Dates, categories, source metadata, small utility copy                |

All three load through `next/font/google` with `display: swap` and self-hosting.

### 2.2 Scale

Tailwind sizes are listed for implementers; pixel values are the contract.

| Element         | Mobile                   | Larger screens                      | Weight / leading / tracking                   |
| --------------- | ------------------------ | ----------------------------------- | --------------------------------------------- |
| Masthead        | 14vw, 44–72px (D13)      | 96px `sm:text-8xl`, 92px at desktop | serif 600, `leading-[0.95]`, `tracking-tight` |
| Page/article H1 | 48px `text-5xl`          | 60px `sm:text-6xl`                  | serif 600, `leading-tight`, `tracking-tight`  |
| Section H2      | 36px `text-4xl`          | 48px `sm:text-5xl`                  | serif 600, `leading-none` to `leading-[1.1]`  |
| Article H2      | 30px `text-3xl`          | 36px `sm:text-4xl`                  | serif 600, `leading-tight`                    |
| Article H3      | 24px `text-2xl`          | 24px                                | serif 600, `leading-snug`                     |
| Featured title  | 36px `text-4xl`          | 48px `sm:text-5xl`                  | serif 600                                     |
| Card title      | 24px `text-2xl`          | 24px                                | serif 600, `leading-snug`                     |
| Stream title    | 20px `text-xl`           | 20px                                | serif 400, `leading-snug`                     |
| Body/prose      | 18px `text-lg`           | 18px                                | sans 400, 32px `leading-8`                    |
| Supporting copy | 14–16px `text-sm`/`base` | 14–16px                             | `leading-6` to `leading-7`                    |
| Eyebrow         | 11px `text-[11px]`       | 11px                                | uppercase, `tracking-[0.24em]`                |
| Metadata        | 10–11px                  | 10–11px                             | uppercase, `tracking-[0.18em]`                |

Rules:

- Serif is for headings and editorial moments only. Never use it for admin data, form controls, or
  paragraphs of body copy.
- Uppercase is for metadata and eyebrows at 10–11px only.
- Long titles wrap; they are never truncated with an ellipsis on public pages.
- Public `h1`–`h3` use `overflow-wrap: break-word`, so long single words never cause horizontal scrolling at
  375px. Automatic hyphenation stays off because it splits ordinary headline words mid-word.

## 3. Width, grid, and spacing

| Token               | Value                     | Tailwind                       |
| ------------------- | ------------------------- | ------------------------------ |
| Shell max width     | 64rem (1024px)            | `max-w-5xl`                    |
| Article canvas      | 56rem (896px)             | `max-w-4xl`                    |
| Prose measure       | 46rem (736px)             | `max-w-prose-measure`          |
| Summary measure     | at most 48rem (768px)     | `max-w-3xl`                    |
| Gutters             | 16 / 24 / 32px            | `px-4 sm:px-6 lg:px-8`         |
| Fixed header height | 56px                      | `h-14`, shell `pt-14`          |
| Section padding     | 56px, 64px, 80px vertical | `py-14 sm:py-16 lg:py-20`      |
| Detail page padding | at least 40px             | `py-10`                        |
| Major separation    | 80 / 96 / 128px           | `py-20`, `py-24`, `py-32` only |

Grid: a 12-column grid for asymmetric editorial features (featured story 7/5, stream 4/8). Collections
are one column on mobile, two from 640px, and three from 1024px only where density supports it.
Default gaps are 16, 24, 32, 40, 48, and 64px.

Whitespace is structural. Do not fill empty regions with decorative cards, metrics, blobs, or
gradients.

## 4. Colour and borders (public)

### 4.1 Tokens

The public stylesheet removes Tailwind's default palette. Only these colours exist on public pages.

| Token          | Value     | Use                                                     |
| -------------- | --------- | ------------------------------------------------------- |
| `paper`        | `#ffffff` | Page canvas                                             |
| `ink`          | `#1c1917` | Headings, primary text, focus outline on light surfaces |
| `muted`        | `#57534e` | Body prose, summaries, metadata on `wash`               |
| `subtle`       | `#78716c` | Metadata and eyebrows on `paper` only                   |
| `line`         | `#d6d3d1` | Primary 1px separators, image rings                     |
| `line-soft`    | `#e7e5e4` | Secondary separators, header border                     |
| `wash`         | `#f5f5f4` | Image placeholders, inline code, quiet panels           |
| `signal`       | `#2737a8` | Brand wordmark, editorial labels, short accent rules    |
| `signal-soft`  | `#eef1ff` | Reserved pale brand surface                             |
| `dark-surface` | `#0c0a09` | Intentional dark editorial sections, mobile menu        |
| `dark-line`    | `#44403c` | Separators on dark surfaces                             |
| `dark-copy`    | `#d6d3d1` | Body copy on dark surfaces                              |
| `dark-subtle`  | `#a8a29e` | Metadata on dark surfaces (see deviation D2)            |
| `white`        | `#ffffff` | Headings and focus outline on dark surfaces             |

### 4.2 Measured contrast (WCAG 2.2)

| Pair                            | Ratio   | Allowed for                 |
| ------------------------------- | ------- | --------------------------- |
| `ink` on `paper`                | 17.49:1 | All text                    |
| `muted` on `paper`              | 7.63:1  | All text                    |
| `subtle` on `paper`             | 4.80:1  | All text, including 10–11px |
| `subtle` on `wash`              | 4.40:1  | **Not allowed** for text    |
| `muted` on `wash`               | 6.99:1  | All text                    |
| `signal` on `paper`             | 9.55:1  | All text and brand details  |
| `white` on `signal`             | 9.55:1  | All text                    |
| `dark-copy` on `dark-surface`   | 13.26:1 | All text                    |
| `dark-subtle` on `dark-surface` | 7.83:1  | All text                    |
| `line` on `paper`               | 1.49:1  | Decorative separators only  |

`src/components/public/design-guard.test.ts` recomputes these ratios from `public.css`.

### 4.3 Rules

- Type size, weight, space, and the grid create hierarchy. `signal` is a restrained brand accent for
  the wordmark, section flags, and short rules; it does not replace structural hierarchy.
- Borders are 1px. Prefer top and bottom separators to boxed cards.
- No gradients, glass panels (backdrop blur), glow, or drop shadows. The public stylesheet removes the
  shadow and blur scales, and the design guard test rejects gradient, shadow, and blur utilities.
- The public canvas is light, with intentional dark editorial sections. There is no global dark mode in
  version 1. If one is added, it must use semantic tokens and be tested on every article element.

## 5. Images

| Ratio key  | Aspect | Use                                   |
| ---------- | ------ | ------------------------------------- |
| `card`     | 16:9   | Standard cards, related articles      |
| `feature`  | 4:5    | Featured story, portrait editorial    |
| `hero`     | 16:9   | Default article hero                  |
| `hero-3-2` | 3:2    | Article hero when metadata selects it |

- Square corners. A 2–4px radius is allowed only where technically useful.
- `object-cover` on a `wash` placeholder with a 1px `line` ring.
- Hover: scale to 1.03 over 700ms inside a `group` link. No lift, no shadow. Removed under reduced
  motion.
- Alt text is required whenever an image renders. A missing image renders the neutral placeholder
  block with no text and is `aria-hidden`.
- Captions are optional, `text-sm text-muted`, below the image, visually subordinate.
- Generated images store focal point and crop metadata (Phase 2 schema) for responsive cropping.

## 6. Navigation, header, and footer

Header:

- Fixed, 56px, 1px `line-soft` bottom border, `paper` at 95% opacity. No backdrop blur (deviation D1).
- The wordmark is serif 18px semibold on the left.
- Desktop navigation appears from 768px: 11px uppercase, `tracking-[0.18em]`, `subtle`, with a
  bottom border that appears on hover and for the current page.
- Every navigation target is at least 40px tall, even though its visible styling stays typographic.
- A "Skip to content" link is the first focusable element.

Mobile menu (below 768px):

- Full-screen `dark-surface` overlay with 30px serif links separated by `dark-line` rules.
- The toggle has `aria-expanded` and `aria-controls` and an accessible name of "Open menu" or "Close
  menu". The three-bar icon morphs into a visible close (X) state.
- When open: focus moves to the first link, Escape closes and returns focus to the toggle, page content
  behind the overlay is `inert`, and page scroll is locked.
- When closed, the overlay is `inert` and hidden from assistive technology.
- The menu closes on navigation and when the viewport grows past 768px.

Footer:

- 1px `line-soft` top border. Publication name (serif 24px) and description on the left; compact
  uppercase links on the right from 1024px; stacked on mobile.
- Carries the publication-level disclosure: FinTechPulse publishes general editorial information, not
  personalised financial, investment, tax, or legal advice.
- Copyright line in `font-mono` metadata style.

## 7. Buttons, links, controls, and motion

- Primary public calls to action are text links: 11px uppercase with a 1px bottom border that darkens
  on hover.
- In-prose links: inherit colour, 1px `line` bottom border, `ink` border on hover.
- When a button is necessary: rectangular, 1px `line` border, 0–4px radius, direct inversion on hover
  (`ink` background, `paper` text). No pill buttons.
- Pills (`rounded-full`) are limited to compact status or category controls in `pill.tsx`.
- Focus: a 2px solid outline with a 3px offset, `ink` on light surfaces and `white` on dark ones.
  Never remove focus styles without a visible replacement.
- Motion is limited to colour and border changes, subtle list indentation on hover (4px to 12px
  padding), the mobile menu fade, and the gentle image scale.
- `prefers-reduced-motion: reduce` removes transforms, shortens transitions to at most 1ms, and turns
  off smooth scrolling.
- Prohibited: scroll-jacking, animated counters, blobs, parallax, entrance animations, and `animate-*`
  utilities.

## 8. Article typography map

Markdown bodies render through an allowlisted component map (`src/components/public/prose.tsx`).
Raw HTML is disabled (ADR 0001). The map is the only way article elements get styles.

| Element      | Treatment                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| `h2`         | serif 30/36px 600, `mt-12`, `leading-tight`, `tracking-tight`, `ink`                                            |
| `h3`         | serif 24px 600, `mt-10`, `leading-snug`, `ink`                                                                  |
| `h4`         | sans 18px 600, `mt-8`, `ink`                                                                                    |
| `p`          | sans 18px/32px, `mt-5`, `muted`                                                                                 |
| `ul` / `ol`  | 18px/32px, `mt-5`, `pl-5`, `space-y-3`, disc / decimal markers                                                  |
| `blockquote` | serif 24px/40px, `mt-8`, 1px `line` left rule, `pl-6`, `ink`                                                    |
| `a`          | inherit colour, 1px `line` bottom border, `ink` on hover; external links get `rel`                              |
| `strong`     | 600, `ink`                                                                                                      |
| `em`         | italic, `muted`                                                                                                 |
| `code`       | Geist Mono 0.95em on `wash`, 4px radius, `px-1.5`                                                               |
| `pre`        | Geist Mono 14px on `wash`, 1px `line-soft` border, horizontal scroll, `mt-6`                                    |
| `hr`         | 1px `line-soft`, `mt-10`                                                                                        |
| `table`      | 16px sans, full width inside a horizontally scrollable wrapper, 1px row separators, mono uppercase header cells |
| `img`        | Only from the configured public Storage origin, via the image component (Phase 7)                               |

The prose column is capped at 46rem inside the 56rem article canvas. The first child has no top
margin.

## 9. Public page composition

`/` (home):

1. Masthead: a mono dateline row, oversized two-colour wordmark, positioning statement, and a compact
   coverage rail.
2. Front-page lead: one dominant 3:2 story and up to two supporting image stories in an 8/4 news grid.
3. Latest desk: up to four numbered dispatches in a high-contrast two-column section.
4. More from the desk: up to three remaining stories in a responsive card row, shown only when real
   published content is available.
5. Footer.

With no published articles, the home page shows the masthead and a single restrained empty state. It
does not show fixture content.

`/blog` (archive): page header (eyebrow, H1, summary, bottom rule), numbered stream on `paper`, and
text-link pagination ("Newer" / "Older" with a mono page count).

`/blog/[slug]` (article):

1. Header: category eyebrow, H1, excerpt (`max-w-3xl`), byline, and published / updated dates as
   `<time>` elements.
2. Hero image (16:9 or 3:2) with an optional caption.
3. Prose body in the measure.
4. Article-level disclosure note.
5. Sources: a numbered, structured list (publisher, title link, published date, accessed date).
6. Related articles: 16:9 cards, one, two, or three columns.

Paperframe's hero statistics, project and service grids, contact block, and language toggle are not
used.

## 10. Admin visual system

The admin is a separate application. It shares no layout, font loading, stylesheet, or component
with the public site.

| Token             | Value                 | Use                                                    |
| ----------------- | --------------------- | ------------------------------------------------------ |
| `canvas`          | `#fafafa`             | App background                                         |
| `panel`           | `#ffffff`             | Tables, panels, forms                                  |
| `border`          | `#e4e4e7`             | Panel and row separators                               |
| `border-strong`   | `#71717a`             | Form control borders (4.83:1; non-text minimum 3:1)    |
| `text`            | `#18181b`             | Primary text                                           |
| `text-muted`      | `#52525b`             | Secondary text, table headers                          |
| `text-subtle`     | `#71717a`             | Timestamps (4.83:1 on `panel`, 4.63:1 on `canvas`)     |
| `accent`          | `#1d4ed8`             | Primary buttons, links, focus ring (6.70:1 with white) |
| `success` / `-bg` | `#166534` / `#f0fdf4` | Complete, published, verified                          |
| `warning` / `-bg` | `#92400e` / `#fffbeb` | Waiting for input, stale, scheduled                    |
| `danger` / `-bg`  | `#991b1b` / `#fef2f2` | Failed, needs human, offline                           |
| `info` / `-bg`    | `#1e40af` / `#eff6ff` | Active processing                                      |
| `neutral` / `-bg` | `#3f3f46` / `#f4f4f5` | Idle, paused, draft                                    |

- Typography: Geist Sans 14px base, 13px table text, 12px labels. Geist Mono for IDs, versions,
  durations, and timestamps. No serif anywhere.
- Radii: 4px controls, 6px panels. Borders are 1px.
- Status badges always combine colour with a text label; colour alone never carries meaning.
- Editorial screens name a job's state in the reader's words (Needs you, In progress, Ready to
  publish, Scheduled, Live, Stopped) and keep the exact database status in the badge's tooltip and
  under Technical details. Operational screens (logs, technical details) keep the database value as
  the label. See docs/ADMIN-CONSOLE.md.
- The draft preview is admin type, not public type: sans throughout, 15px body, one measure of at
  most 42rem. It never borrows the public stylesheet, masthead, or editorial cards.
- Layout: a persistent 224px sidebar on desktop and a top bar with a disclosure menu on mobile. Content
  is at most 80rem wide.
- Density: 36px table rows and 32px controls (40px targets on touch layouts).
- Prohibited in admin: masthead, serif display type, editorial cards, and the public header or footer.

## 11. Verification

Automated (run in CI):

- The design guard test rejects gradient, shadow, blur, `animate-*`, and default-palette colour
  utilities in public components, and `rounded-full` outside `pill.tsx`. It also verifies that token
  contrast pairs meet section 4.2.
- ESLint `no-restricted-imports` blocks public imports from admin code and the reverse.
- Unit tests cover the mobile menu's accessibility behaviour, en-GB / Europe/London date formatting,
  and site configuration.
- Playwright (`pnpm test:e2e`) loads the design fixtures at 375, 768, 1024, and 1440px. It asserts that
  there is no horizontal overflow, that the header is 56px, and that the mobile menu is keyboard-
  operable, and it saves screenshots for review.

Manual review checklist, at 375 / 768 / 1024 / 1440px:

- [ ] Fonts load (serif headings, Geist body, Geist Mono metadata) without layout shift.
- [ ] Prose line length stays within 42–48rem.
- [ ] Content clears the fixed header on every page and on anchor jumps.
- [ ] Archive density and numbering read well; long titles wrap cleanly.
- [ ] Image crops hold at 16:9, 4:5, and 3:2; missing images show the neutral placeholder.
- [ ] Source list, disclosure note, and footer disclosure are legible and subordinate.
- [ ] Mobile menu opens and closes by pointer and keyboard; focus is visible everywhere.
- [ ] Reduced motion removes image scale and menu transitions.
- [ ] The admin token sheet shares no public chrome and reads as a separate application.

## 12. Deviations from Paperframe

| ID  | Paperframe (`c4a9042`)                                    | FinTechPulse                                                        | Reason                                                                                                                 |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| D1  | Header `bg-white/90 backdrop-blur-md`                     | `paper` at 95% opacity, no blur                                     | Plan 6.3 prohibits glass panels; plan 6.5 asks for mostly opaque                                                       |
| D2  | Dark stream metadata `text-stone-500` (4.12:1)            | `dark-subtle` `#a8a29e` (7.83:1)                                    | 10–11px text must meet 4.5:1                                                                                           |
| D3  | Mobile menu hides with opacity only; links stay focusable | `inert` when closed, Escape, focus management, scroll lock          | Keyboard and screen-reader access (plan 6.5)                                                                           |
| D4  | Section padding `py-20` at all sizes                      | `py-14 sm:py-16 lg:py-20`                                           | Plan 6.2 reduces small-screen padding to 56–64px                                                                       |
| D5  | Stream rows use a 2/3/7 column grid at every width        | Number and date stack above the title below 640px                   | Titles were about 200px wide at 375px                                                                                  |
| D6  | Nav links have no minimum hit area                        | 40px minimum target height                                          | Plan 6.5 hit-area requirement                                                                                          |
| D7  | MDX component map via `next-mdx-remote`                   | Markdown component allowlist, raw HTML disabled                     | ADR 0001                                                                                                               |
| D8  | Tailwind default palette (`stone-*`)                      | Default palette removed; semantic tokens with the plan's hex values | Enforces restrained colour; Tailwind 4 `stone` values are OKLCH approximations                                         |
| D9  | Bilingual `en`/`zh`, locale transitions                   | Single `en-GB` locale, no locale animation                          | UK-first publication (plan 2.1)                                                                                        |
| D10 | Global `not-found.tsx` inside one root layout             | `global-not-found.tsx` plus per-group `not-found.tsx`               | Separate public and admin root layouts (ADR 0004)                                                                      |
| D11 | Dates `MM/DD/YYYY` (en-US) or `YYYY/MM/DD` (zh-CN)        | `17 Sept 2026` / `17 September 2026`, Europe/London                 | UK-readable day-month-year (plan 2.1)                                                                                  |
| D12 | No skip link                                              | "Skip to content" link                                              | Keyboard access                                                                                                        |
| D13 | Masthead fixed at 60px on mobile (`text-6xl`)             | `clamp(2.75rem, 14vw, 4.5rem)` below 640px                          | The fluid size keeps the wordmark inside the 343px column at 375px while permitting stronger hierarchy on wider phones |
| D14 | Monochrome brand and one featured 7/5 story               | Blue-violet brand signal and an 8/4 multi-story front-page grid     | A denser modern-newspaper hierarchy makes the homepage more scannable while keeping the restrained editorial system    |
