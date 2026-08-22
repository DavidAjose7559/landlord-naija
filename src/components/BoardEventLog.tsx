"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Space } from "@/game/board";
import type { PlayerState } from "@/game/types";
import { buildLines, type EventRow } from "@/lib/event-log-format";
import { supabase } from "@/lib/supabase/client";
import { PLAYER_TOKEN_COLOR } from "@/lib/tokens";

interface BoardEventLogProps {
  gameId: string;
  players: readonly PlayerState[];
  spaces: readonly Space[];
  jailLabel: string;
  deckLabels: { treasure: string; surprise: string };
  className?: string;
}

// (Fix B) The event log moved out of the sidebar into the board's own
// centre, directly below the turn actions. Newest entry ends up nearest
// those actions for free: this renders oldest-to-newest top-to-bottom and
// auto-scrolls to the bottom on every new line, same as the sidebar
// version did — the only things that changed are presentational: a top
// fade (mask-image) so the list reads as scrolling up out of view rather
// than hard-clipping, and progressive dimming so older lines recede
// instead of competing with the newest one for attention.
// (Task 5) buildLines emits plain narrated sentences — "Dave rolled 7 and
// landed on Ikoyi" — with no structural marker for where a player's name
// sits in the text. Rather than rework that formatter (and its extensive
// test suite) to emit name/text segments, split the rendered string on a
// regex built from the live player names and recolour just those matches.
// Longest names first so "Dave" doesn't shadow-match inside "Davepreneur".
function nameColorRegex(players: readonly PlayerState[]): RegExp | null {
  const names = [...new Set(players.map((p) => p.name).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (names.length === 0) return null;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(${escaped.join("|")})`, "g");
}

function ColoredLine({ text, players, nameColor }: { text: string; players: readonly PlayerState[]; nameColor: Map<string, string> }) {
  const regex = useMemo(() => nameColorRegex(players), [players]);
  if (!regex) return <>{text}</>;
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) => {
        const color = nameColor.get(part);
        return color ? (
          <span key={i} style={{ color }} className="font-semibold">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

export function BoardEventLog({ gameId, players, spaces, jailLabel, deckLabels, className }: BoardEventLogProps) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nameColor = useMemo(() => new Map(players.map((p) => [p.name, PLAYER_TOKEN_COLOR[p.token]])), [players]);

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
      .channel(`events:${gameId}:center`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events", filter: `game_id=eq.${gameId}` },
        (payload) => {
          // Same reasoning as the old sidebar EventLog: Realtime doesn't
          // guarantee delivery order across a batch, so sort/dedupe by seq
          // rather than trust arrival order.
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

  const lines = buildLines(events, players, spaces, jailLabel, deckLabels);

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      className={`flex min-h-0 w-full flex-col gap-0.5 overflow-y-auto px-3 py-2 text-center ${className ?? ""}`}
      style={{
        maskImage: "linear-gradient(to bottom, transparent, black 24px)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent, black 24px)",
      }}
    >
      {lines.length === 0 && <p className="text-center text-[11px] text-board-ink/50">Nothing has happened yet.</p>}
      {lines.map((line, i) => {
        // (Task 5) Newest line (last in array, rendered at the bottom) is
        // full ink at opacity 1 — the log used to cap out at 80% ink even
        // at its brightest, reading as low-contrast grey no matter what.
        // Older lines (further from the bottom) recede fast, since this is
        // a glance-able recap of "what just happened," not a transcript
        // meant to be read in full.
        const fromEnd = lines.length - 1 - i;
        const opacity = Math.max(0.2, 1 - fromEnd * 0.16);
        return (
          <p
            key={line.seq}
            style={{ opacity }}
            className={`text-[11px] leading-snug text-board-ink ${line.indent ? "pl-3 text-board-ink/75" : ""}`}
          >
            <ColoredLine text={line.text} players={players} nameColor={nameColor} />
          </p>
        );
      })}
    </div>
  );
}
