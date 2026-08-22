"use client";

import { useEffect, useMemo, useState } from "react";
import type { Space } from "@/game/board";
import { MAPS } from "@/game/maps";
import { COLOR_GROUP_VAR, regionInkClass, TRANSPORT_PLATE_COLOR, UTILITY_PLATE_COLOR } from "@/lib/board-colors";
import type { PublicGame } from "@/lib/api/public-game";
import { formatCAD } from "@/lib/money";
import type { PlayerSession } from "@/lib/session";
import { supabase } from "@/lib/supabase/client";
import { Modal } from "./Modal";
import { TokenIcon } from "./TokenIcon";

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
const CASH_QUICK_STEPS_CENTS = [1_000, 5_000, 10_000]; // +$10 / +$50 / +$100

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

// (Task 12) The dollar total of an offer — cash plus each property's list
// price. Jail-free cards have no list price, so they're counted
// separately (shown in the value bar as their own line, not folded into
// the total) rather than assigned an arbitrary dollar value.
function offerValue(offer: OfferDraft, spaces: readonly Space[]): number {
  let total = offer.cashCents;
  for (const idx of offer.spaceIndexes) {
    const space = spaces[idx];
    if (space && "price" in space) total += space.price;
  }
  return total;
}

// Region colour (or the fixed transport/utility plate colour) for a
// tradable space, plus which ink reads on top of it — the same lookup
// the tile itself, the property popover and the auction header all use.
function chipColor(space: Space): { color: string; ink: string } {
  if (space.type === "property") return { color: COLOR_GROUP_VAR[space.color], ink: regionInkClass(space.color) };
  if (space.type === "transport") return { color: TRANSPORT_PLATE_COLOR, ink: "text-white" };
  return { color: UTILITY_PLATE_COLOR, ink: "text-white" };
}

