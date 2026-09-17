import { Geist, Geist_Mono, Noto_Serif_SC } from "next/font/google";

// Paperframe three-role type system (docs/DESIGN-SYSTEM.md section 2).

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const notoSerif = Noto_Serif_SC({
  variable: "--font-noto-serif-sc",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});

export const publicFontVariables = [
  geistSans.variable,
  geistMono.variable,
  notoSerif.variable,
].join(" ");
