// Adapted from Paperframe `HeroSection` (MIT), see THIRD_PARTY_NOTICES.md.
// Statistics row removed; dateline uses the editorial timezone. Mobile size is fluid (deviation D13).
import { Container } from "@/components/public/layout";
import { formatDateline, toIsoString } from "@/lib/format/date";
import { siteConfig } from "@/lib/site/config";

type MastheadProps = {
  /** Date shown in the dateline; pass the request or build time. */
  date: Date;
};

export function Masthead({ date }: MastheadProps) {
  const accentWord = "Pulse";
  const brandPrefix = siteConfig.name.endsWith(accentWord)
    ? siteConfig.name.slice(0, -accentWord.length)
    : siteConfig.name;

  return (
    <section aria-labelledby="masthead-title" className="bg-paper">
      <Container className="pb-10 pt-8 sm:pb-12 sm:pt-10 lg:pb-14">
        <div className="mb-6 flex items-baseline gap-4 font-mono text-[11px] uppercase tracking-[0.24em] text-subtle sm:mb-8">
          <time dateTime={toIsoString(date)}>{formatDateline(date)}</time>
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
          <span className="hidden sm:inline">{siteConfig.tagline}</span>
        </div>
        <div className="grid items-end gap-6 lg:grid-cols-12 lg:gap-10">
          <h1
            aria-label={siteConfig.name}
            className="whitespace-nowrap font-serif text-[clamp(2.75rem,14vw,4.5rem)] font-semibold leading-[0.95] tracking-tight text-ink sm:text-8xl lg:col-span-9 lg:text-[5.75rem]"
            id="masthead-title"
          >
            <span aria-hidden="true">{brandPrefix}</span>
            {brandPrefix !== siteConfig.name ? (
              <span aria-hidden="true" className="text-signal">
                {accentWord}
              </span>
            ) : null}
          </h1>
          <p className="max-w-md border-l-4 border-signal pl-5 font-serif text-xl leading-snug text-muted sm:text-2xl lg:col-span-3">
            {siteConfig.positioning}
          </p>
        </div>
        <div className="mt-8 grid border-y border-line sm:grid-cols-[auto_1fr]">
          <p className="bg-signal px-4 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white">
            On our radar
          </p>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-subtle">
            {siteConfig.coverage.map((topic) => (
              <li key={topic}>{topic}</li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
