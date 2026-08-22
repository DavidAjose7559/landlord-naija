"use client";

import { useEffect, useRef, useState } from "react";
import type { Space } from "@/game/board";
import type { PlayerState } from "@/game/types";
import { buildLines, type EventRow } from "@/lib/event-log-format";
import { supabase } from "@/lib/supabase/client";

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
export function BoardEventLog({ gameId, players, spaces, jailLabel, deckLabels, className }: BoardEventLogProps) {
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
        // Aggressive falloff: the newest couple of lines read clearly,
        // everything older recedes fast rather than reading as a uniform
        // grey wall — this is a glance-able recap of "what just happened,"
        // not a transcript meant to be read in full.
        const fromEnd = lines.length - 1 - i;
        const opacity = Math.max(0.2, 1 - fromEnd * 0.16);
        return (
          <p
            key={line.seq}
            style={{ opacity }}
            className={`text-[11px] leading-snug text-board-ink/80 ${line.indent ? "pl-3 text-board-ink/60" : ""}`}
          >
            {line.text}
          </p>
        );
      })}
    </div>
  );
}
