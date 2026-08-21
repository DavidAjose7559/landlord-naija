"use client";

import { useEffect, useMemo, useState } from "react";
import { MAPS } from "@/game/maps";
import type { PublicGame } from "@/lib/api/public-game";
import { formatCAD } from "@/lib/money";
import type { PlayerSession } from "@/lib/session";
import { PLAYER_TOKEN_EMOJI } from "@/lib/tokens";
import { supabase } from "@/lib/supabase/client";

interface TradePanelProps {
  game: PublicGame;
  session: PlayerSession;
}

interface OfferDraft {
  cashCents: number;
  spaceIndexes: number[];
  jailFreeCards: number;
}

const EMPTY_OFFER: OfferDraft = { cashCents: 0, spaceIndexes: [], jailFreeCards: 0 };

// Raw shape of a `trades` row as read directly from Supabase (RLS grants
// anon select) — same pattern EventLog uses for `events`, since none of
// this needs a secret-touching server round trip to read.
interface TradeRow {
  id: string;
  game_id: string;
  status: "open" | "accepted" | "declined" | "cancelled" | "superseded";
  from_player_id: string;
  to_player_id: string;
  offer: OfferDraft;
  request: OfferDraft;
  parent_trade_id: string | null;
  round: number;
  created_at: string;
}

function tradableSpaceIndexes(game: PublicGame, playerId: string): number[] {
  return Object.entries(game.state.ownership)
    .filter(([, own]) => own.ownerId === playerId && own.houses === 0 && !own.hotel)
    .map(([idx]) => Number(idx))
    .sort((a, b) => a - b);
}

// Every trade sharing the same root proposal, oldest round first.
function buildThreads(rows: TradeRow[]): Map<string, TradeRow[]> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  function rootOf(row: TradeRow): string {
    let current = row;
    while (current.parent_trade_id) {
      const parent = byId.get(current.parent_trade_id);
      if (!parent) break;
      current = parent;
    }
    return current.id;
  }
  const threads = new Map<string, TradeRow[]>();
  for (const row of rows) {
    const key = rootOf(row);
    const list = threads.get(key) ?? [];
    list.push(row);
    threads.set(key, list);
  }
  for (const list of threads.values()) list.sort((a, b) => a.round - b.round);
  return threads;
}

