"use client";

import { useEffect, useState } from "react";
import type { Deck } from "@/game/board";
import { MAPS } from "@/game/maps";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";
import type { PlayerSession } from "@/lib/session";
import { formatCAD } from "@/lib/money";
import { PLAYER_COLOR_HEX, PLAYER_COLOR_INK } from "@/lib/player-colors";
import { supabase } from "@/lib/supabase/client";
import { BoardEventLog } from "./BoardEventLog";
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

// (Fix B) The board's own centre now hosts the whole turn interface,
// stacked and centred: current player -> turn countdown (if a limit is
// set) -> dice -> the one primary action for this phase -> the event log
// filling whatever height is left. Everything that isn't a single-tap
// primary action for the CURRENT turn (the debt panel, jail options, the
// bankrupt-anytime button) stays in ActionBar in the sidebar — this only
// ever hosts what's happening right now.
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
    <div className="flex h-full w-full min-w-0 max-w-full flex-col items-center gap-1.5 px-2 pt-2 pb-1 text-center">
      <div className="flex min-w-0 max-w-full items-center gap-2">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm shadow ${PLAYER_COLOR_INK}`}
          style={{ backgroundColor: PLAYER_COLOR_HEX[currentPlayer.color] }}
          aria-hidden="true"
        >
          <TokenIcon token={currentPlayer.token} />
        </span>
        <span className="min-w-0 truncate text-sm font-semibold text-board-ink">
          {isMyTurn ? "Your turn" : `${currentPlayer.name}'s turn`}
        </span>
      </div>

      <TurnCountdownPill game={game} />

      <DiceRoller game={game} isMyTurn={isMyTurn} dispatch={dispatch} muted={muted} />

      {isMyTurn && game.turnPhase === "awaiting_end_turn" && (
        // bg-accent, not bg-surface-2: this is the one primary action for
        // this phase (same tier as Roll/Buy), and bg-surface-2 — built for
        // the dark sidebar — read as a washed-out, near-invisible box
        // against the board's own light surface.
        <button
          type="button"
          disabled={busy}
          onClick={handleEndTurn}
          className="min-w-0 max-w-full rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground transition-colors hover:brightness-110 disabled:opacity-40 sm:px-8 sm:py-3 sm:text-base"
        >
          End Turn
        </button>
      )}

      {isMyTurn && game.turnPhase === "awaiting_purchase" && <BuyPrompt game={game} busy={busy} setBusy={setBusy} dispatch={dispatch} />}

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

      {/* Generous gap ahead of the log — everything above it is one tight
          cluster (who's playing, the dice, the one thing to do about it);
          the log is a separate, lower-priority read, not part of that
          cluster, and the gap is what tells the eye that. */}
      <BoardEventLog
        gameId={game.id}
        players={game.state.players}
        spaces={map.spaces}
        jailLabel={map.jailLabel}
        deckLabels={map.deckLabels}
        className="mt-4 min-h-0 flex-1"
      />
    </div>
  );
}

// (Fix D) settings.auctionsEnabled decides the button pair entirely: OFF
// is Buy/Decline (declining always leaves it with the bank — no auction
// exists in this mode at all), ON is Buy/Auction (no plain decline once
// auctions are on — see handleDeclineBuy/handleStartAuction in engine.ts,
// which reject the action that doesn't match this setting server-side
// too, so this button set can never get out of sync with what the server
// will actually accept).
function BuyPrompt({
  game,
  busy,
  setBusy,
  dispatch,
}: {
  game: PublicGame;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  dispatch: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}) {
  const player = game.state.players[game.state.currentPlayerIndex];
  const space = MAPS[game.state.settings.mapId].spaces[player.position];
  if (space.type !== "property" && space.type !== "transport" && space.type !== "utility") return null;

  async function act(action: ClientAction) {
    setBusy(true);
    await dispatch(action);
    setBusy(false);
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-2">
      <p className="text-sm text-board-ink">
        Buy <span className="font-semibold">{space.name}</span> for <span className="font-semibold">{formatCAD(space.price)}</span>?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || player.cashCents < space.price}
          onClick={() => act({ type: "BUY" })}
          className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
        >
          Buy
        </button>
        {game.state.settings.auctionsEnabled ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act({ type: "START_AUCTION" })}
            className="flex-1 rounded-full bg-board-line/50 px-4 py-2.5 text-sm font-semibold text-board-ink disabled:opacity-40"
          >
            Auction
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => act({ type: "DECLINE_BUY" })}
            className="flex-1 rounded-full bg-board-line/50 px-4 py-2.5 text-sm font-semibold text-board-ink disabled:opacity-40"
          >
            Decline
          </button>
        )}
      </div>
    </div>
  );
}

// (Fix B item 4) Only ever appears when the host has set a turn time
// limit — shows the whole-turn countdown, not gated on whose turn it is,
// since watching the clock run out on someone ELSE's turn is exactly the
// point. Ticks locally off game.state.turnStartedAt rather than waiting
// on a server push every second.
function TurnCountdownPill({ game }: { game: PublicGame }) {
  const limitSeconds = game.state.settings.turnTimeLimitSeconds;
  const startedAt = game.state.turnStartedAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (limitSeconds <= 0) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [limitSeconds]);

  if (limitSeconds <= 0 || !startedAt) return null;

  const remaining = Math.max(0, Math.ceil((startedAt + limitSeconds * 1000 - now) / 1000));
  const urgent = remaining <= 10;

  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold tabular-nums ${
        urgent ? "bg-danger/20 text-danger" : "bg-board-line/40 text-board-ink/70"
      }`}
      aria-live="polite"
    >
      {remaining}s left this turn
    </span>
  );
}
