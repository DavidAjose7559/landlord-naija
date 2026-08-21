import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Baked into the client bundle at build time so a bug report can
    // record exactly which deploy the reporter was actually running —
    // Vercel sets VERCEL_GIT_COMMIT_SHA (server-only) automatically on
    // every build; this just re-exposes it under the NEXT_PUBLIC_ prefix
    // Next.js requires for anything read client-side. "local-dev" (not
    // "unknown", and not empty) outside Vercel — e.g. `pnpm dev` — so a
    // report's "Commit: local-dev" is distinguishable at a glance from a
    // genuine "we have no idea" case (a row from before this field
    // existed), rather than both collapsing into the same vague label.
    NEXT_PUBLIC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "local-dev",
  },
};

export default nextConfig;
