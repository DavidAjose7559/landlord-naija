"use client";

import { useEffect, useState } from "react";
import type { Deck } from "@/game/board";
import { computeDebtReliefPlan } from "@/game/engine";
import { MAPS } from "@/game/maps";
import type { PlayerState } from "@/game/types";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";
import { formatCAD } from "@/lib/money";
import type { PlayerSession } from "@/lib/session";
import { supabase } from "@/lib/supabase/client";
import { Modal } from "./Modal";

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
  treasure: "bg-gold/15 border-2 border-gold text-gold",
  surprise: "bg-magenta/15 border-2 border-magenta text-magenta",
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

  const debtor =
    game.turnPhase === "awaiting_payment" ? game.state.players[game.state.currentPlayerIndex] : undefined;

  if (!me) return null;

  return (
    <div className="flex flex-col gap-3">
      {game.status === "active" && game.state.settings.allowManualBankruptcy && !me.bankrupt && (
        <ManualBankruptcyButton busy={busy} act={act} />
      )}

      {!me.bankrupt && drawnCard && (
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

      {!me.bankrupt && game.turnPhase === "awaiting_payment" && !isMyTurn && debtor && (
        <p className="text-center text-sm text-muted">Waiting for {debtor.name} to settle a debt.</p>
      )}

      {!me.bankrupt && game.turnPhase === "awaiting_auction" && game.state.pendingAuction && (
        <>
          {game.state.pendingAuction.turnPlayerId === me.id ? (
            <AuctionPrompt game={game} me={me} busy={busy} act={act} />
          ) : (
            <p className="text-center text-sm text-muted">
              Waiting for {game.state.players.find((p) => p.id === game.state.pendingAuction?.turnPlayerId)?.name} to
              bid or pass…
            </p>
          )}
        </>
      )}

      {me.bankrupt || game.turnPhase === "awaiting_auction" ? null : !isMyTurn ? (
        game.turnPhase !== "awaiting_payment" && <p className="text-center text-sm text-muted">Waiting for your turn…</p>
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

          {game.turnPhase === "awaiting_payment" && game.state.pendingDebt && (
            <DebtPanel game={game} me={me} busy={busy} act={act} />
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


// The debt panel: never auto-liquidates anything. Choice 1 ("raise it
// myself") is just closing this and using the normal mortgage/sell-house
// buttons in PlayerPanel — those already work mid-debt (see
// handleSellHouse's phase gate). Choice 2 previews computeDebtReliefPlan's
// minimum-pain liquidation before doing anything. Choice 3 is always
// available here regardless of allowManualBankruptcy — being unable to
// cover a debt is exactly the "truly unable" case the spec carves out.
function DebtPanel({
  game,
  me,
  busy,
  act,
}: {
  game: PublicGame;
  me: PlayerState;
  busy: boolean;
  act: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}) {
  const [showPlan, setShowPlan] = useState(false);
  const debt = game.state.pendingDebt;
  if (!debt) return null;

  const spaces = MAPS[game.state.settings.mapId].spaces;
  const creditorName =
    debt.creditorId === "bank" ? "the bank" : (game.state.players.find((p) => p.id === debt.creditorId)?.name ?? "the bank");
  const shortfall = Math.max(0, debt.amount - me.cashCents);
  const plan = shortfall > 0 ? computeDebtReliefPlan(game.state, me.id) : null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface px-4 py-4">
      <div className="flex flex-col gap-1 text-sm text-ink">
        <p>
          You owe <span className="font-semibold">{formatCAD(debt.amount)}</span> to{" "}
          <span className="font-semibold">{creditorName}</span>.
        </p>
        <p className="text-xs text-muted">
          Cash on hand: {formatCAD(me.cashCents)}
          {shortfall > 0 && <> · short by {formatCAD(shortfall)}</>}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || me.cashCents < debt.amount}
          onClick={() => act({ type: "PAY_RENT" })}
          className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
        >
          Pay {formatCAD(debt.amount)}
        </button>
        {shortfall > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setShowPlan(true)}
            className="flex-1 rounded-full bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
          >
            Help me raise it
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => act({ type: "DECLARE_BANKRUPT" })}
          className="rounded-full bg-danger/20 px-4 py-2.5 text-sm font-semibold text-danger disabled:opacity-40"
        >
          Declare bankrupt
        </button>
      </div>

      {showPlan && plan && plan.sufficient && (
        <Modal onClose={() => setShowPlan(false)} className="max-w-sm gap-3">
          <h3 className="text-base font-bold text-ink">Raise {formatCAD(shortfall)} automatically?</h3>
          <p className="text-sm text-ink">
            This will{" "}
            {plan.operations
              .map((op) =>
                op.type === "mortgage" ? `mortgage ${spaces[op.spaceIndex].name}` : `sell a house on ${spaces[op.spaceIndex].name}`,
              )
              .join(", ")}
            .
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const result = await act({ type: "RAISE_DEBT_HELP" });
                if (result?.ok) setShowPlan(false);
              }}
              className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setShowPlan(false)}
              className="flex-1 rounded-full bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* (Section H finding, scenario 20) computeDebtReliefPlan's insufficient
          case used to just hide "Help me raise it" entirely — a player with
          nothing to liquidate (or not enough) got no feedback at all about
          why. This tells them plainly instead of staying silent. */}
      {showPlan && plan && !plan.sufficient && (
        <Modal onClose={() => setShowPlan(false)} className="max-w-sm gap-3">
          <h3 className="text-base font-bold text-ink">This won&apos;t cover it</h3>
          <p className="text-sm text-ink">
            {plan.operations.length === 0
              ? "You don't have anything left to mortgage or sell."
              : `Mortgaging and selling everything you have would only raise you to ${formatCAD(plan.projectedCashCents)} — still short by ${formatCAD(Math.max(0, debt.amount - plan.projectedCashCents))}.`}
          </p>
          <button
            type="button"
            onClick={() => setShowPlan(false)}
            className="rounded-full bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink"
          >
            Close
          </button>
        </Modal>
      )}
    </div>
  );
}

function AuctionPrompt({
  game,
  me,
  busy,
  act,
}: {
  game: PublicGame;
  me: PlayerState;
  busy: boolean;
  act: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}) {
  const auction = game.state.pendingAuction;
  const [bidInput, setBidInput] = useState("");
  if (!auction) return null;

  const space = MAPS[game.state.settings.mapId].spaces[auction.spaceIndex];
  const minBid = auction.highestBid + 100;

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface px-4 py-4">
      <p className="text-sm text-ink">
        Auctioning <span className="font-semibold">{space.name}</span>.{" "}
        {auction.highestBidderId ? (
          <>
            Current bid {formatCAD(auction.highestBid)} by{" "}
            {game.state.players.find((p) => p.id === auction.highestBidderId)?.name}.
          </>
        ) : (
          "No bids yet."
        )}
      </p>
      <div className="flex gap-2">
        <input
          type="number"
          min={minBid / 100}
          step={1}
          value={bidInput}
          onChange={(e) => setBidInput(e.target.value)}
          placeholder={formatCAD(minBid)}
          className="w-28 rounded-full bg-surface-2 px-4 py-2 text-sm text-ink"
        />
        <button
          type="button"
          disabled={busy || !bidInput || Math.round(Number(bidInput) * 100) < minBid || Math.round(Number(bidInput) * 100) > me.cashCents}
          onClick={async () => {
            const amount = Math.round(Number(bidInput) * 100);
            const result = await act({ type: "PLACE_BID", amount });
            if (result?.ok) setBidInput("");
          }}
          className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
        >
          Bid
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act({ type: "PASS_AUCTION" })}
          className="rounded-full bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
        >
          Pass
        </button>
      </div>
    </div>
  );
}

// Always visible whenever the room allows it, regardless of turn — a
// player can walk away at any time. Two-step confirm ("type QUIT") since
// this is irreversible and not gated behind any board state.
function ManualBankruptcyButton({
  busy,
  act,
}: {
  busy: boolean;
  act: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="self-end text-xs font-medium text-danger/70 hover:text-danger"
      >
        Quit &amp; declare bankruptcy
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-danger/10 px-4 py-3">
      <p className="text-xs text-danger">
        This ends your game permanently and can&apos;t be undone. Type <span className="font-semibold">QUIT</span> to
        confirm.
      </p>
      <div className="flex gap-2">
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="QUIT"
          className="flex-1 rounded-full bg-surface px-4 py-2 text-sm text-ink"
        />
        <button
          type="button"
          disabled={busy || confirmText.trim().toUpperCase() !== "QUIT"}
          onClick={async () => {
            const result = await act({ type: "DECLARE_BANKRUPT" });
            if (result?.ok) {
              setConfirming(false);
              setConfirmText("");
            }
          }}
          className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setConfirmText("");
          }}
          className="rounded-full bg-surface-2 px-4 py-2 text-sm font-semibold text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
