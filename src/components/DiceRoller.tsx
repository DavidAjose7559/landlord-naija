"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";

// 3x3 pip grid per face, row-major, true = pip present at that cell —
// the actual physical layout of a die face, not a font glyph. Unicode die
// faces (⚀-⚅) render as a single character whose weight/style is entirely
// up to whatever font the browser picks, which is how they ended up
// looking like plain black boxes — real pips are drawn, not typeset.
const PIP_PATTERNS: Record<number, boolean[]> = {
  1: [false, false, false, false, true, false, false, false, false],
  2: [true, false, false, false, false, false, false, false, true],
  3: [true, false, false, false, true, false, false, false, true],
  4: [true, false, true, false, false, false, true, false, true],
  5: [true, false, true, false, true, false, true, false, true],
  6: [true, false, true, true, false, true, true, false, true],
};

// (Task 10a) Six real faces on a CSS 3D cube, not a flat square that spins
// in its own plane. Opposite faces sum to 7 (1<->6, 2<->5, 3<->4), the
// standard die convention — HALF is the cube's half-extent, the distance
// each face sits out from the centre along its own axis.
const HALF = 24; // px, half of the 48px die
const FACE_TRANSFORM: Record<number, string> = {
  1: `rotateY(0deg) translateZ(${HALF}px)`,
  6: `rotateY(180deg) translateZ(${HALF}px)`,
  3: `rotateY(90deg) translateZ(${HALF}px)`,
  4: `rotateY(-90deg) translateZ(${HALF}px)`,
  2: `rotateX(90deg) translateZ(${HALF}px)`,
  5: `rotateX(-90deg) translateZ(${HALF}px)`,
};

// (Task 10a) "Settling on the server result via a per-value rotation
// lookup." Each face is fixed at the placement above; to bring face N to
// point at the viewer, rotate the whole cube by the INVERSE of that
// face's own placement rotation — e.g. face 3 sits at rotateY(90deg), so
// rotating the cube by rotateY(-90deg) brings it to front. COSMETIC ONLY:
// this table only decides which way the cube turns to SHOW a value the
// server already returned — it never produces or influences the value
// itself (see handleRoll below: the real ROLL dispatch and this animation
// run concurrently, and the displayed face after rolling is always
// game.state.lastRoll, never anything computed client-side).
const SETTLE_ROTATION: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  6: { x: 0, y: 180 },
  3: { x: 0, y: -90 },
  4: { x: 0, y: 90 },
  2: { x: -90, y: 0 },
  5: { x: 90, y: 0 },
};

const TUMBLE_MIN_MS = 650; // minimum time the cube visibly tumbles for, even on a fast response
const TUMBLE_JUMP_MS = 140; // how often the tumble target jumps to a new random orientation
const SETTLE_DURATION_S = 0.8; // ~800ms spring settle, per spec

interface DiceRollerProps {
  game: PublicGame;
  isMyTurn: boolean;
  dispatch: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
  muted: boolean;
}

export function DiceRoller({ game, isMyTurn, dispatch, muted }: DiceRollerProps) {
  const [rolling, setRolling] = useState(false);
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

    const tickInterval = setInterval(playTumbleTick, TUMBLE_JUMP_MS);
    const minDelay = new Promise((resolve) => setTimeout(resolve, TUMBLE_MIN_MS));
    await Promise.all([dispatch({ type: "ROLL" }), minDelay]);

    clearInterval(tickInterval);
    setRolling(false);
  }

  const shownD1 = rolling ? null : (lastRoll?.d1 ?? null);
  const shownD2 = rolling ? null : (lastRoll?.d2 ?? null);

  return (
    <div className="flex w-full max-w-full flex-col items-center gap-2.5">
      <div className="flex gap-3" aria-hidden="true">
        <Die3D face={shownD1} rolling={rolling} />
        <Die3D face={shownD2} rolling={rolling} />
      </div>
      {canRoll ? (
        <button
          type="button"
          onClick={handleRoll}
          className="min-w-0 max-w-full rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition-colors hover:brightness-110 sm:px-10 sm:py-3.5 sm:text-base"
          aria-live="polite"
        >
          {rolling ? "Rolling…" : "Roll"}
        </button>
      ) : (
        // (Fix B/5) A quiet status line, not a button — only the player
        // who can actually act right now gets a solid, prominent CTA.
        // Watching someone else's turn (or your own dice mid-roll) is a
        // status, not something to click, so it shouldn't look clickable.
        <p className="min-w-0 max-w-full truncate text-xs text-board-ink/50" aria-live="polite">
          {rolling ? "Rolling…" : waitingLabel(game, isMyTurn)}
        </p>
      )}
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

function Die3D({ face, rolling }: { face: number | null; rolling: boolean }) {
  const prefersReducedMotion = useReducedMotion();
  const [rotation, setRotation] = useState({ x: 0, y: 0 });

  // Tumble phase: while waiting for the real result, jump to a fresh
  // random orientation every TUMBLE_JUMP_MS. Purely visual noise — the
  // eventual landing face is decided entirely by `face` (the server
  // value) in the effect below, never by anything set here.
  useEffect(() => {
    if (!rolling || prefersReducedMotion) return;
    const interval = setInterval(() => {
      setRotation((r) => ({
        x: r.x + 180 + Math.random() * 360,
        y: r.y + 180 + Math.random() * 360,
      }));
    }, TUMBLE_JUMP_MS);
    return () => clearInterval(interval);
  }, [rolling, prefersReducedMotion]);

  // Settle phase: once the real face is known, land on the equivalent
  // angle (base rotation + however many whole turns keep it moving the
  // same direction it was already tumbling in) rather than snapping
  // backward to the raw 0-180deg base value.
  useEffect(() => {
    if (rolling || face === null) return;
    const base = SETTLE_ROTATION[face];
    if (prefersReducedMotion) {
      setRotation(base);
      return;
    }
    setRotation((r) => ({
      x: base.x + Math.round((r.x - base.x) / 360) * 360,
      y: base.y + Math.round((r.y - base.y) / 360) * 360,
    }));
  }, [rolling, face, prefersReducedMotion]);

  return (
    <div className="h-12 w-12" style={{ perspective: 300 }}>
      <motion.div
        className="relative h-full w-full"
        style={{ transformStyle: "preserve-3d" }}
        animate={{ rotateX: rotation.x, rotateY: rotation.y }}
        transition={
          rolling && !prefersReducedMotion
            ? { duration: TUMBLE_JUMP_MS / 1000, ease: "easeOut" }
            : { type: "spring", duration: SETTLE_DURATION_S, bounce: 0.25 }
        }
      >
        {Object.entries(FACE_TRANSFORM).map(([value, transform]) => (
          <DieFace key={value} value={Number(value)} transform={transform} />
        ))}
      </motion.div>
    </div>
  );
}

function DieFace({ value, transform }: { value: number; transform: string }) {
  const pips = PIP_PATTERNS[value];
  return (
    <div
      className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-0.5 rounded-lg border border-black/10 bg-white p-1.5 shadow-[0_2px_6px_rgba(0,0,0,0.25)]"
      style={{ transform, backfaceVisibility: "hidden" }}
    >
      {pips.map((on, i) => (
        <span key={i} className="flex items-center justify-center">
          {on && <span className="h-[26%] w-[26%] rounded-full bg-zinc-800" />}
        </span>
      ))}
    </div>
  );
}
