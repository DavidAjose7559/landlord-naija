"use client";

import { useEffect, useRef, useState } from "react";
import { formatCAD } from "@/lib/money";

const TWEEN_MS = 500;
const FLASH_MS = 700;

// (Task 8) "Money animates on change: count-up plus a brief green/red
// flash." A plain rAF tween rather than framer-motion's MotionValue —
// MotionValue only auto-subscribes through `style`, not through text
// children, so driving rendered text off one would need a manual
// subscription anyway; this is the same amount of code without the
// indirection. Not used for every money value in the app (Money.tsx stays
// the plain, non-animated default) — only the panel's own cash figures
// change on a cadence worth calling out.
export function AnimatedMoney({ cents, className }: { cents: number; className?: string }) {
  const [display, setDisplay] = useState(cents);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevRef = useRef(cents);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = prevRef.current;
    const to = cents;
    prevRef.current = to;
    if (from === to) return;

    setFlash(to > from ? "up" : "down");
    const start = performance.now();

    function tick(now: number) {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    const flashTimer = setTimeout(() => setFlash(null), FLASH_MS);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      clearTimeout(flashTimer);
    };
  }, [cents]);

  return (
    <span
      className={`rounded px-1 tabular-nums transition-colors duration-300 ${
        flash === "up" ? "bg-gain/25 text-gain" : flash === "down" ? "bg-danger/25 text-danger" : ""
      } ${className ?? ""}`}
    >
      {formatCAD(display)}
    </span>
  );
}
