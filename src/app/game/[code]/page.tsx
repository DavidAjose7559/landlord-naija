"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Money } from "@/components/Money";
import { useGame } from "@/hooks/useGame";
import { PLAYER_TOKEN_EMOJI } from "@/lib/tokens";

export default function BoardPage() {
  const { code } = useParams<{ code: string }>();
  const roomCode = code.toUpperCase();
  const router = useRouter();
  const { game, loading, error, session, pending } = useGame(roomCode);

  useEffect(() => {
    if (game && game.status === "lobby") {
      router.replace(`/game/${roomCode}/lobby`);
    }
  }, [game, roomCode, router]);

  if (loading) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }
  if (error && !game) {
    return <CenteredMessage>{error}</CenteredMessage>;
  }
  if (!game || game.status === "lobby") return null;

  const currentPlayer = game.state.players[game.state.currentPlayerIndex];

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-10 bg-canvas px-6 py-16">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-widest text-muted uppercase">Room {roomCode}</span>
          <h1 className="text-2xl font-bold text-ink">
            {game.status === "finished" ? "Game over" : "The board"}
          </h1>
        </div>
        <Link href={`/game/${roomCode}/verify`} className="text-sm font-medium text-accent hover:brightness-110">
          Fairness →
        </Link>
      </div>

      {game.status === "active" && currentPlayer && (
        <div className="flex items-center gap-3 rounded-2xl bg-surface px-5 py-4">
          <span className="text-2xl">{PLAYER_TOKEN_EMOJI[currentPlayer.token]}</span>
          <span className="text-sm text-ink">
            <span className="font-semibold">{currentPlayer.name}</span>
            {currentPlayer.id === session?.playerId ? " (you)" : ""} — {phaseLabel(game.turnPhase)}
          </span>
          {pending && <span className="ml-auto animate-pulse text-xs text-muted">syncing…</span>}
        </div>
      )}

      {game.status === "finished" && (
        <div className="rounded-2xl bg-surface px-5 py-4 text-center">
          <p className="text-sm text-ink">
            {game.state.winnerPlayerId
              ? `${game.state.players.find((p) => p.id === game.state.winnerPlayerId)?.name ?? "A player"} wins!`
              : "The game has ended."}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {game.state.players.map((player) => (
          <div
            key={player.id}
            className={`flex items-center gap-4 rounded-2xl px-5 py-3 ${
              player.id === currentPlayer?.id && game.status === "active" ? "bg-surface-2" : "bg-surface"
            } ${player.bankrupt ? "opacity-40" : ""}`}
          >
            <span className="text-2xl">{PLAYER_TOKEN_EMOJI[player.token]}</span>
            <span className="flex-1 text-left font-medium text-ink">
              {player.name}
              {player.id === session?.playerId ? " (you)" : ""}
              {player.bankrupt ? " — bankrupt" : ""}
            </span>
            <Money cents={player.cashCents} className="font-semibold text-ink" />
          </div>
        ))}
      </div>

      <p className="text-center text-sm text-muted">The full board is coming next — this is live game state.</p>
    </div>
  );
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "awaiting_roll":
      return "waiting to roll";
    case "awaiting_purchase":
      return "deciding whether to buy";
    case "awaiting_payment":
      return "settling a payment";
    case "awaiting_card":
      return "drawing a card";
    case "awaiting_end_turn":
      return "wrapping up their turn";
    default:
      return phase;
  }
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 text-center text-muted">
      {children}
    </div>
  );
}
