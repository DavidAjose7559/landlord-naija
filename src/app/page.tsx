"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/games", { method: "POST" });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "failed to create game",
        );
      }
      const roomCode = (body as { roomCode: string }).roomCode;
      router.push(`/game/${roomCode}/lobby`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create game");
      setCreating(false);
    }
  }

  function handleJoinSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = roomCodeInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setError("room codes are 6 letters/numbers");
      return;
    }
    router.push(`/game/${code}/lobby`);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-12 bg-canvas px-6 text-center">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">LANDLORD — Naija Edition</h1>
        <p className="text-lg text-muted">Buy Lagos. Own Naija.</p>
      </div>

      {!joining ? (
        <div className="flex flex-col gap-4 sm:flex-row">
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="rounded-full bg-accent px-8 py-3 text-base font-semibold text-accent-foreground transition-colors hover:brightness-110 disabled:opacity-60"
          >
            {creating ? "Creating…" : "Create Game"}
          </button>
          <button
            type="button"
            onClick={() => setJoining(true)}
            className="rounded-full bg-surface px-8 py-3 text-base font-semibold text-ink transition-colors hover:bg-surface-2"
          >
            Join Game
          </button>
        </div>
      ) : (
        <form onSubmit={handleJoinSubmit} className="flex flex-col items-center gap-4">
          <input
            autoFocus
            value={roomCodeInput}
            onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
            placeholder="ROOM CODE"
            maxLength={6}
            className="w-48 rounded-full bg-surface px-6 py-3 text-center text-lg font-semibold tracking-[0.3em] text-ink placeholder:text-muted placeholder:tracking-normal focus:outline-none"
          />
          <div className="flex gap-3">
            <button
              type="submit"
              className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground transition-colors hover:brightness-110"
            >
              Join
            </button>
            <button
              type="button"
              onClick={() => {
                setJoining(false);
                setError(null);
              }}
              className="rounded-full px-6 py-2.5 text-sm font-semibold text-muted transition-colors hover:text-ink"
            >
              Back
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <Link href="/rules" className="text-sm font-medium text-muted hover:text-ink">
        How to play →
      </Link>
    </div>
  );
}
