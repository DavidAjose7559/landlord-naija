"use client";

import { useEffect, useRef, useState } from "react";
import type { Space } from "@/game/board";
import type { PlayerState } from "@/game/types";
import { formatCAD } from "@/lib/money";
import { supabase } from "@/lib/supabase/client";

interface EventLogProps {
  gameId: string;
  players: readonly PlayerState[];
  spaces: readonly Space[];
  jailLabel: string;
}

interface EventRow {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

function playerName(players: readonly PlayerState[], id: unknown): string {
  return players.find((p) => p.id === id)?.name ?? "Someone";
}

function spaceNameIn(spaces: readonly Space[], index: unknown): string {
  const i = Number(index);
  return spaces[i]?.name ?? "somewhere";
}

// Turns a raw {type, payload} row into a plain sentence for the feed. A
// ROLLED event immediately followed by that same player's MOVED event
// (the normal case — the roll that caused the move) reads as one
// sentence; everything else renders standalone.
function describeEvent(
  event: EventRow,
  next: EventRow | undefined,
  players: readonly PlayerState[],
  spaces: readonly Space[],
  jailLabel: string,
): string | null {
  const p = event.payload;
  const spaceName = (index: unknown) => spaceNameIn(spaces, index);

  switch (event.type) {
    case "GAME_STARTED":
      return "The game has started.";
    case "ROLLED": {
      const total = Number(p.d1) + Number(p.d2);
      if (next?.type === "MOVED" && next.payload.playerId === p.playerId) {
        return `${playerName(players, p.playerId)} rolled ${total} and landed on ${spaceName(next.payload.to)}.`;
      }
      return `${playerName(players, p.playerId)} rolled ${total}.`;
    }
    case "MOVED":
      return null; // consumed by the preceding ROLLED, or too noisy alone (card teleports still show via their own line)
    case "PASSED_GO":
      return `${playerName(players, p.playerId)} passed GO and collected ${formatCAD(Number(p.amount))}.`;
    case "PROPERTY_PURCHASED":
      return `${playerName(players, p.playerId)} bought ${spaceName(p.spaceIndex)} for ${formatCAD(Number(p.price))}.`;
    case "PROPERTY_DECLINED":
      return `${playerName(players, p.playerId)} declined to buy ${spaceName(p.spaceIndex)}.`;
    case "RENT_PAID":
      return `${playerName(players, p.payerId)} paid ${playerName(players, p.payeeId)} ${formatCAD(Number(p.amount))} rent on ${spaceName(p.spaceIndex)}.`;
    case "TAX_PAID":
      return `${playerName(players, p.playerId)} paid ${formatCAD(Number(p.amount))} in tax.`;
    case "CARD_DRAWN":
      return `${playerName(players, p.playerId)} drew a card: "${String(p.text)}"`;
    case "DEBT_PENDING":
      return `${playerName(players, p.playerId)} owes ${formatCAD(Number(p.amount))} and needs to raise funds.`;
    case "HOUSE_BUILT":
      return p.hotel
        ? `${playerName(players, p.playerId)} built a hotel on ${spaceName(p.spaceIndex)}.`
        : `${playerName(players, p.playerId)} built a house on ${spaceName(p.spaceIndex)}.`;
    case "HOUSE_SOLD":
      return `${playerName(players, p.playerId)} sold a house on ${spaceName(p.spaceIndex)}.`;
    case "MORTGAGED":
      return `${playerName(players, p.playerId)} mortgaged ${spaceName(p.spaceIndex)}.`;
    case "UNMORTGAGED":
      return `${playerName(players, p.playerId)} paid off the mortgage on ${spaceName(p.spaceIndex)}.`;
    case "SENT_TO_JAIL":
      return `${playerName(players, p.playerId)} was sent to ${jailLabel}.`;
    case "JAIL_ESCAPED": {
      const method = p.method === "doubles" ? "rolling doubles" : p.method === "fine" ? "paying the fine" : "a jail-free card";
      return `${playerName(players, p.playerId)} got out of ${jailLabel} by ${method}.`;
    }
    case "PLAYER_BANKRUPT":
      return `${playerName(players, p.playerId)} went bankrupt!`;
    case "GAME_OVER":
      return `${playerName(players, p.winnerPlayerId)} wins the game!`;
    case "TRADE_PROPOSED":
      return "A trade was proposed.";
    case "TRADE_ACCEPTED":
      return "A trade was accepted.";
    case "TRADE_DECLINED":
      return "A trade was declined.";
    default:
      return null;
  }
}

export function EventLog({ gameId, players, spaces, jailLabel }: EventLogProps) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data } = await supabase
        .from("events")
        .select("seq, type, payload")
        .eq("game_id", gameId)
        .order("seq", { ascending: true });
      if (!cancelled && data) setEvents(data as EventRow[]);
    }
    void load();

    const channel = supabase
      .channel(`events:${gameId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events", filter: `game_id=eq.${gameId}` },
        (payload) => {
          // Realtime doesn't guarantee delivery order across the several
          // rows one action can insert (e.g. ROLLED then MOVED) — sort by
          // seq (and dedupe) rather than trusting arrival order, or the
          // ROLLED+MOVED merge below can silently miss its pair.
          const row = payload.new as EventRow;
          setEvents((prev) => {
            if (prev.some((e) => e.seq === row.seq)) return prev;
            return [...prev, row].sort((a, b) => a.seq - b.seq);
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [gameId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  const lines = events
    .map((event, i) => ({ seq: event.seq, text: describeEvent(event, events[i + 1], players, spaces, jailLabel) }))
    .filter((line): line is { seq: number; text: string } => line.text !== null);

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      className="flex h-48 flex-col gap-1.5 overflow-y-auto rounded-2xl bg-surface p-4"
    >
      {lines.length === 0 && <p className="text-xs text-muted">Nothing has happened yet.</p>}
      {lines.map((line) => (
        <p key={line.seq} className="text-xs leading-relaxed text-muted">
          {line.text}
        </p>
      ))}
    </div>
  );
}
