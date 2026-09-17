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
  return (
    <section aria-labelledby="masthead-title" className="bg-paper">
      <Container className="pb-14 pt-10 sm:pb-16 sm:pt-14 lg:pb-20">
        <div className="mb-8 flex items-baseline gap-4 font-mono text-[11px] uppercase tracking-[0.24em] text-subtle sm:mb-10">
          <time dateTime={toIsoString(date)}>{formatDateline(date)}</time>
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
          <span className="hidden sm:inline">{siteConfig.tagline}</span>
        </div>
        <h1
          className="font-serif text-[clamp(2.5rem,14vw,3.75rem)] font-semibold leading-[1.05] tracking-tight text-ink sm:text-7xl lg:text-8xl"
          id="masthead-title"
        >
          {siteConfig.name}
        </h1>
        <p className="mt-6 max-w-2xl font-serif text-2xl leading-snug text-muted sm:text-3xl">
          {siteConfig.positioning}
        </p>
      </Container>
    </section>
  );
}
