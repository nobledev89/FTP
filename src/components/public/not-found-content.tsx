// Adapted from Paperframe `not-found` (MIT), see THIRD_PARTY_NOTICES.md.
import { Container } from "@/components/public/layout";
import { Eyebrow } from "@/components/public/meta";
import { ButtonLink } from "@/components/public/text-link";

export function NotFoundContent() {
  return (
    <Container className="flex min-h-[70vh] flex-col justify-center py-20" width="narrow">
      <Eyebrow>404</Eyebrow>
      <h1 className="mt-4 font-serif text-5xl font-semibold leading-tight tracking-tight text-ink sm:text-6xl">
        This page is not in the publication.
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">
        The link may be out of date, or the article may not have been published yet.
      </p>
      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href="/">Back to the front page</ButtonLink>
        <ButtonLink href="/blog">Browse the latest</ButtonLink>
      </div>
    </Container>
  );
}
