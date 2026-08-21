"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export interface ChatMessageRow {
  id: number;
  game_id: string;
  player_id: string | null;
  body: string;
  created_at: string;
}

// Same read pattern as EventLog/TradePanel: anon SELECT policy + a
// realtime subscription, no server round trip to read. Posting is the
// only thing that goes through the server (POST /api/games/[code]/chat) —
// see ChatPanel.
export function useChatMessages(gameId: string | undefined): { messages: ChatMessageRow[]; loading: boolean } {
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;

    async function load() {
      const { data } = await supabase
        .from("messages")
        .select("id, game_id, player_id, body, created_at")
        .eq("game_id", gameId)
        .order("id", { ascending: true });
      if (!cancelled) {
        if (data) setMessages(data as ChatMessageRow[]);
        setLoading(false);
      }
    }
    void load();

    const channel = supabase
      .channel(`messages:${gameId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `game_id=eq.${gameId}` },
        (payload) => {
          const row = payload.new as ChatMessageRow;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [gameId]);

  return { messages, loading };
}
