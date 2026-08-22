"use client";

import { useEffect, useRef, useState } from "react";
import { AUCTION_DURATION_MS, auctionHighBid } from "@/game/engine";
import { MAPS } from "@/game/maps";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";
import { formatCAD } from "@/lib/money";
import type { PlayerSession } from "@/lib/session";
import { PLAYER_TOKEN_COLOR } from "@/lib/tokens";
import { Modal } from "./Modal";
import { Money } from "./Money";
import { TokenIcon } from "./TokenIcon";

interface AuctionModalProps {
  game: PublicGame;
  session: PlayerSession | null;
  dispatch: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}

const QUICK_BID_STEPS_CENTS = [200, 1_000, 10_000]; // +$2 / +$10 / +$100

const RENT_TIER_LABELS = ["Base", "1 house", "2 houses", "3 houses", "4 houses", "Hotel"];

// (Section 3) Full rebuild: a centred modal visible to every player at
// once (the auction is simultaneous now, not turn-by-turn — see
// engine.ts's PendingAuction) — property name/icon at top, current bid
// large on the left with the leading bidder's token, a countdown bar,
// three quick-bid buttons plus a custom amount, the property's rent
// ladder as a card on the right, and a live bid feed at the bottom.
export function AuctionModal({ game, session, dispatch }: AuctionModalProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [bidInput, setBidInput] = useState("");
  const [msRemaining, setMsRemaining] = useState(0);
  // Only true once a resolve attempt has actually SUCCEEDED — a failed
  // attempt (e.g. a 409 because the server's clock hadn't quite hit the
  // deadline yet when this client's countdown reached 0) must not give up
  // permanently, or the auction can sit dead until someone reloads. See
  // lastAttemptRef below for the retry throttle.
  const resolvedRef = useRef(false);
  const lastAttemptRef = useRef(0);

  const auction = game.state.pendingAuction;
  const deadline = game.state.auctionDeadline;

  useEffect(() => {
    resolvedRef.current = false;
    lastAttemptRef.current = 0;
    setMessage(null);
    setBidInput("");
  }, [auction?.spaceIndex]);

  // One interval drives both the countdown display AND the auto-resolve
  // retry — deliberately NOT two separate effects keyed off msRemaining,
  // because React bails out of re-rendering (and re-running effects keyed
  // to it) when setState is called with a value equal to the current one.
  // Once msRemaining settles at 0 it would stop changing entirely, so an
  // effect keyed to it would only ever fire the single transition into 0
  // — exactly the scenario where a premature/failed resolve attempt must
  // keep retrying is the one case that dependency would silently stop
  // running for.
  useEffect(() => {
    if (!deadline || !auction) return;
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      setMsRemaining(remaining);
      if (remaining > 0 || resolvedRef.current) return;
      if (Date.now() - lastAttemptRef.current < 1000) return;
      lastAttemptRef.current = Date.now();
      void dispatch({ type: "RESOLVE_AUCTION_TIMEOUT" }).then((result) => {
        if (result?.ok) resolvedRef.current = true;
      });
    };
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [deadline, auction, dispatch]);

  if (!auction || game.turnPhase !== "awaiting_auction") return null;

  const map = MAPS[game.state.settings.mapId];
  const space = map.spaces[auction.spaceIndex];
  const me = session ? game.state.players.find((p) => p.id === session.playerId) : undefined;
  const canBid = Boolean(me && !me.bankrupt && auction.eligiblePlayerIds.includes(me.id));

  const high = auctionHighBid(auction);
  const highBidder = high ? game.state.players.find((p) => p.id === high.playerId) : undefined;
  const currentBid = high?.amount ?? 0;
  const progress = deadline ? Math.min(1, Math.max(0, msRemaining / AUCTION_DURATION_MS)) : 0;
  const secondsLeft = Math.ceil(msRemaining / 1000);

  async function placeBid(amount: number) {
    if (!me || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await dispatch({ type: "PLACE_BID", amount });
    if (!result?.ok) setMessage("Someone outbid you.");
    else setBidInput("");
    setBusy(false);
  }

  return (
    <Modal ariaLabel={`Auction for ${space.name}`} className="max-w-2xl">
      <div className="flex flex-col items-center gap-1 text-center">
        <h2 className="text-lg font-bold text-ink">{space.name}</h2>
        {"price" in space && <p className="text-xs text-muted">List price {formatCAD(space.price)}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-4">
            <div className="flex flex-col">
              <span className="text-xs font-medium tracking-widest text-muted uppercase">Current bid</span>
              <span className="text-3xl font-bold tabular-nums text-ink">{formatCAD(currentBid)}</span>
              {highBidder ? (
                <span className="text-xs text-muted">by {highBidder.name}</span>
              ) : (
                <span className="text-xs text-muted">No bids yet</span>
              )}
            </div>
            {highBidder && (
              <div
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-base shadow"
                style={{ backgroundColor: PLAYER_TOKEN_COLOR[highBidder.token] }}
                title={highBidder.name}
              >
                <TokenIcon token={highBidder.token} />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full transition-[width] duration-100 ${secondsLeft <= 2 ? "bg-danger" : "bg-accent"}`}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <span className="text-center text-xs tabular-nums text-muted">
              {deadline ? `${secondsLeft}s left` : "Waiting for the first bid…"}
            </span>
          </div>

          {canBid ? (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-2">
                {QUICK_BID_STEPS_CENTS.map((step) => {
                  const amount = currentBid + step;
                  const disabled = busy || !me || amount > me.cashCents;
                  return (
                    <button
                      key={step}
                      type="button"
                      disabled={disabled}
                      onClick={() => placeBid(amount)}
                      className="rounded-full bg-surface-2 px-2 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
                    >
                      +{formatCAD(step)}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={(currentBid + 1) / 100}
                  step={1}
                  value={bidInput}
                  onChange={(e) => setBidInput(e.target.value)}
                  placeholder={formatCAD(currentBid + 100)}
                  className="w-28 rounded-full bg-surface-2 px-4 py-2 text-sm text-ink"
                />
                <button
                  type="button"
                  disabled={
                    busy ||
                    !me ||
                    !bidInput ||
                    Math.round(Number(bidInput) * 100) <= currentBid ||
                    Math.round(Number(bidInput) * 100) > me.cashCents
                  }
                  onClick={() => placeBid(Math.round(Number(bidInput) * 100))}
                  className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
                >
                  Bid
                </button>
              </div>
              {message && <p className="text-center text-xs text-danger">{message}</p>}
            </div>
          ) : (
            <p className="text-center text-xs text-muted">
              {me?.bankrupt ? "You're out — bankrupt players can't bid." : "You're watching this auction."}
            </p>
          )}
        </div>

        {space.type === "property" ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 px-4 py-4">
            <span className="text-xs font-semibold tracking-widest text-muted uppercase">Rent ladder</span>
            <table className="w-full border-collapse text-sm">
              <tbody>
                {space.rent.map((amount, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-3 text-muted">{RENT_TIER_LABELS[i]}</td>
                    <td className="py-1 text-right tabular-nums text-ink">
                      <Money cents={amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 px-4 py-4 text-sm text-ink">
            <span className="text-xs font-semibold tracking-widest text-muted uppercase">Rent</span>
            <p className="text-xs text-muted">
              {space.type === "transport"
                ? "Scales with how many transport stops the owner holds."
                : "Scales with the dice roll that landed on it."}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-widest text-muted uppercase">Bids</span>
        <div className="flex max-h-28 flex-col-reverse gap-1 overflow-y-auto rounded-xl bg-surface-2 px-3 py-2">
          {auction.bids.length === 0 && <p className="text-xs text-muted">No bids yet.</p>}
          {[...auction.bids].reverse().map((bid, i) => {
            const bidder = game.state.players.find((p) => p.id === bid.playerId);
            const disqualified = !auction.eligiblePlayerIds.includes(bid.playerId);
            return (
              <p key={auction.bids.length - i} className={`text-xs ${disqualified ? "text-muted line-through" : "text-ink"}`}>
                {bidder?.name ?? "Someone"} — {formatCAD(bid.amount)}
              </p>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
