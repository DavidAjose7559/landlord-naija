"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { netWorthBreakdown } from "@/game/engine";
import { MAPS } from "@/game/maps";
import { computeGameStats, type GameStats, type StatEvent } from "@/lib/game-stats";
import { formatCAD } from "@/lib/money";
import type { PublicGame } from "@/lib/api/public-game";
import { supabase } from "@/lib/supabase/client";
import { PLAYER_TOKEN_COLOR } from "@/lib/tokens";
import { verifyGameBrowser, type BrowserRollRecord, type BrowserVerifyResult } from "@/lib/verify-client";
import { Confetti } from "./Confetti";
import { TokenIcon } from "./TokenIcon";

interface WinnerScreenProps {
  game: PublicGame;
  roomCode: string;
}

export function WinnerScreen({ game, roomCode }: WinnerScreenProps) {
  const router = useRouter();
  const [stats, setStats] = useState<GameStats | null>(null);
  const [serverSeed, setServerSeed] = useState<string | null>(null);
  const [rollCount, setRollCount] = useState(0);
  const [verifyResult, setVerifyResult] = useState<BrowserVerifyResult | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rematching, setRematching] = useState(false);
  const [copied, setCopied] = useState(false);

  const winner = game.state.players.find((p) => p.id === game.state.winnerPlayerId);
  const map = MAPS[game.state.settings.mapId];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [eventsRes, verifyRes] = await Promise.all([
        supabase.from("events").select("type, payload").eq("game_id", game.id).order("seq", { ascending: true }),
        fetch(`/api/games/${roomCode}/verify`, { cache: "no-store" }),
      ]);
      if (cancelled) return;

      if (eventsRes.data) {
        setStats(computeGameStats(eventsRes.data as StatEvent[], rollCount));
      }

      if (verifyRes.ok) {
        const body = await verifyRes.json();
        setServerSeed(body.serverSeed ?? null);
        const rolls: BrowserRollRecord[] = (body.rolls ?? []).map(
          (r: { rollIndex: number; playerId: string; d1: number; d2: number; prevHash: string; hash: string }) => r,
        );
        setRollCount(rolls.length);
        if (body.serverSeed) {
          const result = await verifyGameBrowser(body.serverSeed, game.id, rolls);
          if (!cancelled) setVerifyResult(result);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // rollCount is set from inside this effect, not a real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, roomCode]);

  const standings = [...game.state.players]
    .map((p) => ({ player: p, breakdown: netWorthBreakdown(game.state, p.id) }))
    .sort((a, b) => b.breakdown.totalCents - a.breakdown.totalCents);

  async function handleRematch() {
    setRematching(true);
    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: game.state.settings }),
      });
      if (!res.ok) return;
      const body = await res.json();
      router.push(`/game/${body.roomCode}/lobby`);
    } finally {
      setRematching(false);
    }
  }

  function handleCopyResult() {
    const lines = [
      `${winner?.name ?? "A player"} wins Landlord Naija! (Room ${roomCode})`,
      "",
      "Final standings:",
      ...standings.map((s, i) => `${i + 1}. ${s.player.name} — ${formatCAD(s.breakdown.totalCents)}`),
      "",
      `Verify the dice: ${typeof window !== "undefined" ? window.location.origin : ""}/game/${roomCode}/verify`,
    ];
    void navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!winner) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center gap-8 overflow-y-auto bg-canvas px-6 py-12">
      <Confetti color={PLAYER_TOKEN_COLOR[winner.token]} />

      <motion.div
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 16 }}
        className="flex flex-col items-center gap-3 text-center"
      >
        <TokenIcon token={winner.token} className="text-7xl" />
        <h1 className="text-3xl font-bold text-ink">{winner.name} owns the board.</h1>
        <p className="text-sm text-muted">{map.name}</p>
      </motion.div>

      <div className="flex w-full max-w-lg flex-col gap-2">
        <span className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">Final standings</span>
        {standings.map((s, i) => {
          const expanded = expandedId === s.player.id;
          return (
            <div
              key={s.player.id}
              className={`rounded-2xl border bg-surface-2 ${i === 0 ? "border-accent/50" : "border-white/8"}`}
            >
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : s.player.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="w-5 text-sm font-semibold text-muted">{i + 1}</span>
                <TokenIcon token={s.player.token} className="text-xl" />
                <span className="flex-1 text-sm font-medium text-ink">{s.player.name}</span>
                <span className="text-sm font-semibold text-ink tabular-nums">{formatCAD(s.breakdown.totalCents)}</span>
              </button>
              {expanded && (
                <div className="flex flex-col gap-1 border-t border-white/5 px-4 py-3 text-xs text-muted">
                  <Row label="Cash" value={formatCAD(s.breakdown.cashCents)} />
                  <Row label="Property value" value={formatCAD(s.breakdown.propertyValueCents)} />
                  <Row label="House/hotel value" value={formatCAD(s.breakdown.houseValueCents)} />
                  <Row label="Mortgage debt" value={`-${formatCAD(s.breakdown.mortgageDebtCents)}`} negative />
                  <div className="mt-1 border-t border-white/5 pt-1">
                    <Row label="TOTAL" value={formatCAD(s.breakdown.totalCents)} bold />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {stats && (
        <div className="grid w-full max-w-lg grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Turns" value={String(stats.totalTurns)} />
          <Stat label="Rolls" value={String(stats.totalRolls)} />
          <Stat label="Trades completed" value={String(stats.totalTradesCompleted)} />
          <Stat
            label="Biggest rent"
            value={stats.biggestRent ? formatCAD(stats.biggestRent.amount) : "—"}
            sub={
              stats.biggestRent
                ? `${playerName(game, stats.biggestRent.payerId)} → ${playerName(game, stats.biggestRent.payeeId)}`
                : undefined
            }
          />
          <Stat
            label="Most landed on"
            value={stats.mostLandedSpaceIndex !== null ? map.spaces[stats.mostLandedSpaceIndex].name : "—"}
          />
          <Stat
            label="Longest jail stay"
            value={stats.longestJailStay ? `${stats.longestJailStay.rollsSpentJailed + 1} turn(s)` : "—"}
            sub={stats.longestJailStay ? playerName(game, stats.longestJailStay.playerId) : undefined}
          />
          <Stat label="Money through the bank" value={formatCAD(stats.totalMoneyThroughBank)} />
        </div>
      )}

      <div className="flex w-full max-w-lg flex-col gap-2 rounded-2xl bg-surface px-5 py-4">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">Fairness</span>
        <div className="flex flex-col gap-1 text-xs text-muted sm:flex-row sm:gap-4">
          <code className="flex-1 truncate rounded-lg bg-surface-2 px-3 py-2">{game.serverSeedHash}</code>
          {serverSeed && <code className="flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 text-ink">{serverSeed}</code>}
        </div>
        {verifyResult && (
          <p className={`text-sm font-medium ${verifyResult.ok ? "text-accent" : "text-danger"}`}>
            {verifyResult.ok ? `✓ All ${rollCount} rolls verified.` : "Verification found a mismatch."}
          </p>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => router.push(`/game/${roomCode}/verify`)}
          className="rounded-full bg-surface-2 px-6 py-3 text-sm font-semibold text-ink hover:bg-white/10"
        >
          Verify the dice
        </button>
        <button
          type="button"
          disabled={rematching}
          onClick={handleRematch}
          className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground hover:brightness-110 disabled:opacity-50"
        >
          {rematching ? "Creating…" : "Rematch"}
        </button>
        <button
          type="button"
          onClick={handleCopyResult}
          className="rounded-full bg-surface-2 px-6 py-3 text-sm font-semibold text-ink hover:bg-white/10"
        >
          {copied ? "Copied!" : "Copy result"}
        </button>
      </div>
    </div>
  );
}

function playerName(game: PublicGame, playerId: string): string {
  return game.state.players.find((p) => p.id === playerId)?.name ?? "someone";
}

function Row({ label, value, bold, negative }: { label: string; value: string; bold?: boolean; negative?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold text-ink" : ""} ${negative ? "text-danger" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl bg-surface px-4 py-3">
      <span className="text-[10px] font-semibold tracking-wide text-muted uppercase">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
      {sub && <span className="text-[11px] text-muted">{sub}</span>}
    </div>
  );
}
