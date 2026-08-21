"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";
import { clearSession, loadSession, saveSession, type PlayerSession } from "@/lib/session";
import { supabase } from "@/lib/supabase/client";

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

export interface UseGameResult {
  game: PublicGame | null;
  loading: boolean;
  error: string | null;
  pending: boolean;
  reconnecting: boolean;
  session: PlayerSession | null;
  setSession: (session: PlayerSession | null) => void;
  dispatch: (action: ClientAction) => Promise<ActionResult | null>;
  refetch: () => Promise<void>;
  // Dev-only resilience testing (scenario 26): tears down the realtime
  // channel and blocks every fetch this hook makes for `ms`, then forces a
  // resync. undefined in production so callers can just check truthiness
  // to decide whether to render a "simulate disconnect" control at all.
  simulateDisconnect: ((ms?: number) => void) | undefined;
}

async function fetchPublicGame(roomCode: string): Promise<{ data: PublicGame | null; errorMessage: string | null }> {
  try {
    const res = await fetch(`/api/games/${roomCode}`, { cache: "no-store" });
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      const message =
        body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : null;
      return { data: null, errorMessage: message ?? `request failed (${res.status})` };
    }
    const data = (await res.json()) as PublicGame;
    return { data, errorMessage: null };
  } catch {
    return { data: null, errorMessage: "network error" };
  }
}

// Server state is the only truth — this hook never predicts a mutation's
// result. A dispatch shows `pending` while in flight and applies whatever
// the server actually returned; every other client sees the same change
// arrive via realtime, which is treated purely as an "invalidate and
// refetch" signal rather than something to hand-merge into state.
export function useGame(roomCode: string): UseGameResult {
  const [game, setGame] = useState<PublicGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [session, setSessionState] = useState<PlayerSession | null>(null);

  const sessionRef = useRef<PlayerSession | null>(null);
  // Dev-only disconnect simulation (scenario 26). offlineUntilRef gates
  // every fetch this hook makes; channelRef lets simulateDisconnect tear
  // down the live realtime subscription from outside the effect that owns
  // it. Both are inert (0 / null forever) in production.
  const offlineUntilRef = useRef(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const guardedFetch = useCallback((code: string) => {
    if (Date.now() < offlineUntilRef.current) {
      return Promise.resolve<{ data: PublicGame | null; errorMessage: string | null }>({
        data: null,
        errorMessage: "simulated disconnect (dev)",
      });
    }
    return fetchPublicGame(code);
  }, []);

  useEffect(() => {
    const stored = loadSession(roomCode);
    sessionRef.current = stored;
    setSessionState(stored);
  }, [roomCode]);

  const setSession = useCallback(
    (next: PlayerSession | null) => {
      if (next) {
        saveSession(roomCode, next);
      } else {
        clearSession(roomCode);
      }
      sessionRef.current = next;
      setSessionState(next);
    },
    [roomCode],
  );

  const refetch = useCallback(async () => {
    const { data, errorMessage } = await guardedFetch(roomCode);
    if (data) {
      setGame(data);
      setError(null);
    } else if (errorMessage) {
      setError(errorMessage);
    }
  }, [roomCode, guardedFetch]);

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;

    async function refetchNow() {
      const { data, errorMessage } = await guardedFetch(roomCode);
      if (cancelled) return;
      if (data) {
        setGame(data);
        setError(null);
      } else if (errorMessage) {
        setError(errorMessage);
      }
      return data;
    }

    // Realtime events (a games row update, a new events row) can arrive in
    // small bursts from one action — coalesce them into a single refetch.
    function scheduleRefetch() {
      if (refetchTimer) clearTimeout(refetchTimer);
      refetchTimer = setTimeout(() => {
        refetchTimer = null;
        void refetchNow();
      }, 200);
    }

    function subscribe(gameId: string) {
      channel = supabase
        .channel(`game:${roomCode}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "games", filter: `room_code=eq.${roomCode}` },
          scheduleRefetch,
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "events", filter: `game_id=eq.${gameId}` },
          scheduleRefetch,
        )
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            setReconnecting(false);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setReconnecting(true);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
              if (cancelled) return;
              if (channel) supabase.removeChannel(channel);
              void refetchNow();
              subscribe(gameId);
            }, 1500);
          }
        });
      channelRef.current = channel;
    }

    async function bootstrap() {
      setLoading(true);
      setReconnecting(false);
      const data = await refetchNow();
      if (cancelled) return;
      setLoading(false);
      if (data) subscribe(data.id);
    }

    function onVisible() {
      if (document.visibilityState === "visible") void refetchNow();
    }

    void bootstrap();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (refetchTimer) clearTimeout(refetchTimer);
      if (channel) supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomCode, guardedFetch]);

  const dispatch = useCallback(
    async (action: ClientAction): Promise<ActionResult | null> => {
      const currentSession = sessionRef.current;
      if (!currentSession) {
        setError("you haven't joined this game yet");
        return null;
      }
      if (Date.now() < offlineUntilRef.current) {
        setError("simulated disconnect (dev)");
        return null;
      }

      setPending(true);
      try {
        const res = await fetch(`/api/games/${roomCode}/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clientToken: currentSession.clientToken, action }),
        });
        const body: unknown = await res.json().catch(() => null);

        if (!res.ok) {
          const message =
            body && typeof body === "object" && "error" in body
              ? String((body as { error: unknown }).error)
              : `request failed (${res.status})`;
          setError(message);
          return null;
        }

        if (body && typeof body === "object" && "roomCode" in body) {
          setGame(body as PublicGame);
          setError(null);
        }

        const ok = body && typeof body === "object" && "ok" in body ? Boolean((body as { ok: unknown }).ok) : true;
        const reason =
          body && typeof body === "object" && "reason" in body ? String((body as { reason: unknown }).reason) : undefined;
        return { ok, reason };
      } catch {
        setError("network error");
        return null;
      } finally {
        setPending(false);
      }
    },
    [roomCode],
  );

  // Tears down the live realtime channel (a real unsubscribe, not a faked
  // status flag — the existing CHANNEL_ERROR/CLOSED handling above is what
  // actually fires and drives `reconnecting`) and blocks every fetch this
  // hook makes for `ms`. The channel is free to reconnect on its own
  // schedule during the window (proving that path still works); what stays
  // deliberately down for the full `ms` is data access, so recovery is
  // exercised by one clean refetch at the end rather than by chance.
  const simulateDisconnect = useCallback(
    (ms = 10_000) => {
      offlineUntilRef.current = Date.now() + ms;
      setReconnecting(true);
      channelRef.current?.unsubscribe();
      setTimeout(() => {
        offlineUntilRef.current = 0;
        void refetch();
      }, ms);
    },
    [refetch],
  );

  return {
    game,
    loading,
    error,
    pending,
    reconnecting,
    session,
    setSession,
    dispatch,
    refetch,
    simulateDisconnect: process.env.NODE_ENV !== "production" ? simulateDisconnect : undefined,
  };
}