export function TradePanel({ game, session }: TradePanelProps) {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [openThreadKey, setOpenThreadKey] = useState<string | null>(null);
  const [proposeTargetId, setProposeTargetId] = useState<string | null>(null);
  const [give, setGive] = useState<OfferDraft>(EMPTY_OFFER);
  const [receive, setReceive] = useState<OfferDraft>(EMPTY_OFFER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase.from("trades").select("*").eq("game_id", game.id);
      if (!cancelled && data) setTrades(data as TradeRow[]);
    }
    void load();

    const channel = supabase
      .channel(`trades:${game.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trades", filter: `game_id=eq.${game.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const row = payload.new as TradeRow;
          setTrades((prev) => {
            const next = prev.filter((t) => t.id !== row.id);
            next.push(row);
            return next;
          });
          const isCounter = row.parent_trade_id !== null;
          const involvesMe = row.from_player_id === session.playerId || row.to_player_id === session.playerId;
          if (isCounter && involvesMe && row.from_player_id !== session.playerId) {
            setToast("A trade offer was countered.");
            setTimeout(() => setToast(null), 4000);
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [game.id, session.playerId]);

  const threads = useMemo(() => buildThreads(trades), [trades]);

  const myOpenThreads = useMemo(() => {
    const rows: TradeRow[] = [];
    for (const list of threads.values()) {
      const latest = list[list.length - 1];
      if (latest.status === "open" && (latest.from_player_id === session.playerId || latest.to_player_id === session.playerId)) {
        rows.push(latest);
      }
    }
    return rows;
  }, [threads, session.playerId]);

  const me = game.state.players.find((p) => p.id === session.playerId);
  const others = game.state.players.filter((p) => p.id !== session.playerId && !p.bankrupt);
  const spaces = MAPS[game.state.settings.mapId].spaces;

  function counterpartyOf(trade: TradeRow): string {
    return trade.from_player_id === session.playerId ? trade.to_player_id : trade.from_player_id;
  }

  function hasOpenThreadWith(playerId: string): boolean {
    return myOpenThreads.some((t) => counterpartyOf(t) === playerId);
  }

  function resetProposeForm() {
    setProposeTargetId(null);
    setGive(EMPTY_OFFER);
    setReceive(EMPTY_OFFER);
    setError(null);
  }

  async function handlePropose() {
    if (!proposeTargetId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/games/${game.roomCode}/trades`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientToken: session.clientToken, toPlayerId: proposeTargetId, offer: give, request: receive }),
    });
    setBusy(false);
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      setError(body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "couldn't propose that trade");
      return;
    }
    resetProposeForm();
  }

  if (!me || me.bankrupt) return null;

  const activeThreadKey = openThreadKey && threads.has(openThreadKey) ? openThreadKey : null;

  return (
    <div className="flex flex-col gap-2">
      {toast && <div className="rounded-full bg-accent/20 px-4 py-2 text-center text-xs font-medium text-accent">{toast}</div>}

      {myOpenThreads.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {myOpenThreads.map((trade) => {
            const counterparty = game.state.players.find((p) => p.id === counterpartyOf(trade));
            const myTurn = trade.to_player_id === session.playerId;
            return (
              <button
                key={trade.id}
                type="button"
                onClick={() => setOpenThreadKey([...threads.entries()].find(([, list]) => list.includes(trade))?.[0] ?? null)}
                className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-2.5 text-left text-sm text-ink hover:bg-white/10"
              >
                <span>
                  {counterparty ? `${PLAYER_TOKEN_EMOJI[counterparty.token]} ${counterparty.name}` : "Trade"} · round {trade.round}
                </span>
                <span className={myTurn ? "font-semibold text-accent" : "text-muted"}>{myTurn ? "Your move" : "Waiting"}</span>
              </button>
            );
          })}
        </div>
      )}

      {!proposeTargetId && (
        <button
          type="button"
          onClick={() => setProposeTargetId(others.find((p) => !hasOpenThreadWith(p.id))?.id ?? null)}
          disabled={others.length === 0 || others.every((p) => hasOpenThreadWith(p.id))}
          className="rounded-full bg-surface-2 px-6 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          Propose Trade
        </button>
      )}

      {proposeTargetId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-2xl bg-surface p-6">
            <h2 className="text-lg font-bold text-ink">Propose a trade</h2>

            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted uppercase">
              Trade with
              <select
                value={proposeTargetId}
                onChange={(e) => setProposeTargetId(e.target.value)}
                className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-normal text-ink normal-case"
              >
                {others.map((p) => (
                  <option key={p.id} value={p.id} disabled={hasOpenThreadWith(p.id)}>
                    {PLAYER_TOKEN_EMOJI[p.token]} {p.name}
                    {hasOpenThreadWith(p.id) ? " (negotiation open)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <OfferEditor label="You give" game={game} ownerId={session.playerId} jailFreeMax={me.jailFreeCards} offer={give} onChange={setGive} />
            <OfferEditor
              label="You receive"
              game={game}
              ownerId={proposeTargetId}
              jailFreeMax={game.state.players.find((p) => p.id === proposeTargetId)?.jailFreeCards ?? 0}
              offer={receive}
              onChange={setReceive}
            />

            {error && <p className="text-xs text-danger">{error}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handlePropose}
                className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
              >
                {busy ? "Proposing…" : "Propose"}
              </button>
              <button
                type="button"
                onClick={resetProposeForm}
                className="rounded-full bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {activeThreadKey && (
        <NegotiationModal
          rounds={threads.get(activeThreadKey)!}
          game={game}
          spaces={spaces}
          session={session}
          onClose={() => setOpenThreadKey(null)}
        />
      )}
    </div>
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
  const tradableIndexes = tradableSpaceIndexes(game, ownerId);
  const mapSpaces = MAPS[game.state.settings.mapId].spaces;

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

      {tradableIndexes.length > 0 && (
        <div className="flex flex-col gap-1">
          {tradableIndexes.map((idx) => (
            <label key={idx} className="flex items-center gap-2 text-xs text-ink">
              <input type="checkbox" checked={offer.spaceIndexes.includes(idx)} onChange={() => toggleSpace(idx)} />
              {mapSpaces[idx].name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function offerText(offer: OfferDraft, spaces: readonly { name: string }[]): string[] {
  const parts: string[] = [];
  if (offer.cashCents > 0) parts.push(formatCAD(offer.cashCents));
  if (offer.jailFreeCards > 0) parts.push(`${offer.jailFreeCards} jail-free card(s)`);
  for (const idx of offer.spaceIndexes) parts.push(spaces[idx]?.name ?? "a property");
  return parts.length > 0 ? parts : ["Nothing"];
}

// Diffs round N's offer/request against round N-1's request/offer (roles
// swap on every counter, so "what B now offers" is naturally compared
// against "what B was previously asked for" — same for the other side).
function DiffLine({
  label,
  current,
  previous,
  spaces,
}: {
  label: string;
  current: OfferDraft;
  previous: OfferDraft | null;
  spaces: readonly { name: string }[];
}) {
  if (!previous) {
    return (
      <p className="text-xs text-ink">
        <span className="font-semibold">{label}:</span> {offerText(current, spaces).join(", ")}
      </p>
    );
  }

  const addedSpaces = current.spaceIndexes.filter((i) => !previous.spaceIndexes.includes(i));
  const removedSpaces = previous.spaceIndexes.filter((i) => !current.spaceIndexes.includes(i));
  const keptSpaces = current.spaceIndexes.filter((i) => previous.spaceIndexes.includes(i));
  const cashChanged = current.cashCents !== previous.cashCents;
  const jailChanged = current.jailFreeCards !== previous.jailFreeCards;

  return (
    <p className="text-xs text-ink">
      <span className="font-semibold">{label}:</span>{" "}
      {current.cashCents > 0 && (
        <span className={cashChanged ? "font-semibold text-accent" : ""}>{formatCAD(current.cashCents)}</span>
      )}
      {cashChanged && previous.cashCents > 0 && (
        <span className="ml-1 text-muted line-through opacity-60">{formatCAD(previous.cashCents)}</span>
      )}
      {current.jailFreeCards > 0 && (
        <span className={jailChanged ? "ml-1 font-semibold text-accent" : "ml-1"}>{current.jailFreeCards} jail-free</span>
      )}
      {keptSpaces.map((i) => (
        <span key={i} className="ml-1">
          {spaces[i]?.name}
        </span>
      ))}
      {addedSpaces.map((i) => (
        <span key={i} className="ml-1 font-semibold text-accent">
          +{spaces[i]?.name}
        </span>
      ))}
      {removedSpaces.map((i) => (
        <span key={i} className="ml-1 text-muted line-through opacity-60">
          {spaces[i]?.name}
        </span>
      ))}
      {current.cashCents === 0 && current.jailFreeCards === 0 && current.spaceIndexes.length === 0 && "Nothing"}
    </p>
  );
}

function NegotiationModal({
  rounds,
  game,
  spaces,
  session,
  onClose,
}: {
  rounds: TradeRow[];
  game: PublicGame;
  spaces: readonly { name: string }[];
  session: PlayerSession;
  onClose: () => void;
}) {
  const [counterOffer, setCounterOffer] = useState<OfferDraft | null>(null);
  const [counterRequest, setCounterRequest] = useState<OfferDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = rounds[rounds.length - 1];
  const isRecipient = latest.to_player_id === session.playerId;
  const isProposer = latest.from_player_id === session.playerId;
  const iAmInvolved = isRecipient || isProposer;
  const expired = latest.round >= 10 && latest.status === "open";

  async function act(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/games/${game.roomCode}/trades/${latest.id}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientToken: session.clientToken, ...body }),
    });
    setBusy(false);
    if (!res.ok) {
      const responseBody: unknown = await res.json().catch(() => null);
      setError(
        responseBody && typeof responseBody === "object" && "error" in responseBody
          ? String((responseBody as { error: unknown }).error)
          : "that didn't work",
      );
      return false;
    }
    return true;
  }

  function startCounter() {
    // Pre-filled with swapped, current terms — "you give" becomes what
    // they'd been asking for, and vice versa.
    setCounterOffer(latest.request);
    setCounterRequest(latest.offer);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-2xl bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Negotiation</h2>
          <button type="button" onClick={onClose} className="text-xs text-muted hover:text-ink">
            Close
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {rounds.map((round, i) => {
            const fromPlayer = game.state.players.find((p) => p.id === round.from_player_id);
            const previous = i > 0 ? rounds[i - 1] : null;
            return (
              <div key={round.id} className="flex flex-col gap-1 rounded-xl bg-surface-2 p-3">
                <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                  Round {round.round} · {fromPlayer?.name ?? "Someone"} proposed
                </span>
                <DiffLine label="They give" current={round.offer} previous={previous ? previous.request : null} spaces={spaces} />
                <DiffLine label="They want" current={round.request} previous={previous ? previous.offer : null} spaces={spaces} />
                {round.status !== "open" && (
                  <span className="text-[11px] font-medium text-muted uppercase">{round.status}</span>
                )}
              </div>
            );
          })}
        </div>

        {expired && <p className="text-xs text-danger">This negotiation has gone on long enough.</p>}
        {error && <p className="text-xs text-danger">{error}</p>}

        {counterOffer && counterRequest ? (
          <>
            <OfferEditor label="You give" game={game} ownerId={session.playerId} jailFreeMax={999} offer={counterOffer} onChange={setCounterOffer} />
            <OfferEditor
              label="You want"
              game={game}
              ownerId={latest.from_player_id === session.playerId ? latest.to_player_id : latest.from_player_id}
              jailFreeMax={999}
              offer={counterRequest}
              onChange={setCounterRequest}
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const ok = await act("counter", { offer: counterOffer, request: counterRequest });
                  if (ok) {
                    setCounterOffer(null);
                    setCounterRequest(null);
                  }
                }}
                className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
              >
                Send counter
              </button>
              <button
                type="button"
                onClick={() => {
                  setCounterOffer(null);
                  setCounterRequest(null);
                }}
                className="rounded-full bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          latest.status === "open" &&
          iAmInvolved && (
            <div className="flex flex-wrap gap-2">
              {isRecipient && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act("accept")}
                  className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
                >
                  Accept
                </button>
              )}
              {!expired && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={startCounter}
                  className="flex-1 rounded-full bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
                >
                  Counter
                </button>
              )}
              {isRecipient && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act("decline")}
                  className="rounded-full bg-danger/20 px-4 py-2.5 text-sm font-semibold text-danger disabled:opacity-40"
                >
                  Decline
                </button>
              )}
              {isProposer && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act("cancel")}
                  className="rounded-full bg-danger/20 px-4 py-2.5 text-sm font-semibold text-danger disabled:opacity-40"
                >
                  Withdraw
                </button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
