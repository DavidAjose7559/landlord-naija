"use client";

import { useEffect, useState } from "react";
import type { Deck } from "@/game/board";
import { MAPS } from "@/game/maps";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";
import type { PlayerSession } from "@/lib/session";
import { PLAYER_TOKEN_COLOR } from "@/lib/tokens";
import { supabase } from "@/lib/supabase/client";
import { DiceRoller } from "./DiceRoller";
import { TokenIcon } from "./TokenIcon";

interface BoardCenterControlsProps {
  game: PublicGame;
  session: PlayerSession | null;
  dispatch: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
  muted: boolean;
}

interface DrawnCard {
  deck: Deck;
  text: string;
}

const DECK_STYLE: Record<Deck, string> = {
  treasure: "bg-gold/15 border-2 border-gold text-gold",
  surprise: "bg-magenta/15 border-2 border-magenta text-magenta",
};

// (Section 4d) "The single biggest legibility win" — Roll, End Turn, and
// Draw Card move from the sidebar into the board's own dead centre,
// directly beneath the dice, in this fixed vertical order: current-player
// line, dice, primary action. Everything else that isn't a single-tap
// primary action (buy/decline, the debt panel, jail options, ...) stays in
// ActionBar in the sidebar — this only ever hosts the one thing you're
// blocked on right now.
export function BoardCenterControls({ game, session, dispatch, muted }: BoardCenterControlsProps) {
  const [busy, setBusy] = useState(false);
  const [drawnCard, setDrawnCard] = useState<DrawnCard | null>(null);

  const map = MAPS[game.state.settings.mapId];
  const currentPlayer = game.state.players[game.state.currentPlayerIndex];
  const isMyTurn = session?.playerId === currentPlayer?.id;

  useEffect(() => {
    setDrawnCard(null);
  }, [game.turnPhase, game.rollIndex]);

  async function handleDrawCard() {
    setBusy(true);
    const result = await dispatch({ type: "DRAW_CARD" });
    if (result?.ok) {
      const { data } = await supabase
        .from("events")
        .select("payload")
        .eq("game_id", game.id)
        .eq("type", "CARD_DRAWN")
        .order("seq", { ascending: false })
        .limit(1)
        .maybeSingle();
      const payload = data?.payload as { deck?: Deck; text?: string } | undefined;
      if (payload?.deck && payload.text) setDrawnCard({ deck: payload.deck, text: payload.text });
    }
    setBusy(false);
  }

  async function handleEndTurn() {
    setBusy(true);
    await dispatch({ type: "END_TURN" });
    setBusy(false);
  }

  if (game.status !== "active" || !currentPlayer) return null;

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col items-center gap-3 px-2 text-center">
      <div className="flex min-w-0 max-w-full items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm shadow"
          style={{ backgroundColor: PLAYER_TOKEN_COLOR[currentPlayer.token] }}
          aria-hidden="true"
        >
          <TokenIcon token={currentPlayer.token} />
        </span>
        <span className="min-w-0 truncate text-sm font-semibold text-board-ink">
          {isMyTurn ? "Your turn" : `${currentPlayer.name}'s turn`}
        </span>
      </div>

      <DiceRoller game={game} isMyTurn={isMyTurn} dispatch={dispatch} muted={muted} />

      {isMyTurn && game.turnPhase === "awaiting_end_turn" && (
        <button
          type="button"
          disabled={busy}
          onClick={handleEndTurn}
          className="min-w-0 max-w-full rounded-full bg-surface-2 px-6 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-white/10 disabled:opacity-40 sm:px-8 sm:py-3 sm:text-base"
        >
          End Turn
        </button>
      )}

      {isMyTurn && game.turnPhase === "awaiting_card" && !drawnCard && (
        <button
          type="button"
          disabled={busy}
          onClick={handleDrawCard}
          className={`min-w-0 max-w-full rounded-2xl px-4 py-2.5 text-xs font-semibold sm:px-6 sm:py-3 sm:text-sm ${
            game.state.pendingCardDeck ? DECK_STYLE[game.state.pendingCardDeck] : ""
          } disabled:opacity-60`}
        >
          Draw {game.state.pendingCardDeck ? map.deckLabels[game.state.pendingCardDeck] : ""} card
        </button>
      )}

      {drawnCard && (
        <div className={`flex w-full max-w-xs flex-col gap-3 rounded-2xl p-4 text-left shadow-lg ${DECK_STYLE[drawnCard.deck]}`}>
          <span className="text-xs font-semibold tracking-widest uppercase opacity-80">
            {map.deckLabels[drawnCard.deck]}
          </span>
          <p className="text-sm leading-snug font-medium">{drawnCard.text}</p>
          <button
            type="button"
            onClick={() => setDrawnCard(null)}
            className="self-end rounded-full bg-black/20 px-4 py-1.5 text-xs font-semibold hover:bg-black/30"
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
