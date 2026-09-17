import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Container } from "@/components/public/layout";
import { designReviewEnabled } from "@/lib/site/config";

export const metadata: Metadata = {
  title: "Design review",
  robots: { index: false, follow: false },
};

export default function DesignReviewLayout({ children }: { children: ReactNode }) {
  if (!designReviewEnabled()) {
    notFound();
  }

  return (
    <>
      <div className="border-b border-line-soft bg-wash">
        <Container>
          <p className="py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            Design review fixture. Sample content, not published.
          </p>
        </Container>
      </div>
      {children}
    </>
  );
}
