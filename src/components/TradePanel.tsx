"use client";

import { useState } from "react";
import { BOARD } from "@/game/board";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";
import type { PlayerSession } from "@/lib/session";
import { PLAYER_TOKEN_EMOJI } from "@/lib/tokens";
import { Money } from "./Money";

interface TradePanelProps {
  game: PublicGame;
  session: PlayerSession;
  dispatch: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}

function tradableSpaceIndexes(game: PublicGame, playerId: string): number[] {
  return Object.entries(game.state.ownership)
    .filter(([, own]) => own.ownerId === playerId && own.houses === 0 && !own.hotel)
    .map(([idx]) => Number(idx))
    .sort((a, b) => a - b);
}

interface OfferDraft {
  cashCents: number;
  spaceIndexes: number[];
  jailFreeCards: number;
}

const EMPTY_OFFER: OfferDraft = { cashCents: 0, spaceIndexes: [], jailFreeCards: 0 };

export function TradePanel({ game, session, dispatch }: TradePanelProps) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [give, setGive] = useState<OfferDraft>(EMPTY_OFFER);
  const [receive, setReceive] = useState<OfferDraft>(EMPTY_OFFER);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = game.state.players.find((p) => p.id === session.playerId);
  const others = game.state.players.filter((p) => p.id !== session.playerId && !p.bankrupt);
  const incoming = game.state.trades.find((t) => t.toPlayerId === session.playerId);

  function resetForm() {
    setTargetId(null);
    setGive(EMPTY_OFFER);
    setReceive(EMPTY_OFFER);
    setError(null);
  }

  async function handlePropose() {
    if (!targetId) return;
    setSubmitting(true);
    setError(null);
    const result = await dispatch({
      type: "PROPOSE_TRADE",
      toPlayerId: targetId,
      give,
      receive,
    });
    setSubmitting(false);
    if (!result?.ok) {
      setError(result?.reason ?? "Couldn't propose that trade.");
      return;
    }
    setOpen(false);
    resetForm();
  }

  async function handleRespond(tradeId: number, accept: boolean) {
    await dispatch({ type: accept ? "ACCEPT_TRADE" : "DECLINE_TRADE", tradeId });
  }

  if (!me || me.bankrupt) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={others.length === 0}
          className="rounded-full bg-surface-2 px-6 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          Propose Trade
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-2xl bg-surface p-6">
            <h2 className="text-lg font-bold text-ink">Propose a trade</h2>

            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted uppercase">
              Trade with
              <select
                value={targetId ?? ""}
                onChange={(e) => setTargetId(e.target.value || null)}
                className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-normal text-ink normal-case"
              >
                <option value="">Choose a player…</option>
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {PLAYER_TOKEN_EMOJI[p.token]} {p.name}
                  </option>
                ))}
              </select>
            </label>

            {targetId && (
              <>
                <OfferEditor
                  label="You give"
                  game={game}
                  ownerId={session.playerId}
                  jailFreeMax={me.jailFreeCards}
                  offer={give}
                  onChange={setGive}
                />
                <OfferEditor
                  label="You receive"
                  game={game}
                  ownerId={targetId}
                  jailFreeMax={game.state.players.find((p) => p.id === targetId)?.jailFreeCards ?? 0}
                  offer={receive}
                  onChange={setReceive}
                />
              </>
            )}

            {error && <p className="text-xs text-danger">{error}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={!targetId || submitting}
                onClick={handlePropose}
                className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
              >
                {submitting ? "Proposing…" : "Propose"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  resetForm();
                }}
                className="rounded-full bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {incoming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl bg-surface p-6">
            <h2 className="text-lg font-bold text-ink">
              {game.state.players.find((p) => p.id === incoming.fromPlayerId)?.name ?? "A player"} proposes a trade
            </h2>
            <OfferSummary label="They give you" offer={incoming.give} />
            <OfferSummary label="They want" offer={incoming.receive} />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleRespond(incoming.id, true)}
                className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => handleRespond(incoming.id, false)}
                className="flex-1 rounded-full bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink"
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function OfferEditor({
  label,
  game,
  ownerId,
  jailFreeMax,
  offer,
  onChange,
}: {
  label: string;
  game: PublicGame;
  ownerId: string;
  jailFreeMax: number;
  offer: OfferDraft;
  onChange: (offer: OfferDraft) => void;
}) {
  const spaces = tradableSpaceIndexes(game, ownerId);

  function toggleSpace(idx: number) {
    const has = offer.spaceIndexes.includes(idx);
    onChange({
      ...offer,
      spaceIndexes: has ? offer.spaceIndexes.filter((i) => i !== idx) : [...offer.spaceIndexes, idx],
    });
  }

  return (
    <fieldset className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
      <legend className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">{label}</legend>

      <label className="flex items-center justify-between gap-2 text-xs text-ink">
        Cash
        <input
          type="number"
          min={0}
          step={100}
          value={offer.cashCents / 100}
          onChange={(e) => onChange({ ...offer, cashCents: Math.max(0, Math.round(Number(e.target.value) * 100)) })}
          className="w-24 rounded-md bg-canvas px-2 py-1 text-right tabular-nums text-ink"
        />
      </label>

      {jailFreeMax > 0 && (
        <label className="flex items-center justify-between gap-2 text-xs text-ink">
          Jail-free cards
          <input
            type="number"
            min={0}
            max={jailFreeMax}
            value={offer.jailFreeCards}
            onChange={(e) =>
              onChange({ ...offer, jailFreeCards: Math.min(jailFreeMax, Math.max(0, Number(e.target.value))) })
            }
            className="w-24 rounded-md bg-canvas px-2 py-1 text-right tabular-nums text-ink"
          />
        </label>
      )}

      {spaces.length > 0 && (
        <div className="flex flex-col gap-1">
          {spaces.map((idx) => (
            <label key={idx} className="flex items-center gap-2 text-xs text-ink">
              <input type="checkbox" checked={offer.spaceIndexes.includes(idx)} onChange={() => toggleSpace(idx)} />
              {BOARD[idx].name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function OfferSummary({ label, offer }: { label: string; offer: OfferDraft }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-surface-2 p-3 text-sm text-ink">
      <span className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
      {offer.cashCents > 0 && <Money cents={offer.cashCents} />}
      {offer.jailFreeCards > 0 && <span>{offer.jailFreeCards} jail-free card(s)</span>}
      {offer.spaceIndexes.map((idx) => (
        <span key={idx}>{BOARD[idx]?.name}</span>
      ))}
      {offer.cashCents === 0 && offer.jailFreeCards === 0 && offer.spaceIndexes.length === 0 && (
        <span className="text-muted">Nothing</span>
      )}
    </div>
  );
}
