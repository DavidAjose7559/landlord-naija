"use client";

import { useEffect, useState } from "react";
import type { Deck } from "@/game/board";
import { netWorth } from "@/game/engine";
import { MAPS } from "@/game/maps";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";
import { formatCAD } from "@/lib/money";
import type { PlayerSession } from "@/lib/session";
import { supabase } from "@/lib/supabase/client";

interface ActionBarProps {
  game: PublicGame;
  session: PlayerSession | null;
  dispatch: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}

interface DrawnCard {
  deck: Deck;
  text: string;
}

const DECK_STYLE: Record<Deck, string> = {
  treasure: "bg-[#3a2a05] border-2 border-[#D4A017] text-[#F5D98B]",
  surprise: "bg-[#3a0a0a] border-2 border-[#8B1A1A] text-[#F0A5A5]",
};

export function ActionBar({ game, session, dispatch }: ActionBarProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [drawnCard, setDrawnCard] = useState<DrawnCard | null>(null);

  const map = MAPS[game.state.settings.mapId];
  const me = session ? game.state.players.find((p) => p.id === session.playerId) : undefined;
  const isMyTurn = me?.id === game.state.players[game.state.currentPlayerIndex]?.id;

  useEffect(() => {
    setDrawnCard(null);
  }, [game.turnPhase, game.rollIndex]);

  async function act(action: ClientAction) {
    setBusy(true);
    setMessage(null);
    const result = await dispatch(action);
    if (result && !result.ok) setMessage(result.reason ?? "That didn't work.");
    setBusy(false);
    return result;
  }

  async function handleDrawCard() {
    const result = await act({ type: "DRAW_CARD" });
    if (!result?.ok) return;
    const { data } = await supabase
      .from("events")
      .select("payload")
      .eq("game_id", game.id)
      .eq("type", "CARD_DRAWN")
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    const payload = data?.payload as { deck?: Deck; text?: string } | undefined;
    if (payload?.deck && payload.text) {
      setDrawnCard({ deck: payload.deck, text: payload.text });
    }
  }

  if (!me || me.bankrupt) return null;

  return (
    <div className="flex flex-col gap-3">
      {drawnCard && (
        <div className={`flex flex-col gap-3 rounded-2xl p-5 ${DECK_STYLE[drawnCard.deck]}`}>
          <span className="text-xs font-semibold tracking-widest uppercase opacity-80">
            {map.deckLabels[drawnCard.deck]}
          </span>
          <p className="text-base leading-snug font-medium">{drawnCard.text}</p>
          <button
            type="button"
            onClick={() => setDrawnCard(null)}
            className="self-end rounded-full bg-black/20 px-4 py-1.5 text-xs font-semibold hover:bg-black/30"
          >
            Continue
          </button>
        </div>
      )}

      {!isMyTurn ? (
        <p className="text-center text-sm text-muted">Waiting for your turn…</p>
      ) : (
        <>
          {me.inJail && game.turnPhase === "awaiting_roll" && (
            <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
              <span className="text-sm text-ink">
                You&apos;re in {map.jailLabel} (turn {me.jailTurns + 1} of 3).
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || me.cashCents < 5000}
                  onClick={() => act({ type: "PAY_JAIL_FINE" })}
                  className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-40"
                >
                  Pay $50
                </button>
                {me.jailFreeCards > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act({ type: "USE_JAIL_FREE" })}
                    className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                  >
                    Use jail-free card
                  </button>
                )}
              </div>
            </div>
          )}

          {game.turnPhase === "awaiting_purchase" && <BuyPrompt game={game} busy={busy} act={act} />}

          {game.turnPhase === "awaiting_tax_choice" && game.state.pendingTaxChoice && (
            <TaxChoicePrompt game={game} busy={busy} act={act} />
          )}

          {game.turnPhase === "awaiting_payment" && game.state.pendingDebt && (
            <div className="flex flex-col gap-3 rounded-2xl bg-surface px-4 py-4">
              <p className="text-sm text-ink">
                You owe <span className="font-semibold">{formatCAD(game.state.pendingDebt.amount)}</span>
                {game.state.pendingDebt.reason === "rent" ? " in rent" : game.state.pendingDebt.reason === "tax" ? " in tax" : ""}.
                {me.cashCents < game.state.pendingDebt.amount && " Mortgage or sell a house to raise cash first."}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || me.cashCents < game.state.pendingDebt.amount}
                  onClick={() => act({ type: "PAY_RENT" })}
                  className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
                >
                  Pay {formatCAD(game.state.pendingDebt.amount)}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act({ type: "DECLARE_BANKRUPT" })}
                  className="rounded-full bg-danger/20 px-4 py-2.5 text-sm font-semibold text-danger disabled:opacity-40"
                >
                  Declare bankrupt
                </button>
              </div>
            </div>
          )}

          {game.turnPhase === "awaiting_card" && !drawnCard && (
            <button
              type="button"
              disabled={busy}
              onClick={handleDrawCard}
              className={`rounded-2xl px-6 py-4 text-base font-semibold ${
                game.state.pendingCardDeck ? DECK_STYLE[game.state.pendingCardDeck] : ""
              } disabled:opacity-60`}
            >
              Draw {game.state.pendingCardDeck ? map.deckLabels[game.state.pendingCardDeck] : ""} card
            </button>
          )}

          {game.turnPhase === "awaiting_end_turn" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act({ type: "END_TURN" })}
              className="rounded-full bg-surface-2 px-8 py-3 text-base font-semibold text-ink transition-colors hover:bg-white/10 disabled:opacity-40"
            >
              End Turn
            </button>
          )}
        </>
      )}

      {message && <p className="text-center text-xs text-danger">{message}</p>}
    </div>
  );
}

function BuyPrompt({
  game,
  busy,
  act,
}: {
  game: PublicGame;
  busy: boolean;
  act: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}) {
  const player = game.state.players[game.state.currentPlayerIndex];
  const space = MAPS[game.state.settings.mapId].spaces[player.position];
  if (space.type !== "property" && space.type !== "transport" && space.type !== "utility") return null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface px-4 py-4">
      <p className="text-sm text-ink">
        Buy <span className="font-semibold">{space.name}</span> for{" "}
        <span className="font-semibold">{formatCAD(space.price)}</span>?
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
        <button
          type="button"
          disabled={busy}
          onClick={() => act({ type: "DECLINE_BUY" })}
          className="flex-1 rounded-full bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

function TaxChoicePrompt({
  game,
  busy,
  act,
}: {
  game: PublicGame;
  busy: boolean;
  act: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}) {
  const player = game.state.players[game.state.currentPlayerIndex];
  const spaceIndex = game.state.pendingTaxChoice?.spaceIndex;
  const space = spaceIndex !== undefined ? MAPS[game.state.settings.mapId].spaces[spaceIndex] : undefined;
  if (!space || space.type !== "tax" || !space.choice) return null;

  const percentAmount = Math.round((netWorth(game.state, player.id) * space.choice.percentOfNetWorth) / 100);

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface px-4 py-4">
      <p className="text-sm text-ink">
        <span className="font-semibold">{space.name}</span> — pay a flat amount, or a percentage of your net worth?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => act({ type: "CHOOSE_TAX", option: "flat" })}
          className="flex-1 rounded-full bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
        >
          Pay {formatCAD(space.choice.flatAmountCents)}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act({ type: "CHOOSE_TAX", option: "percent" })}
          className="flex-1 rounded-full bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
        >
          Pay {space.choice.percentOfNetWorth}% ({formatCAD(percentAmount)})
        </button>
      </div>
    </div>
  );
}
