import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { PublicShell } from "@/components/public/public-shell";
import { resolveSiteOrigin, siteConfig } from "@/lib/site/config";
import { publicFontVariables } from "@/styles/public-fonts";

import "@/styles/public.css";

export const metadata: Metadata = {
  metadataBase: resolveSiteOrigin(),
  applicationName: siteConfig.name,
  title: {
    default: `${siteConfig.name}: ${siteConfig.tagline}`,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  alternates: {
    canonical: "/",
    types: {
      "application/rss+xml": [{ title: `${siteConfig.name} RSS`, url: "/feed.xml" }],
    },
  },
  openGraph: {
    siteName: siteConfig.name,
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name}: ${siteConfig.tagline}`,
    description: siteConfig.description,
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function PublicRootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={publicFontVariables} lang={siteConfig.locale}>
      <body>
        <PublicShell>{children}</PublicShell>
      </body>
    </html>
  );
}
