import type { Metadata } from "next";
import { Archivo, Geist, Geist_Mono, Oswald } from "next/font/google";
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

// Design system v2: the display face for board tiles (and, from task 4,
// headings/the wordmark) — a true variable font (wdth + wght axes,
// self-hosted at build time by next/font, no explicit weight array
// needed since it isn't a static-weight family). Board.tsx sets its own
// 'wdth'/'wght' via fontVariationSettings per element; this just gets the
// font itself onto the page.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  // Without this, next/font subsets the variable font down to just the
  // wght axis and bakes wdth to its default (100) — Board.tsx's `'wdth'
  // 76` in fontVariationSettings would then have nothing to actually
  // move, silently rendering full-width text that overflows every tile.
  axes: ["wdth"],
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
      className={`${geistSans.variable} ${geistMono.variable} ${oswald.variable} ${archivo.variable} h-full antialiased`}
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
