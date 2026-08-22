"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionBar } from "@/components/ActionBar";
import { AuctionModal } from "@/components/AuctionModal";
import { Board } from "@/components/Board";
import { ChatSection } from "@/components/ChatSection";
import { MobileSheet } from "@/components/MobileSheet";
import { PlayerPanel } from "@/components/PlayerPanel";
import { TradePanel } from "@/components/TradePanel";
import { WinnerScreen } from "@/components/WinnerScreen";
import { PropertyInspector } from "@/components/PropertyInspector";
import { useGame } from "@/hooks/useGame";
import { useTurnWatchdog } from "@/hooks/useTurnWatchdog";

export default function BoardPage() {
  const { code } = useParams<{ code: string }>();
  const roomCode = code.toUpperCase();
  const router = useRouter();
  const { game, loading, error, session, pending, reconnecting, dispatch, simulateDisconnect } = useGame(roomCode);

  const [muted, setMuted] = useState(true);
  const [inspectedIndex, setInspectedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (game && game.status === "lobby") {
      router.replace(`/game/${roomCode}/lobby`);
    }
  }, [game, roomCode, router]);

  useTurnWatchdog(game, dispatch);

  if (loading) return <CenteredMessage>Loading…</CenteredMessage>;
  if (error && !game) return <CenteredMessage>{error}</CenteredMessage>;
  if (!game || game.status === "lobby") return null;

  const panelContent = (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium tracking-widest text-muted uppercase">Room {roomCode}</span>
          <h1 className="text-lg font-bold text-ink">{game.status === "finished" ? "Game over" : "Landlord"}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-pressed={!muted}
            aria-label={muted ? "Unmute dice sound" : "Mute dice sound"}
            className="rounded-full bg-surface-2 p-2 text-ink"
          >
            {/* (Task 3) Drawn speaker glyph, not an emoji — a muted/x
                variant and an unmuted/waves variant sharing the same
                speaker body. */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
              {muted ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M15.5 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11" />}
            </svg>
          </button>
          <Link href={`/game/${roomCode}/verify`} className="text-xs font-medium text-accent hover:brightness-110">
            Fairness →
          </Link>
        </div>
      </div>

      {reconnecting && (
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-surface-2 px-4 py-2.5 text-center text-xs text-ink">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Reconnecting…
        </div>
      )}

      {/* Dev-only resilience testing (scenario 26) — simulateDisconnect is
          undefined in production, so this never renders there. */}
      {simulateDisconnect && (
        <button
          type="button"
          onClick={() => simulateDisconnect(10_000)}
          className="rounded-full border border-dashed border-accent/40 px-4 py-2 text-center text-xs font-medium text-accent"
        >
          Simulate disconnect (10s)
        </button>
      )}

      {!session && (
        <div className="rounded-2xl bg-surface-2 px-4 py-2.5 text-center text-xs text-muted">
          You&apos;re spectating — this game already started before you joined.
        </div>
      )}

      {game.status === "active" && (
        <>
          <ActionBar game={game} session={session} dispatch={dispatch} />
          {session && <TradePanel game={game} session={session} />}
        </>
      )}

      <PlayerPanel game={game} session={session} dispatch={dispatch} onInspect={setInspectedIndex} />
      <ChatSection gameId={game.id} roomCode={roomCode} session={session} players={game.state.players} />

      {pending && <p className="text-center text-xs text-muted">Syncing…</p>}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col gap-8 bg-canvas px-4 py-8 pb-40 md:flex-row md:items-start md:justify-center md:gap-10 md:px-8 md:pb-8">
      <Board
        state={game.state}
        className="md:sticky md:top-8"
        onInspect={setInspectedIndex}
        game={game}
        session={session}
        dispatch={dispatch}
        muted={muted}
      />

      <MobileSheet>{panelContent}</MobileSheet>

      {game.status === "finished" && game.state.winnerPlayerId && <WinnerScreen game={game} roomCode={roomCode} />}

      <AuctionModal game={game} session={session} dispatch={dispatch} />

      {inspectedIndex !== null && (
        <PropertyInspector
          state={game.state}
          spaceIndex={inspectedIndex}
          onClose={() => setInspectedIndex(null)}
          onNavigate={setInspectedIndex}
        />
      )}
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 text-center text-muted">
      {children}
    </div>
  );
}
