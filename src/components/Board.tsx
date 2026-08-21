"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { BOARD, type Space } from "@/game/board";
import type { GameState, PlayerState } from "@/game/types";
import { formatCAD } from "@/lib/money";
import { COLOR_GROUP_HEX } from "@/lib/board-colors";
import { PLAYER_TOKEN_COLOR, PLAYER_TOKEN_EMOJI } from "@/lib/tokens";

interface BoardProps {
  state: GameState;
  className?: string;
}

// ============================================================================
// grid geometry — 11x11, corners at (1,1)/(1,11)/(11,1)/(11,11), 9 spaces
// per edge. Index 0 (GO) is the bottom-right corner; play runs
// bottom-right -> bottom-left -> top-left -> top-right -> back to GO,
// matching a physical Monopoly board's layout.
// ============================================================================

type Edge = "bottom" | "left" | "top" | "right" | "corner";

function edgeForIndex(index: number): Edge {
  if (index === 0 || index === 10 || index === 20 || index === 30) return "corner";
  if (index <= 9) return "bottom";
  if (index <= 19) return "left";
  if (index <= 29) return "top";
  return "right";
}

function gridPosition(index: number): { row: number; col: number } {
  if (index === 0) return { row: 11, col: 11 };
  if (index <= 9) return { row: 11, col: 11 - index };
  if (index === 10) return { row: 11, col: 1 };
  if (index <= 19) return { row: 11 - (index - 10), col: 1 };
  if (index === 20) return { row: 1, col: 1 };
  if (index <= 29) return { row: 1, col: 1 + (index - 20) };
  if (index === 30) return { row: 1, col: 11 };
  return { row: 1 + (index - 30), col: 11 };
}

// Percentage of the board's own box a cell's centre sits at — used to place
// the absolutely-positioned token layer without needing to measure pixels,
// so it stays correct at any responsive scale.
function centerPercent(index: number): { left: number; top: number } {
  const { row, col } = gridPosition(index);
  return { left: ((col - 0.5) / 11) * 100, top: ((row - 0.5) / 11) * 100 };
}

// This is a single-viewer screen board, not a physical table with players
// on every side — so unlike a real board, the top row reads normally too.
// Only the side columns rotate, purely so a longer name fits a narrow
// tall cell by running along the column instead of being squeezed
// horizontally.
const ROTATION: Record<Edge, number> = { bottom: 0, left: 90, top: 0, right: -90, corner: 0 };

// ============================================================================
// step-by-step token movement — a short hop (<=12 spaces, either direction)
// walks one space at a time, ~120ms each, spring-eased. A longer jump (a
// jail send, a big card teleport) snaps instantly rather than walking a
// lap around the board.
// ============================================================================

const STEP_MS = 120;
const MAX_ANIMATED_STEPS = 12;

function useAnimatedIndex(target: number): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);

  useEffect(() => {
    if (displayRef.current === target) return;

    const from = displayRef.current;
    const forward = (target - from + 40) % 40;
    const backward = (from - target + 40) % 40;
    const steps = Math.min(forward, backward);

    if (steps === 0 || steps > MAX_ANIMATED_STEPS) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    const direction = forward <= backward ? 1 : -1;
    let current = from;
    let taken = 0;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      current = (current + direction + 40) % 40;
      taken += 1;
      displayRef.current = current;
      setDisplay(current);
      if (taken < steps) timer = setTimeout(tick, STEP_MS);
    };
    timer = setTimeout(tick, STEP_MS);

    return () => clearTimeout(timer);
  }, [target]);

  return display;
}

function PlayerToken({ player, offsetIndex, offsetCount }: { player: PlayerState; offsetIndex: number; offsetCount: number }) {
  const displayIndex = useAnimatedIndex(player.position);
  const { left, top } = centerPercent(displayIndex);

  // Scatter multiple tokens on the same space in a small ring so they
  // don't stack exactly on top of each other.
  const angle = offsetCount > 1 ? (offsetIndex / offsetCount) * Math.PI * 2 : 0;
  const radius = offsetCount > 1 ? 1.1 : 0;
  const dx = Math.cos(angle) * radius;
  const dy = Math.sin(angle) * radius;

  return (
    <motion.div
      className="absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm shadow-lg"
      style={{ backgroundColor: PLAYER_TOKEN_COLOR[player.token] }}
      animate={{ left: `calc(${left}% + ${dx}%)`, top: `calc(${top}% + ${dy}%)` }}
      transition={{ type: "spring", stiffness: 480, damping: 32 }}
      title={player.name}
      aria-hidden="true"
    >
      <span className="drop-shadow-sm">{PLAYER_TOKEN_EMOJI[player.token]}</span>
    </motion.div>
  );
}

function describeSpace(space: Space, ownership: GameState["ownership"], players: PlayerState[]): string {
  const parts: string[] = [space.name];

  if (space.type === "property" || space.type === "transport" || space.type === "utility") {
    if (space.type === "property") parts.push(`${space.color} property`);
    else parts.push(space.type);
    const own = ownership[space.index];
    if (!own) {
      parts.push(`unowned, price ${formatCAD(space.price)}`);
    } else {
      const owner = players.find((p) => p.id === own.ownerId);
      parts.push(`owned by ${owner?.name ?? "someone"}`);
      if (own.mortgaged) parts.push("mortgaged");
      if (own.hotel) parts.push("hotel built");
      else if (own.houses > 0) parts.push(`${own.houses} house${own.houses > 1 ? "s" : ""}`);
    }
  } else if (space.type === "tax") {
    parts.push(`pay ${formatCAD(space.amount)}`);
  } else if (space.type === "card") {
    parts.push(`${space.deck} card space`);
  } else if (space.type === "jail") {
    parts.push("jail, or just visiting");
  } else if (space.type === "gotojail") {
    parts.push("go directly to jail");
  } else if (space.type === "go") {
    parts.push("collect on passing");
  }

  return parts.join(", ");
}

