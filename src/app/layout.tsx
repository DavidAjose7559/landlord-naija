import type { Metadata } from "next";
import { Geist, Geist_Mono, Oswald } from "next/font/google";
import { BugReportButton } from "@/components/BugReportButton";
import { DiagnosticsBoot } from "@/components/DiagnosticsBoot";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Heritage theme's display face for property names/prices (see
// --font-board-display in globals.css) — only ever rendered where
// [data-theme="heritage"] is in scope, i.e. a room on the 'original' map.
// next/font self-hosts it at build time (no runtime Google Fonts request,
// no FOIT/layout-shift risk) and loading it here, once, for every route
// means it's already warm by the time a heritage room needs it.
const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["500", "700"],
});

// Needed so the opengraph-image below resolves to an absolute URL —
// without it, share previews (WhatsApp, etc.) can silently fail to load
// the image. VERCEL_URL is populated automatically by Vercel; no extra
// env var to configure.
const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "LANDLORD — Naija Edition",
  description: "Buy Lagos. Own Naija.",
  openGraph: {
    title: "LANDLORD — Naija Edition",
    description: "Buy Lagos. Own Naija.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${oswald.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (Grammarly, etc.) inject
          data-gr-* attributes onto <body> before React hydrates, which would
          otherwise report as a false-positive mismatch every time. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <DiagnosticsBoot />
        {children}
        {/* Mounted after {children} (and above every fixed overlay via
            z-[60]) so it always sits on top of full-screen takeovers like
            WinnerScreen, not behind them — see BugReportButton.tsx. */}
        <BugReportButton />
      </body>
    </html>
  );
}
