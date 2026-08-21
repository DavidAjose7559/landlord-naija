import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (Grammarly, etc.) inject
          data-gr-* attributes onto <body> before React hydrates, which would
          otherwise report as a false-positive mismatch every time. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <DiagnosticsBoot />
        {children}
      </body>
    </html>
  );
}