function SpaceBar({ color }: { color: string }) {
  return <div className="h-3 w-full shrink-0" style={{ backgroundColor: color }} />;
}

function HousePips({ houses, hotel, barColor }: { houses: number; hotel: boolean; barColor: string }) {
  if (hotel) {
    return (
      <div className="flex justify-center py-0.5">
        <div className="h-2.5 w-4 rounded-[2px]" style={{ backgroundColor: barColor }} />
      </div>
    );
  }
  if (houses === 0) return null;
  return (
    <div className="flex justify-center gap-0.5 py-0.5">
      {Array.from({ length: houses }).map((_, i) => (
        <div key={i} className="h-1.5 w-1.5 rounded-[1px] bg-accent" />
      ))}
    </div>
  );
}

function BoardSpace({
  space,
  state,
}: {
  space: Space;
  state: GameState;
}) {
  const { row, col } = gridPosition(space.index);
  const edge = edgeForIndex(space.index);
  const rotation = ROTATION[edge];
  const ownable = space.type === "property" || space.type === "transport" || space.type === "utility";
  const own = ownable ? state.ownership[space.index] : undefined;
  const owner = own ? state.players.find((p) => p.id === own.ownerId) : undefined;
  const barColor = space.type === "property" ? COLOR_GROUP_HEX[space.color] : undefined;

  const label = describeSpace(space, state.ownership, state.players);

  return (
    <div
      role="gridcell"
      tabIndex={0}
      aria-label={label}
      className={`relative flex overflow-hidden bg-surface outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        edge === "corner" ? "items-center justify-center" : ""
      }`}
      style={{ gridRow: row, gridColumn: col }}
    >
      {own?.mortgaged && (
        <div
          className="pointer-events-none absolute inset-0 z-10 bg-canvas/60"
          style={{
            backgroundImage:
              "linear-gradient(to top right, transparent calc(50% - 1px), var(--color-danger) 50%, transparent calc(50% + 1px))",
          }}
        />
      )}

      <div
        className={`flex h-full w-full flex-col ${edge === "corner" ? "items-center justify-center gap-1 p-1 text-center" : "justify-between p-1"}`}
        style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
      >
        {edge === "corner" ? (
          <>
            <span className="text-lg leading-none">{cornerIcon(space)}</span>
            <span className="text-[9px] leading-tight font-semibold text-ink">{space.name}</span>
          </>
        ) : (
          <>
            {barColor && <SpaceBar color={barColor} />}
            <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-center">
              <span className="line-clamp-2 text-[8px] leading-tight font-medium text-ink">{space.name}</span>
              {space.type === "property" || space.type === "transport" || space.type === "utility" ? (
                <span className="text-[8px] tabular-nums text-muted">{formatCAD(space.price)}</span>
              ) : space.type === "tax" ? (
                <span className="text-[8px] tabular-nums text-muted">{formatCAD(space.amount)}</span>
              ) : null}
            </div>
            {own && !own.mortgaged && (space.type === "property" ? <HousePips houses={own.houses} hotel={own.hotel} barColor={barColor!} /> : null)}
          </>
        )}
      </div>

      {owner && (
        <span
          className="absolute top-0.5 right-0.5 z-20 h-2 w-2 rounded-full ring-1 ring-canvas"
          style={{ backgroundColor: PLAYER_TOKEN_COLOR[owner.token] }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

function cornerIcon(space: Space): string {
  switch (space.type) {
    case "go":
      return "➜";
    case "jail":
      return "🚔";
    case "free":
      return "🅿️";
    case "gotojail":
      return "🚨";
    default:
      return "";
  }
}

export function Board({ state, className }: BoardProps) {
  const playersBySpace = new Map<number, PlayerState[]>();
  for (const player of state.players) {
    if (player.bankrupt) continue;
    const list = playersBySpace.get(player.position) ?? [];
    list.push(player);
    playersBySpace.set(player.position, list);
  }

  return (
    <div className={`relative mx-auto aspect-square w-full max-w-[720px] ${className ?? ""}`}>
      <div role="grid" aria-label="Game board" className="grid h-full w-full grid-cols-11 grid-rows-11 gap-px bg-canvas">
        {BOARD.map((space) => (
          <BoardSpace key={space.index} space={space} state={state} />
        ))}
      </div>

      <div className="pointer-events-none absolute inset-0 z-30">
        {state.players
          .filter((p) => !p.bankrupt)
          .map((player) => {
            const sameSpace = playersBySpace.get(player.position) ?? [];
            const offsetIndex = sameSpace.findIndex((p) => p.id === player.id);
            return (
              <PlayerToken key={player.id} player={player} offsetIndex={offsetIndex} offsetCount={sameSpace.length} />
            );
          })}
      </div>
    </div>
  );
}
