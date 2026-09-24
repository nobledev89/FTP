import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { Container } from "@/components/public/layout";
import { SafeMarkdown } from "@/components/public/markdown";
import { PageHeader } from "@/components/public/page-header";
import { CANONICAL_ORIGIN, siteConfig } from "@/lib/site/config";

export type InfoPageContent = Readonly<{
  path: string;
  eyebrow: string;
  title: string;
  summary: string;
  markdown: string;
}>;

/** Metadata for a publisher trust page. */
export function infoPageMetadata(page: InfoPageContent): Metadata {
  const url = `${CANONICAL_ORIGIN}${page.path}`;
  return {
    title: page.title,
    description: page.summary,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title: `${page.title} | ${siteConfig.name}`,
      description: page.summary,
    },
  };
}

/** About, standards, AI policy, corrections, and contact share one readable layout. */
export function InfoPage({ page, children }: { page: InfoPageContent; children?: ReactNode }) {
  return (
    <Container className="py-14 sm:py-16 lg:py-20" width="article">
      <Breadcrumbs items={[{ name: page.title, href: page.path }]} />
      <PageHeader eyebrow={page.eyebrow} summary={page.summary} title={page.title} />
      <div className="mt-4">
        <SafeMarkdown markdown={page.markdown} />
      </div>
      {children}
    </Container>
  );
}
