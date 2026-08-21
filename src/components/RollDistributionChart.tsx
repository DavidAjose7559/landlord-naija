"use client";

import { motion } from "framer-motion";

interface RollLike {
  playerId: string;
  d1: number;
  d2: number;
}

interface PlayerLike {
  id: string;
  name: string;
}

interface RollDistributionChartProps {
  rolls: readonly RollLike[];
  players: readonly PlayerLike[];
}

const MAX_BAR_HEIGHT = 96; // px

// Per player, how often each face (1-6) came up across every die they
// rolled (d1 and d2 counted separately). No charting library — this is
// simple enough to hand-build with divs and stay dependency-free.
export function RollDistributionChart({ rolls, players }: RollDistributionChartProps) {
  return (
    <div className="flex flex-col gap-10">
      {players.map((player) => {
        const counts = [0, 0, 0, 0, 0, 0];
        let total = 0;
        for (const roll of rolls) {
          if (roll.playerId !== player.id) continue;
          counts[roll.d1 - 1] += 1;
          counts[roll.d2 - 1] += 1;
          total += 2;
        }
        const max = Math.max(1, ...counts);

        return (
          <div key={player.id} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-ink">{player.name}</span>
              <span className="text-xs text-muted tabular-nums">{total} dice</span>
            </div>
            <div className="flex items-end gap-3" style={{ height: MAX_BAR_HEIGHT }}>
              {counts.map((count, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[11px] text-muted tabular-nums">{count}</span>
                  <div className="flex w-full flex-1 items-end">
                    <motion.div
                      className="w-full rounded-t-sm bg-accent"
                      initial={{ height: 0 }}
                      animate={{ height: Math.round((count / max) * MAX_BAR_HEIGHT) }}
                      transition={{ type: "spring", stiffness: 220, damping: 24 }}
                    />
                  </div>
                  <span className="text-[11px] text-muted tabular-nums">{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
