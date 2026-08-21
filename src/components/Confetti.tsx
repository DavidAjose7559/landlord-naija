"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

interface ConfettiProps {
  color: string;
  count?: number;
}

interface Piece {
  id: number;
  left: number; // vw
  delay: number;
  duration: number;
  rotation: number;
  drift: number;
  size: number;
  shade: number; // lightness offset for a bit of colour variety
}

function shadeOf(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amount));
  return `rgb(${r},${g},${b})`;
}

// A lightweight, dependency-free confetti burst — no canvas-confetti or
// similar package pulled in just for this. Pure CSS/Framer Motion pieces
// falling from above the viewport in the winner's token colour.
export function Confetti({ color, count = 60 }: ConfettiProps) {
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 2.2 + Math.random() * 1.6,
        rotation: Math.random() * 720 - 360,
        drift: Math.random() * 40 - 20,
        size: 6 + Math.random() * 6,
        shade: Math.random() * 80 - 40,
      })),
    [count],
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden="true">
      {pieces.map((piece) => (
        <motion.span
          key={piece.id}
          className="absolute top-[-5vh] rounded-sm"
          style={{
            left: `${piece.left}vw`,
            width: piece.size,
            height: piece.size * 0.4,
            backgroundColor: shadeOf(color, piece.shade),
          }}
          initial={{ y: 0, x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: "110vh", x: piece.drift, rotate: piece.rotation, opacity: [1, 1, 0.9, 0] }}
          transition={{ duration: piece.duration, delay: piece.delay, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}
