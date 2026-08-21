"use client";

import { useEffect, useRef } from "react";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";

// (Section 3 turn watchdog) "The game must never deadlock." Every
// connected client polls for a stuck turn and, on noticing one, dispatches
// FORCE_END_TURN — the server (action/route.ts) is the actual authority on
// whether the wait has really elapsed (settings.turnTimeLimitSeconds, or a
// 3-minute fallback when the host left it off), so a false-positive
// dispatch from here is always harmless: a 409 if it hasn't really timed
// out, or a no-op ("action had no effect") if another client already
// resolved it first.
const POLL_INTERVAL_MS = 5_000;
const WATCHDOG_FALLBACK_MS = 180_000;

export function useTurnWatchdog(
  game: PublicGame | null,
  dispatch: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>,
): void {
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!game || game.status !== "active") return;

    const limitMs =
      game.state.settings.turnTimeLimitSeconds > 0
        ? game.state.settings.turnTimeLimitSeconds * 1000
        : WATCHDOG_FALLBACK_MS;

    const interval = setInterval(() => {
      if (inFlightRef.current) return;
      const startedAt = game.state.turnStartedAt;
      if (!startedAt || Date.now() - startedAt < limitMs) return;
      inFlightRef.current = true;
      void dispatch({ type: "FORCE_END_TURN" }).finally(() => {
        inFlightRef.current = false;
      });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [game, dispatch]);
}
