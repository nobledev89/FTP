import { EmptyState } from "@/components/public/empty-state";
import { Container } from "@/components/public/layout";
import { Masthead } from "@/components/public/masthead";

// The dateline should not go stale on a statically rendered page.
export const revalidate = 3600;

/**
 * Home. Phase 7 replaces the empty state with the featured story and latest stream read from
 * Supabase; until then no article content exists to show.
 */
export default function HomePage() {
  return (
    <>
      <Masthead date={new Date()} />
      <Container className="pb-20">
        <EmptyState eyebrow="Latest" title="The first articles are on their way.">
          <p>
            Reporting and analysis on UK banking, payments, lending, investing, insurance, and
            regulation.
          </p>
        </EmptyState>
      </Container>
    </>
  );
}
