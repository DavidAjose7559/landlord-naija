"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { RollDistributionChart } from "@/components/RollDistributionChart";
import { TokenIcon } from "@/components/TokenIcon";
import { useGame } from "@/hooks/useGame";
import { supabase } from "@/lib/supabase/client";
import { verifyGameBrowser, type BrowserRollRecord, type BrowserVerifyResult } from "@/lib/verify-client";

interface RollRow {
  rollIndex: number;
  playerId: string;
  d1: number;
  d2: number;
  prevHash: string;
  hash: string;
}

interface ServerVerification {
  ok: boolean;
  diceOk: boolean;
  chainOk: boolean;
}

export default function VerifyPage() {
  const { code } = useParams<{ code: string }>();
  const roomCode = code.toUpperCase();
  const { game, loading: gameLoading } = useGame(roomCode);

  const [rolls, setRolls] = useState<RollRow[]>([]);
  const [rollsLoading, setRollsLoading] = useState(true);
  const [serverSeed, setServerSeed] = useState<string | null>(null);
  const [serverVerification, setServerVerification] = useState<ServerVerification | null>(null);
  const [clientResult, setClientResult] = useState<BrowserVerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  // The roll ledger is readable by anon at any time (rolls has a blanket
  // anon SELECT policy), so it shows live while the game is still in
  // progress. The seed itself only comes back from /verify, which the API
  // refuses to reveal until the game has actually finished.
  useEffect(() => {
    if (!game) return;
    const currentGame = game;
    let cancelled = false;

    async function load() {
      setRollsLoading(true);
      if (currentGame.status === "finished") {
        const res = await fetch(`/api/games/${roomCode}/verify`, { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          const body = await res.json();
          setServerSeed(body.serverSeed ?? null);
          setServerVerification(body.verification ?? null);
          setRolls(body.rolls ?? []);
        }
      } else {
        const { data, error } = await supabase
          .from("rolls")
          .select("roll_index, player_id, die_1, die_2, prev_hash, hash")
          .eq("game_id", currentGame.id)
          .order("roll_index", { ascending: true });
        if (cancelled) return;
        if (!error && data) {
          setRolls(
            data.map((r) => ({
              rollIndex: r.roll_index as number,
              playerId: r.player_id as string,
              d1: r.die_1 as number,
              d2: r.die_2 as number,
              prevHash: r.prev_hash as string,
              hash: r.hash as string,
            })),
          );
        }
      }
      if (!cancelled) setRollsLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
    // Deliberately narrower than [game]: this should only re-run when
    // status/id/rollIndex actually change, not on every realtime-driven
    // refetch that leaves those three the same but gives `game` a new
    // object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.status, game?.id, game?.rollIndex, roomCode]);

  async function handleVerify() {
    if (!game || !serverSeed) return;
    setVerifying(true);
    try {
      const records: BrowserRollRecord[] = rolls.map((r) => ({
        rollIndex: r.rollIndex,
        playerId: r.playerId,
        d1: r.d1,
        d2: r.d2,
        prevHash: r.prevHash,
        hash: r.hash,
      }));
      const result = await verifyGameBrowser(serverSeed, game.id, records);
      setClientResult(result);
    } finally {
      setVerifying(false);
    }
  }

  if (gameLoading || !game) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-10 bg-canvas px-6 py-16">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium tracking-widest text-muted uppercase">Room {roomCode}</span>
        <h1 className="text-2xl font-bold text-ink">Fairness</h1>
      </div>

      <p className="text-sm leading-relaxed text-muted">
        Every dice roll in this game is generated from a secret seed committed to before the first roll. When the
        game ends, the seed is revealed and you can verify every single roll yourself.
      </p>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium tracking-widest text-muted uppercase">Seed hash (published at game start)</span>
        <code className="break-all rounded-lg bg-surface px-4 py-3 text-xs text-muted">{game.serverSeedHash}</code>
      </div>

      {game.status !== "finished" ? (
        <p className="text-sm text-muted">
          Game still in progress — {rolls.length} roll{rolls.length === 1 ? "" : "s"} so far. The seed unlocks once
          the game ends.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium tracking-widest text-muted uppercase">Revealed seed</span>
            <code className="break-all rounded-lg bg-surface px-4 py-3 text-xs text-ink">{serverSeed}</code>
          </div>

          <button
            type="button"
            onClick={handleVerify}
            disabled={verifying || !serverSeed}
            className="self-start rounded-full bg-accent px-8 py-3 text-base font-semibold text-accent-foreground transition-colors hover:brightness-110 disabled:opacity-50"
          >
            {verifying ? "Verifying…" : "Verify"}
          </button>

          {clientResult && (
            <div
              className={`rounded-2xl px-6 py-5 text-center text-lg font-bold ${
                clientResult.ok ? "bg-accent text-accent-foreground" : "bg-danger text-white"
              }`}
            >
              {clientResult.ok
                ? "Every roll checks out. This game was fair."
                : `Verification failed — ${clientResult.diceMismatches.length + clientResult.chainMismatches.length} roll(s) don't match.`}
            </div>
          )}

          {serverVerification && !clientResult && (
            <p className="text-xs text-muted">
              Server-side check: {serverVerification.ok ? "passed" : "failed"} — click Verify above to recompute it
              yourself, right here in your browser.
            </p>
          )}
        </div>
      )}

      {!rollsLoading && rolls.length > 0 && <RollDistributionChart rolls={rolls} players={game.state.players} />}

      {!rollsLoading && rolls.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-widest text-muted uppercase">Roll ledger</span>
          <div className="flex flex-col divide-y divide-white/5 rounded-2xl bg-surface">
            {rolls.map((r) => {
              const player = game.state.players.find((p) => p.id === r.playerId);
              return (
                <div key={r.rollIndex} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-10 text-muted tabular-nums">#{r.rollIndex}</span>
                  {player ? <TokenIcon token={player.token} className="text-lg" /> : <span className="text-lg">?</span>}
                  <span className="flex-1 text-ink">{player?.name ?? "unknown player"}</span>
                  <span className="tabular-nums text-ink">
                    {r.d1} + {r.d2}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 text-center text-muted">
      {children}
    </div>
  );
}
