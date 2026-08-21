import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Baked into the client bundle at build time so a bug report can
    // record exactly which deploy the reporter was actually running —
    // Vercel sets VERCEL_GIT_COMMIT_SHA (server-only) automatically on
    // every build; this just re-exposes it under the NEXT_PUBLIC_ prefix
    // Next.js requires for anything read client-side. Empty string (not
    // undefined) outside Vercel, e.g. local dev.
    NEXT_PUBLIC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
};

export default nextConfig;
