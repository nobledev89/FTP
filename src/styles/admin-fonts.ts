import { Geist, Geist_Mono } from "next/font/google";

// Admin is sans-first with mono for identifiers; no editorial serif (DESIGN-SYSTEM.md section 10).

const adminSans = Geist({
  variable: "--font-admin-sans",
  subsets: ["latin"],
  display: "swap",
});

const adminMono = Geist_Mono({
  variable: "--font-admin-mono",
  subsets: ["latin"],
  display: "swap",
});

export const adminFontVariables = `${adminSans.variable} ${adminMono.variable}`;
