import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { adminFontVariables } from "@/styles/admin-fonts";

import "@/styles/admin.css";

export const metadata: Metadata = {
  title: {
    default: "FinTechPulse Admin",
    template: "%s | FinTechPulse Admin",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#fafafa",
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={adminFontVariables} lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
