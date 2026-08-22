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
  const [copied, setCopied] = useState(false);
  const [inspectedIndex, setInspectedIndex] = useState<number | null>(null);
  // (Task 6) The tile's own bounding rect at the moment it was clicked —
  // lets the property popover anchor itself next to that tile instead of
  // always opening dead centre. Cleared alongside inspectedIndex; kept
  // as-is across in-popover navigation (the region chip row), so browsing
  // sibling properties doesn't make the popover jump around.
  const [inspectAnchor, setInspectAnchor] = useState<DOMRect | undefined>(undefined);

  function handleInspect(index: number, anchor?: DOMRect) {
    setInspectedIndex(index);
    if (anchor) setInspectAnchor(anchor);
  }

  useEffect(() => {
    if (game && game.status === "lobby") {
      router.replace(`/game/${roomCode}/lobby`);
    }
  }, [game, roomCode, router]);

  useTurnWatchdog(game, dispatch);

  if (loading) return <CenteredMessage>Loading…</CenteredMessage>;
  if (error && !game) return <CenteredMessage>{error}</CenteredMessage>;
  if (!game || game.status === "lobby") return null;

  function copyRoomCode() {
    void navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // (Task 8) Three sections — Room · Players · Chat — separated by 24px
  // and a hairline, not cards nested inside cards. The "Landlord" wordmark
  // is gone: it was the largest text in the panel and the least useful
  // one, belonging in the lobby, not beside a live game. Room code at 28px
  // with a copy affordance takes its place — it's the thing people
  // actually read out loud to a friend.
  const panelContent = (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={copyRoomCode}
            className="group flex items-baseline gap-2 text-left"
            title="Copy room code"
          >
            <span className="text-[28px] leading-none font-bold tracking-[0.1em] text-ink">{roomCode}</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5 shrink-0 text-muted group-hover:text-ink"
              aria-hidden="true"
            >
              <rect x="9" y="9" width="12" height="12" rx="2" />
              <path d="M5 15V5a2 2 0 012-2h10" />
            </svg>
            <span className="text-[11px] text-muted">{copied ? "Copied" : ""}</span>
          </button>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-pressed={!muted}
            aria-label={muted ? "Unmute dice sound" : "Mute dice sound"}
            className="shrink-0 rounded-full bg-surface-2 p-2 text-ink"
          >
            {/* (Task 3) Drawn speaker glyph, not an emoji — a muted/x
                variant and an unmuted/waves variant sharing the same
                speaker body. */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
              {muted ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M15.5 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11" />}
            </svg>
          </button>
        </div>

        <div className="flex items-center justify-between gap-3">
          {/* (Task 8) Anchored to the room header, not floating loose. */}
          <Link href={`/game/${roomCode}/verify`} className="text-xs font-medium text-accent hover:brightness-110">
            Fairness →
          </Link>
          {game.status === "finished" && (
            <span className="text-xs font-semibold tracking-widest text-accent uppercase">Game over</span>
          )}
          {reconnecting && (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              Reconnecting…
            </span>
          )}
        </div>

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
      </section>

      <div className="border-t border-hair" />

      <section className="flex flex-col gap-3">
        <span className="px-1 text-xs font-semibold tracking-widest text-muted uppercase">Players</span>
        {game.status === "active" && <ActionBar game={game} session={session} dispatch={dispatch} />}
        <PlayerPanel game={game} session={session} />
        {/* (Task 8) Moved below the player list as a ghost button — it's
            not the most important thing on screen, so it doesn't get to
            sit above the players it trades between. */}
        {session && <TradePanel game={game} session={session} />}
      </section>

      <div className="border-t border-hair" />

      <ChatSection gameId={game.id} roomCode={roomCode} session={session} players={game.state.players} />

      {pending && <p className="text-center text-xs text-muted">Syncing…</p>}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col gap-8 bg-canvas px-4 py-8 pb-40 md:flex-row md:items-start md:justify-center md:gap-10 md:px-8 md:pb-8">
      <Board
        state={game.state}
        className="md:sticky md:top-8"
        onInspect={handleInspect}
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
          anchor={inspectAnchor}
          session={session}
          dispatch={dispatch}
          onClose={() => {
            setInspectedIndex(null);
            setInspectAnchor(undefined);
          }}
          onNavigate={(index) => setInspectedIndex(index)}
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
