"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-6 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-ink">Something went wrong.</h1>
        <p className="text-sm text-muted">
          That&apos;s on us, not you — your game state is safe on the server either way.
        </p>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground transition-colors hover:brightness-110"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full bg-surface px-6 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-2"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
