import type { Metadata } from "next";
import { Archivo, Geist_Mono, Inter } from "next/font/google";
import { BugReportButton } from "@/components/BugReportButton";
import { DiagnosticsBoot } from "@/components/DiagnosticsBoot";
import "./globals.css";

// (Task 4) Inter for all interface text and every number — replaces
// Geist Sans as the app's default sans. Every number reads
// font-variant-numeric: tabular-nums (see the `body` rule in
// globals.css), which Inter supports natively.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Design system v2: the display face for board tiles, headings, and the
// wordmark (task 4) — a true variable font (wdth + wght axes,
// self-hosted at build time by next/font, no explicit weight array
// needed since it isn't a static-weight family). Consumers set their own
// 'wdth'/'wght' via fontVariationSettings per element; this just gets the
// font itself onto the page. Oswald (the old heritage-only display face)
// is gone entirely — Original uses Archivo like every other map now,
// task 4's "not a new typeface" allowance.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  // Without this, next/font subsets the variable font down to just the
  // wght axis and bakes wdth to its default (100) — a `'wdth' 76` in
  // fontVariationSettings would then have nothing to actually move,
  // silently rendering full-width text that overflows every tile.
  axes: ["wdth"],
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
      className={`${inter.variable} ${geistMono.variable} ${archivo.variable} h-full antialiased`}
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
