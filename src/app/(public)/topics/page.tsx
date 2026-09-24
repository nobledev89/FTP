import type { Metadata } from "next";
import Link from "next/link";

import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { Container } from "@/components/public/layout";
import { PageHeader } from "@/components/public/page-header";
import { CANONICAL_ORIGIN, siteConfig } from "@/lib/site/config";
import { topicHref, TOPICS } from "@/lib/site/topics";

const description =
  "FinTechPulse coverage by topic: UK payments, open banking, fintech regulation, fraud and security, and fintech companies and funding.";

export const metadata: Metadata = {
  title: "Topics",
  description,
  alternates: { canonical: `${CANONICAL_ORIGIN}/topics` },
  openGraph: {
    type: "website",
    url: `${CANONICAL_ORIGIN}/topics`,
    title: `Topics | ${siteConfig.name}`,
    description,
  },
};

export default function TopicsPage() {
  return (
    <Container className="py-14 sm:py-16 lg:py-20">
      <Breadcrumbs items={[{ name: "Topics", href: "/topics" }]} />
      <PageHeader eyebrow="Coverage" summary={description} title="Topics" />
      <ul className="mt-10 border-t border-line">
        {TOPICS.map((topic) => (
          <li className="border-b border-line-soft" key={topic.slug}>
            <Link
              className="group block px-1 py-6 transition-[padding] duration-300 hover:px-3 motion-reduce:transition-none motion-reduce:hover:px-1"
              href={topicHref(topic)}
            >
              <h2 className="font-serif text-2xl font-semibold leading-snug tracking-tight text-ink transition-colors group-hover:text-muted">
                {topic.title}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{topic.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
