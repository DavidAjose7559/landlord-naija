"use client";

import { useRef, useState } from "react";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";

const DIE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const TUMBLE_MS = 700;
const TUMBLE_FRAME_MS = 80;

interface DiceRollerProps {
  game: PublicGame;
  isMyTurn: boolean;
  dispatch: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
  muted: boolean;
}

function randomFace(): number {
  // Purely cosmetic flicker while the real roll is in flight — never
  // consulted for the actual result, which always comes from the server.
  return 1 + Math.floor(Math.random() * 6);
}

export function DiceRoller({ game, isMyTurn, dispatch, muted }: DiceRollerProps) {
  const [rolling, setRolling] = useState(false);
  const [tumble, setTumble] = useState<[number, number]>([1, 1]);
  const audioRef = useRef<AudioContext | null>(null);

  const canRoll = isMyTurn && game.turnPhase === "awaiting_roll" && !rolling;
  const lastRoll = game.state.lastRoll;

  function playTumbleTick() {
    if (muted) return;
    try {
      const ctx = audioRef.current ?? new AudioContext();
      audioRef.current = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 220 + Math.random() * 120;
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch {
      // Web Audio can be unavailable/blocked — the animation still works fine without it.
    }
  }

  async function handleRoll() {
    if (!canRoll) return;
    setRolling(true);

    const interval = setInterval(() => {
      setTumble([randomFace(), randomFace()]);
      playTumbleTick();
    }, TUMBLE_FRAME_MS);

    const minDelay = new Promise((resolve) => setTimeout(resolve, TUMBLE_MS));
    await Promise.all([dispatch({ type: "ROLL" }), minDelay]);

    clearInterval(interval);
    setRolling(false);
  }

  const shownD1 = rolling ? tumble[0] : (lastRoll?.d1 ?? null);
  const shownD2 = rolling ? tumble[1] : (lastRoll?.d2 ?? null);

  return (
    <div className="flex w-full max-w-full flex-col items-center gap-4">
      <div className="flex gap-3" aria-hidden="true">
        <Die face={shownD1} spinning={rolling} />
        <Die face={shownD2} spinning={rolling} />
      </div>
      {/* (Section 4e) min-w-0 lets this shrink below its text's natural
          width instead of overflowing the board's centre on a narrow
          mobile board — the "Waiting for Sonofdavid…" label is the long
          case this has to survive. */}
      <button
        type="button"
        onClick={handleRoll}
        disabled={!canRoll}
        className="min-w-0 max-w-full rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 sm:px-10 sm:py-3.5 sm:text-base"
        aria-live="polite"
      >
        {rolling ? "Rolling…" : isMyTurn && game.turnPhase === "awaiting_roll" ? "Roll" : waitingLabel(game, isMyTurn)}
      </button>
    </div>
  );
}

function waitingLabel(game: PublicGame, isMyTurn: boolean): string {
  if (!isMyTurn) {
    const current = game.state.players[game.state.currentPlayerIndex];
    return current ? `Waiting for ${current.name}…` : "Waiting…";
  }
  return "Not your roll yet";
}

function Die({ face, spinning }: { face: number | null; spinning: boolean }) {
  return (
    <div
      className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-surface text-4xl leading-none text-ink ${
        spinning ? "animate-[spin_0.7s_ease-in-out]" : ""
      }`}
    >
      {face ? DIE_FACES[face - 1] : "–"}
    </div>
  );
}
