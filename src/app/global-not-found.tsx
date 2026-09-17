import type { Metadata } from "next";

import { NotFoundContent } from "@/components/public/not-found-content";
import { PublicShell } from "@/components/public/public-shell";
import { siteConfig } from "@/lib/site/config";
import { publicFontVariables } from "@/styles/public-fonts";

import "@/styles/public.css";

// Unmatched URLs have no single root layout to render in (ADR 0004), so this page brings its own.
export const metadata: Metadata = {
  title: `Page not found | ${siteConfig.name}`,
  description: "The page you requested is not part of FinTechPulse.",
};

export default function GlobalNotFound() {
  return (
    <html className={publicFontVariables} lang={siteConfig.locale}>
      <body>
        <PublicShell>
          <NotFoundContent />
        </PublicShell>
      </body>
    </html>
  );
}
