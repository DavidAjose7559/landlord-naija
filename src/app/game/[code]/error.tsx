"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";

export default function GameError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ code: string }>();
  const roomCode = params?.code?.toUpperCase();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-6 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-ink">This screen hit a snag.</h1>
        <p className="text-sm text-muted">
          {roomCode ? `Room ${roomCode} is still live on the server` : "Your game is still live on the server"} —
          this was just a display error.
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
