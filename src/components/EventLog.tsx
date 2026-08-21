"use client";

import { useEffect, useRef, useState } from "react";
import type { Space } from "@/game/board";
import type { PlayerState } from "@/game/types";
import { buildLines, type EventRow } from "@/lib/event-log-format";
import { supabase } from "@/lib/supabase/client";

interface EventLogProps {
  gameId: string;
  players: readonly PlayerState[];
  spaces: readonly Space[];
  jailLabel: string;
  deckLabels: { treasure: string; surprise: string };
}

export function EventLog({ gameId, players, spaces, jailLabel, deckLabels }: EventLogProps) {
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
          // merge logic in buildLines can silently miss its pair.
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
      className="flex h-48 flex-col gap-1.5 overflow-y-auto rounded-2xl bg-surface p-4"
    >
      {lines.length === 0 && <p className="text-xs text-muted">Nothing has happened yet.</p>}
      {lines.map((line) => (
        <p
          key={line.seq}
          className={`text-xs leading-relaxed text-muted ${line.indent ? "ml-4 border-l border-border pl-2" : ""}`}
        >
          {line.text}
        </p>
      ))}
    </div>
  );
}
