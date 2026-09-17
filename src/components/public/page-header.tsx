// Adapted from Paperframe `CollectionPageHeader` (MIT), see THIRD_PARTY_NOTICES.md.
import { Eyebrow } from "@/components/public/meta";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  summary?: string;
};

export function PageHeader({ eyebrow, title, summary }: PageHeaderProps) {
  return (
    <header className="border-b border-line pb-8">
      <Eyebrow className="mb-4">{eyebrow}</Eyebrow>
      <h1 className="font-serif text-5xl font-semibold leading-none tracking-tight text-ink sm:text-6xl">
        {title}
      </h1>
      {summary ? <p className="mt-6 max-w-3xl text-lg leading-8 text-muted">{summary}</p> : null}
    </header>
  );
}