// (Task 12) "A flag when either side completes a monopoly." Only counts
// regions that become NEWLY complete as a result of this exact trade —
// a region the player already fully owned before doesn't re-flag just
// because it's untouched by this offer.
function newlyCompletedRegions(game: PublicGame, playerId: string, gaining: number[], losing: number[]): string[] {
  const map = MAPS[game.state.settings.mapId];
  const current = new Set(
    Object.entries(game.state.ownership)
      .filter(([, own]) => own.ownerId === playerId)
      .map(([idx]) => Number(idx)),
  );
  const isComplete = (owned: Set<number>) => map.regions.filter((r) => r.spaceIndexes.every((idx) => owned.has(idx)));

  const before = new Set(isComplete(current).map((r) => r.id));
  const after = current;
  for (const idx of losing) after.delete(idx);
  for (const idx of gaining) after.add(idx);
  return isComplete(after)
    .filter((r) => !before.has(r.id))
    .map((r) => r.name);
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

function isEmptyOffer(offer: OfferDraft): boolean {
  return offer.cashCents === 0 && offer.jailFreeCards === 0 && offer.spaceIndexes.length === 0;
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

  // tradingEnabled is frozen at game start (see UPDATE_SETTINGS), so if it's
  // off no trade could ever have been proposed in the first place — nothing
  // in myOpenThreads to preserve either way.
  if (!me || me.bankrupt || !game.state.settings.tradingEnabled) return null;

  const activeThreadKey = openThreadKey && threads.has(openThreadKey) ? openThreadKey : null;
  const proposeTarget = proposeTargetId ? game.state.players.find((p) => p.id === proposeTargetId) : undefined;
  const canPropose = !busy && !isEmptyOffer(give) && !isEmptyOffer(receive);

  return (
    <div className="flex flex-col gap-2">
      {/* (Task 9) A passive notice, not an action — plain surface styling
          instead of accent, which is reserved for the one thing you can
          actually do (and could otherwise be visible on screen at the
          same time as this, inside an open negotiation). */}
      {toast && <div className="rounded-full bg-surface-2 px-4 py-2 text-center text-xs font-medium text-ink">{toast}</div>}

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
                className="flex items-center justify-between rounded-2xl border border-white/8 bg-surface-2 px-4 py-2.5 text-left text-sm text-ink hover:bg-white/10"
              >
                <span className="flex items-center gap-1.5">
                  {counterparty ? (
                    <>
                      <TokenIcon token={counterparty.token} /> {counterparty.name}
                    </>
                  ) : (
                    "Trade"
                  )}{" "}
                  · round {trade.round}
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

      {proposeTargetId !== null && proposeTarget && (
        <Modal onClose={resetProposeForm} className="max-w-[520px]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-ink">Propose a trade</h2>
            <label className="flex items-center gap-2 text-xs text-muted">
              With
              <select
                value={proposeTargetId}
                onChange={(e) => setProposeTargetId(e.target.value)}
                className="rounded-lg bg-surface-2 px-2 py-1 text-xs font-medium text-ink"
              >
                {others.map((p) => (
                  <option key={p.id} value={p.id} disabled={hasOpenThreadWith(p.id)}>
                    {p.name}
                    {hasOpenThreadWith(p.id) ? " (negotiation open)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <TradeColumns
            game={game}
            leftLabel="You give"
            leftOwnerId={session.playerId}
            leftJailFreeMax={me.jailFreeCards}
            leftOffer={give}
            onLeftChange={setGive}
            rightLabel={`You receive from ${proposeTarget.name}`}
            rightOwnerId={proposeTargetId}
            rightJailFreeMax={proposeTarget.jailFreeCards}
            rightOffer={receive}
            onRightChange={setReceive}
          />

          <ValueBar
            game={game}
            spaces={spaces}
            meId={session.playerId}
            counterpartyId={proposeTargetId}
            give={give}
            receive={receive}
          />

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canPropose}
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
        </Modal>
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

// (Task 12) Cash: a slider + stepper capped at the offering player's
// actual balance, the same "quick increment, never an unbounded raw
// number" pattern the auction's quick-bid buttons use. Ghost-styled
// here (not accent) — Propose/Send counter is this screen's one primary
// action, and these buttons shouldn't compete with it for that colour.
function CashControl({ cents, max, onChange }: { cents: number; max: number; onChange: (cents: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs text-ink">
        <span>Cash</span>
        <span className="font-semibold tabular-nums">{formatCAD(cents)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(max, 0)}
        step={100}
        value={Math.min(cents, max)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
      <div className="flex gap-1.5">
        {CASH_QUICK_STEPS_CENTS.map((step) => (
          <button
            key={step}
            type="button"
            disabled={cents >= max}
            onClick={() => onChange(Math.min(max, cents + step))}
            className="flex-1 rounded-full bg-surface-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-30"
          >
            +{formatCAD(step)}
          </button>
        ))}
        <button
          type="button"
          disabled={cents === 0}
          onClick={() => onChange(0)}
          className="rounded-full bg-surface-2 px-2 py-1 text-[11px] font-semibold text-muted disabled:opacity-30"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function PropertyChip({ space, selected, onClick }: { space: Space; selected: boolean; onClick: () => void }) {
  const { color, ink } = chipColor(space);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${selected ? ink : "text-ink/70"}`}
      style={{
        backgroundColor: selected ? color : `${color}40`,
        boxShadow: selected ? `inset 0 0 0 1.5px color-mix(in srgb, black 35%, ${color})` : undefined,
      }}
    >
      {space.name}
    </button>
  );
}

// (Task 12) Replaces the old fieldset — a section label and 16px of
// space instead of a native border/legend that carried no information.
function OfferColumn({
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
  const owner = game.state.players.find((p) => p.id === ownerId);
  const maxCash = owner?.cashCents ?? 0;

  function toggleSpace(idx: number) {
    const has = offer.spaceIndexes.includes(idx);
    onChange({
      ...offer,
      spaceIndexes: has ? offer.spaceIndexes.filter((i) => i !== idx) : [...offer.spaceIndexes, idx],
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <span className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>

      <CashControl cents={offer.cashCents} max={maxCash} onChange={(v) => onChange({ ...offer, cashCents: v })} />

      {jailFreeMax > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs text-ink">
          <span>Jail-free cards</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={offer.jailFreeCards === 0}
              onClick={() => onChange({ ...offer, jailFreeCards: Math.max(0, offer.jailFreeCards - 1) })}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 font-bold disabled:opacity-30"
            >
              −
            </button>
            <span className="w-4 text-center font-semibold tabular-nums">{offer.jailFreeCards}</span>
            <button
              type="button"
              disabled={offer.jailFreeCards >= jailFreeMax}
              onClick={() => onChange({ ...offer, jailFreeCards: Math.min(jailFreeMax, offer.jailFreeCards + 1) })}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 font-bold disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>
      )}

      {tradableIndexes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tradableIndexes.map((idx) => (
            <PropertyChip
              key={idx}
              space={mapSpaces[idx]}
              selected={offer.spaceIndexes.includes(idx)}
              onClick={() => toggleSpace(idx)}
            />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted">No unimproved properties to offer.</p>
      )}
    </div>
  );
}

// (Task 12) Two true columns with a centre swap arrow, capped at 520px
// total (see the Modal's own max-w-[520px] above) — not a wide modal
// holding two narrow fieldsets stacked on top of each other.
function TradeColumns({
  game,
  leftLabel,
  leftOwnerId,
  leftJailFreeMax,
  leftOffer,
  onLeftChange,
  rightLabel,
  rightOwnerId,
  rightJailFreeMax,
  rightOffer,
  onRightChange,
}: {
  game: PublicGame;
  leftLabel: string;
  leftOwnerId: string;
  leftJailFreeMax: number;
  leftOffer: OfferDraft;
  onLeftChange: (o: OfferDraft) => void;
  rightLabel: string;
  rightOwnerId: string;
  rightJailFreeMax: number;
  rightOffer: OfferDraft;
  onRightChange: (o: OfferDraft) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
      <OfferColumn label={leftLabel} game={game} ownerId={leftOwnerId} jailFreeMax={leftJailFreeMax} offer={leftOffer} onChange={onLeftChange} />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-8 h-5 w-5 shrink-0 text-muted" aria-hidden="true">
        <path d="M7 7h13M17 4l3 3-3 3M17 17H4M7 20l-3-3 3-3" />
      </svg>
      <OfferColumn label={rightLabel} game={game} ownerId={rightOwnerId} jailFreeMax={rightJailFreeMax} offer={rightOffer} onChange={onRightChange} />
    </div>
  );
}

// (Task 12) "A value bar across the bottom: total each side, the delta,
// and a flag when either side completes a monopoly. That row is why the
// modal exists — it's the whole point and it's missing." meId always
// reads as "you"/"them" regardless of which side of the negotiation
// give/receive currently represents (the negotiation modal swaps give
// vs. request depending on who's countering whom).
function ValueBar({
  game,
  spaces,
  meId,
  counterpartyId,
  give,
  receive,
}: {
  game: PublicGame;
  spaces: readonly Space[];
  meId: string;
  counterpartyId: string;
  give: OfferDraft;
  receive: OfferDraft;
}) {
  const giveValue = offerValue(give, spaces);
  const receiveValue = offerValue(receive, spaces);
  const delta = receiveValue - giveValue;

  const myMonopolies = newlyCompletedRegions(game, meId, receive.spaceIndexes, give.spaceIndexes);
  const theirMonopolies = newlyCompletedRegions(game, counterpartyId, give.spaceIndexes, receive.spaceIndexes);

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-2 px-4 py-3">
      <div className="flex items-center justify-between text-xs text-ink">
        <span>
          You give <span className="font-semibold tabular-nums">{formatCAD(giveValue)}</span>
        </span>
        <span>
          You get <span className="font-semibold tabular-nums">{formatCAD(receiveValue)}</span>
        </span>
      </div>
      <div className="flex items-center justify-center gap-1.5 text-sm font-bold">
        <span className={delta > 0 ? "text-gain" : delta < 0 ? "text-danger" : "text-muted"}>
          {delta === 0 ? "Even" : `${delta > 0 ? "+" : "−"}${formatCAD(Math.abs(delta))}`}
        </span>
        <span className="text-xs font-normal text-muted">{delta === 0 ? "" : delta > 0 ? "in your favour" : "against you"}</span>
      </div>
      {(myMonopolies.length > 0 || theirMonopolies.length > 0) && (
        <div className="flex flex-col gap-1 border-t border-white/10 pt-2">
          {myMonopolies.map((name) => (
            <span key={`me-${name}`} className="text-center text-[11px] font-semibold text-accent">
              Completes {name} for you
            </span>
          ))}
          {theirMonopolies.map((name) => (
            <span key={`them-${name}`} className="text-center text-[11px] font-semibold text-accent">
              Completes {name} for them
            </span>
          ))}
        </div>
      )}
    </div>
  );
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
  const addedSpaces = previous ? current.spaceIndexes.filter((i) => !previous.spaceIndexes.includes(i)) : current.spaceIndexes;
  const removedSpaces = previous ? previous.spaceIndexes.filter((i) => !current.spaceIndexes.includes(i)) : [];
  const keptSpaces = previous ? current.spaceIndexes.filter((i) => previous.spaceIndexes.includes(i)) : [];
  const cashChanged = previous ? current.cashCents !== previous.cashCents : current.cashCents > 0;
  const jailChanged = previous ? current.jailFreeCards !== previous.jailFreeCards : current.jailFreeCards > 0;

  return (
    <p className="text-xs text-ink">
      <span className="font-semibold">{label}:</span>{" "}
      {current.cashCents > 0 && <span className={cashChanged ? "font-semibold text-accent" : ""}>{formatCAD(current.cashCents)}</span>}
      {cashChanged && previous && previous.cashCents > 0 && (
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
  spaces: readonly Space[];
  session: PlayerSession;
  onClose: () => void;
}) {
  const [counterOffer, setCounterOffer] = useState<OfferDraft | null>(null);
  const [counterRequest, setCounterRequest] = useState<OfferDraft | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = rounds[rounds.length - 1];
  const isRecipient = latest.to_player_id === session.playerId;
  const isProposer = latest.from_player_id === session.playerId;
  const iAmInvolved = isRecipient || isProposer;
  const expired = latest.round >= 10 && latest.status === "open";
  const counterpartyId = latest.from_player_id === session.playerId ? latest.to_player_id : latest.from_player_id;

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

  // (Task 12) "Keep the counter-offer thread; collapse older rounds by
  // default." Only the latest round shows automatically; earlier rounds
  // are one tap away, not a wall of history nobody asked to read.
  const olderRounds = rounds.slice(0, -1);

  return (
    <Modal onClose={onClose} className="max-w-[520px]">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink">Negotiation</h2>
        <button type="button" onClick={onClose} className="text-xs text-muted hover:text-ink">
          Close
        </button>
      </div>

      {olderRounds.length > 0 && (
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="self-start text-xs font-medium text-accent hover:brightness-110"
        >
          {showHistory ? "Hide" : "Show"} {olderRounds.length} earlier round{olderRounds.length > 1 ? "s" : ""}{" "}
          {showHistory ? "▲" : "▾"}
        </button>
      )}

      <div className="flex flex-col gap-3">
        {(showHistory ? rounds : [latest]).map((round) => {
          const i = rounds.indexOf(round);
          const fromPlayer = game.state.players.find((p) => p.id === round.from_player_id);
          const previous = i > 0 ? rounds[i - 1] : null;
          return (
            <div key={round.id} className="flex flex-col gap-1 rounded-xl border border-white/8 bg-surface-2 p-3">
              <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                Round {round.round} · {fromPlayer?.name ?? "Someone"} proposed
              </span>
              <DiffLine label="They give" current={round.offer} previous={previous ? previous.request : null} spaces={spaces} />
              <DiffLine label="They want" current={round.request} previous={previous ? previous.offer : null} spaces={spaces} />
              {round.status !== "open" && <span className="text-[11px] font-medium text-muted uppercase">{round.status}</span>}
            </div>
          );
        })}
      </div>

      {latest.status === "open" && (
        <ValueBar game={game} spaces={spaces} meId={session.playerId} counterpartyId={counterpartyId} give={latest.offer} receive={latest.request} />
      )}

      {expired && <p className="text-xs text-danger">This negotiation has gone on long enough.</p>}
      {error && <p className="text-xs text-danger">{error}</p>}

      {counterOffer && counterRequest ? (
        <>
          <TradeColumns
            game={game}
            leftLabel="You give"
            leftOwnerId={session.playerId}
            leftJailFreeMax={999}
            leftOffer={counterOffer}
            onLeftChange={setCounterOffer}
            rightLabel="You want"
            rightOwnerId={counterpartyId}
            rightJailFreeMax={999}
            rightOffer={counterRequest}
            onRightChange={setCounterRequest}
          />
          <ValueBar game={game} spaces={spaces} meId={session.playerId} counterpartyId={counterpartyId} give={counterOffer} receive={counterRequest} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || (isEmptyOffer(counterOffer) && isEmptyOffer(counterRequest))}
              onClick={async () => {
                const ok = await act("negotiate", { offer: counterOffer, request: counterRequest });
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
    </Modal>
  );
}
