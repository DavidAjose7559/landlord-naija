"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { GOTOJAIL_INDEX, JAIL_INDEX, type Space } from "@/game/board";
import { computePropertyRent, computeTransportRent, computeUtilityRent } from "@/game/engine";
import { MAPS } from "@/game/maps";
import type { GameState, PlayerState, PropertyOwnership } from "@/game/types";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";
import type { PlayerSession } from "@/lib/session";
import { formatCAD } from "@/lib/money";
import { COLOR_GROUP_VAR, regionInkClass, TRANSPORT_PLATE_COLOR, UTILITY_PLATE_COLOR } from "@/lib/board-colors";
import { PLAYER_COLOR_HEX, PLAYER_COLOR_INK } from "@/lib/player-colors";
import { BoardCenterControls } from "./BoardCenterControls";
import { TokenIcon } from "./TokenIcon";

interface BoardProps {
  state: GameState;
  className?: string;
  onInspect?: (spaceIndex: number, anchor?: DOMRect) => void;
  // (Section 4d) Roll/End Turn/Draw Card render inside the board's own
  // centre now — optional so any test/story rendering Board with just
  // `state` still works, just without the centre controls.
  game?: PublicGame;
  session?: PlayerSession | null;
  dispatch?: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
  muted?: boolean;
}

// ============================================================================
// grid geometry — 11x11, corners at (1,1)/(1,11)/(11,1)/(11,11), 9 spaces
// per edge. Index 0 (GO) is the bottom-right corner; play runs
// bottom-right -> bottom-left -> top-left -> top-right -> back to GO,
// matching a physical Monopoly board's layout.
//
// (Design system v2 §03) Corner is ~1.35x a side tile — grid-template
// uses `fr` units directly (1.35fr / 1fr x9 / 1.35fr) so the browser
// distributes track width natively; CORNER_TRACK_PCT/EDGE_TRACK_PCT below
// are the same ratio expressed as percentages, needed wherever token
// placement and font-size scaling can't use `fr` (absolute positioning,
// cqw-based clamp()).
// ============================================================================

const CORNER_RATIO = 1.35;
const EDGE_RATIO = 1;
const TOTAL_RATIO = CORNER_RATIO * 2 + EDGE_RATIO * 9; // 11.7 — one tile-width unit
const CORNER_TRACK_PCT = (CORNER_RATIO / TOTAL_RATIO) * 100;
const EDGE_TRACK_PCT = (EDGE_RATIO / TOTAL_RATIO) * 100;
const TRACKS = [CORNER_TRACK_PCT, ...Array(9).fill(EDGE_TRACK_PCT), CORNER_TRACK_PCT];
const GRID_TEMPLATE = `${CORNER_RATIO}fr repeat(9, ${EDGE_RATIO}fr) ${CORNER_RATIO}fr`;

// `track` is 1-indexed to match the grid-line numbering `gridPosition`
// already returns (so callers don't have to remember to subtract 1).
function trackCenterPercent(track: number): number {
  let start = 0;
  for (let i = 0; i < track - 1; i++) start += TRACKS[i];
  return start + TRACKS[track - 1] / 2;
}

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
  return { left: trackCenterPercent(col), top: trackCenterPercent(row) };
}

// (Design system v2 §03) Rotate the tile's entire content container as one
// rigid unit — never individual text nodes, which is what let two edges'
// labels overlap before. Top gets rotate(180deg): on a physical table
// every edge's text faces its own side of the board, not the single
// overhead camera this app renders from. 180deg needs no dimension swap
// (a flip, not a quarter-turn); 90/-90 do (see ROTATED_CONTENT_*_PCT).
const ROTATION: Record<Edge, number> = { bottom: 0, left: 90, top: 180, right: -90, corner: 0 };

function needsDimensionSwap(rotation: number): boolean {
  return rotation === 90 || rotation === -90;
}

// Left/right cells are landscape boxes (corner-ratio wide x edge-ratio
// tall — depth runs along the width, the outward direction from the
// board's centre). Rotating their content 90deg to read along the ring
// means the CONTENT needs a portrait box (dimensions swapped) before
// rotation, or it overflows the cell's actual (landscape) bounds.
const ROTATED_CONTENT_WIDTH_PCT = (EDGE_TRACK_PCT / CORNER_TRACK_PCT) * 100;
const ROTATED_CONTENT_HEIGHT_PCT = (CORNER_TRACK_PCT / EDGE_TRACK_PCT) * 100;

// ============================================================================
// tile typography — every size below is `X px at the design review's own
// true-size reference tile (82px wide desktop)`, re-expressed as cqw
// against EDGE_TRACK_PCT (1 edge-tile-width, in percent of the whole
// board) so it scales fluidly with actual board size while landing on
// the exact reference numbers at a full-size board. Floored so it never
// goes unreadable on a small board, ceilinged at the reference value so
// it never overshoots it on a huge one. This is authoring-time-computed
// tiering (three fixed buckets by character count), not runtime
// measurement — see SpaceLines on Space.
// ============================================================================

const REFERENCE_TILE_PX = 82;

// EDGE_TRACK_PCT is a pure ratio (corner:edge = 1.35:1) and doesn't know
// about the grid's own `gap` — 10 gutters (11 columns) at
// var(--board-grid-gap) each, real pixels the fr-based
// grid-template-columns subtracts *before* distributing the rest, that a
// plain percentage/cqw calculation never sees. Rather than a flat fudge
// factor (wrong at every board size except the one it was tuned against),
// subtract the true gutter total in the calc() itself — `(100cqw -
// GAP_TOTAL_PX) * ratio` — so a tile's text is sized against its actual
// rendered width at any board size, not the board's raw width.
const GUTTER_COUNT = 10; // 11 columns -> 10 gutters
const GAP_PX = 3; // matches --board-grid-gap (globals.css)
const GAP_TOTAL_PX = GUTTER_COUNT * GAP_PX;

// A second, smaller margin beyond the gap subtraction above — kerning
// and sub-pixel rounding in the actual rendered glyphs versus this
// coefficient's idealised math consistently want a little more room than
// the arithmetic alone predicts. Tuned against the longest real lines
// across all 5 maps (e.g. "CORPORATION", "NASSARAWA GRA"), not a single
// board size, since it's a multiplicative fraction of the same
// cqw-based fluid term everything else already scales with.
const RENDER_SAFETY = 0.8;

function fluidPx(pxAtReference: number, minPx: number, scale = 1): string {
  const coefficient = (pxAtReference / REFERENCE_TILE_PX) * (EDGE_TRACK_PCT / 100) * scale * RENDER_SAFETY;
  const fluid = `calc((100cqw - ${GAP_TOTAL_PX}px) * ${coefficient})`;
  return `clamp(${minPx * scale}px, ${fluid}, ${pxAtReference * scale}px)`;
}

// ≤7 chars -> 15px · 8-11 chars -> 13px · 12+ chars -> 11.5px. Fixed
// three-tier lookup by the line's own character count — never computed
// from a measured render.
function nameLineFontSize(line: string, scale = 1): string {
  if (line.length <= 7) return fluidPx(15, 8.5, scale);
  if (line.length <= 11) return fluidPx(13, 7, scale);
  return fluidPx(11.5, 6.3, scale);
}

// Same tiering idea as nameLineFontSize, but for the plate's region label.
// The design review's own 6.5px is the ≤11-char case — every one-word or
// short-pair region name (Ikeja, Harbourside, Bishopsgate) renders at
// exactly that. Longer region names exist too (Candlewick District,
// British Columbia, Meridian Heights run 15-19 chars) and the plate never
// gets more than one edge-tile's width regardless of board size, so
// without a second tier those truncate — the plate is authored per-region
// (maps/types.ts), not per-line like NameBlock, so this reaches for a
// smaller fixed size instead of a second authored string.
function plateLabelFontSize(label: string, scale = 1): string {
  if (label.length <= 11) return fluidPx(6.5, 5, scale);
  if (label.length <= 15) return fluidPx(5.5, 4.4, scale);
  return fluidPx(4.8, 4, scale);
}

const PLATE_HEIGHT = fluidPx(15, 10);
const STATE_FONT = fluidPx(8.5, 7);
const CORNER_SCALE = CORNER_RATIO; // corners get proportionally more room than an edge tile

// Elevation (design system v2 §02): 1px light top edge + soft downward
// shadow — the "object, not a flat rectangle" quality. Fixed px, not
// scaled with tile size (shadows this small don't read as bigger/smaller
// meaningfully at these sizes, and a scaled blur radius is more likely to
// look wrong than right).
const TILE_ELEVATION = "inset 0 1px 0 rgba(255,255,255,.08), 0 1px 0 rgba(0,0,0,.45), 0 4px 10px -6px rgba(0,0,0,.7)";

// ============================================================================
// step-by-step token movement — a short hop (<=12 spaces, either direction)
// walks one space at a time, ~120ms each, spring-eased. A longer jump (a
// jail send, a big card teleport) snaps instantly rather than walking a
// lap around the board.
// ============================================================================

const STEP_MS = 120;
const MAX_ANIMATED_STEPS = 12;

// (Section 2a) Being sent to jail must never teleport — the player is
// walked/snapped to the Go To Jail space first, held there for this long
// with the space highlighted, then moved on to jail. This applies uniformly
// whether the send came from landing on Go To Jail, a card, or three
// doubles in a row — the client only ever sees the final position (no
// event-stream access here), so it can't tell those apart, but the visible
// discontinuity is identical either way.
export const JAIL_HOLD_MS = 600;

// `holdAt`, when non-null, pins the displayed position there (walking/
// snapping to it like any other target) and ignores `target` until the
// caller clears it back to null — that's what turns a single state jump
// into "walk to 30, hold, then continue to jail" without this hook needing
// its own timer.
function useAnimatedIndex(target: number, holdAt: number | null): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const wasHoldingRef = useRef(false);

  const walkOrSnapTo = useCallback((next: number) => {
    const from = displayRef.current;
    if (from === next) return () => {};
    const forward = (next - from + 40) % 40;
    const backward = (from - next + 40) % 40;
    const steps = Math.min(forward, backward);

    if (steps > MAX_ANIMATED_STEPS) {
      displayRef.current = next;
      setDisplay(next);
      return () => {};
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
  }, []);

  useEffect(() => {
    if (holdAt !== null) {
      wasHoldingRef.current = true;
      return walkOrSnapTo(holdAt);
    }
    if (wasHoldingRef.current) {
      wasHoldingRef.current = false;
      return walkOrSnapTo(target);
    }
    return walkOrSnapTo(target);
  }, [target, holdAt, walkOrSnapTo]);

  return display;
}

function PlayerToken({
  player,
  offsetIndex,
  offsetCount,
  jailHoldAt,
}: {
  player: PlayerState;
  offsetIndex: number;
  offsetCount: number;
  jailHoldAt: number | null;
}) {
  const displayIndex = useAnimatedIndex(player.position, jailHoldAt);
  const { left, top } = centerPercent(displayIndex);

  // Scatter multiple tokens on the same space in a small ring so they
  // don't stack exactly on top of each other.
  const angle = offsetCount > 1 ? (offsetIndex / offsetCount) * Math.PI * 2 : 0;
  const radius = offsetCount > 1 ? 1.1 : 0;
  const dx = Math.cos(angle) * radius;
  const dy = Math.sin(angle) * radius;

  return (
    <motion.div
      className={`absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm shadow-lg ${PLAYER_COLOR_INK}`}
      style={{ backgroundColor: PLAYER_COLOR_HEX[player.color] }}
      animate={{ left: `calc(${left}% + ${dx}%)`, top: `calc(${top}% + ${dy}%)` }}
      transition={{ type: "spring", stiffness: 480, damping: 32 }}
      title={player.name}
      aria-hidden="true"
    >
      <TokenIcon token={player.token} className="text-sm drop-shadow-sm" />
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

// ============================================================================
// the signboard tile — plate (region colour, full saturation) -> name
// block (pre-authored lines, tiered by length) -> state slot (one of
// unowned/owned/mortgaged). Governing rule: only the plate runs at full
// saturation; everything below it gives way.
// ============================================================================

function PlatePips({ houses, hotel }: { houses: number; hotel: boolean }) {
  if (hotel) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-[55%] w-[45%] rounded-[1px] bg-white/95" />
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center gap-[2px]">
      {Array.from({ length: houses }).map((_, i) => (
        <div key={i} className="h-[35%] w-[12%] rounded-[1px] bg-white/95" />
      ))}
    </div>
  );
}

function Plate({
  color,
  ink,
  label,
  houses,
  hotel,
  dimmed,
}: {
  color: string;
  ink: string;
  label: string;
  houses: number;
  hotel: boolean;
  dimmed: boolean;
}) {
  const showPips = houses > 0 || hotel;
  return (
    <div
      className={`flex w-full shrink-0 items-center justify-center overflow-hidden px-1 ${ink}`}
      style={{ height: PLATE_HEIGHT, backgroundColor: color, opacity: dimmed ? 0.85 : 1 }}
    >
      {showPips ? (
        <PlatePips houses={houses} hotel={hotel} />
      ) : (
        <span
          className="truncate font-semibold tracking-[0.13em] uppercase"
          style={{
            fontSize: plateLabelFontSize(label),
            fontFamily: "var(--font-archivo)",
            // fontStretch alongside fontVariationSettings, not one or the
            // other: for an axis with a standard CSS property (wdth <->
            // font-stretch), browsers can let an unset/normal font-stretch
            // win over a 'wdth' in font-variation-settings, silently
            // rendering at the font's default (uncondensed) width — which
            // is exactly wide enough to blow past a tile's actual text
            // budget. Setting both keeps them from disagreeing.
            fontStretch: "74%",
            fontVariationSettings: "'wdth' 74, 'wght' 700",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

function NameBlock({ lines, scale = 1 }: { lines: readonly string[]; scale?: number }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-0 overflow-hidden px-0.5 py-0.5 text-center">
      {lines.map((line, i) => (
        <span
          key={i}
          className="board-space-name w-full truncate leading-[1.15] font-bold tracking-[0.005em] text-board-ink/88 uppercase"
          style={{
            fontSize: nameLineFontSize(line, scale),
            fontFamily: "var(--font-archivo)",
            // See Plate's comment on fontStretch — same reasoning here.
            fontStretch: "76%",
            fontVariationSettings: "'wdth' 76, 'wght' 750",
          }}
        >
          {line}
        </span>
      ))}
    </div>
  );
}

function StateSlotText({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="w-full shrink-0 truncate border-t border-board-ink/[0.14] text-center tabular-nums text-board-ink/42"
      style={{ fontSize: STATE_FONT, paddingTop: "2px", paddingBottom: "2px" }}
    >
      {children}
    </div>
  );
}

function stateSlotFor(space: Space, state: GameState, own: PropertyOwnership | undefined): React.ReactNode {
  if (space.type === "property" || space.type === "transport" || space.type === "utility") {
    if (!own) return <StateSlotText>{formatCAD(space.price)}</StateSlotText>;
    if (own.mortgaged) return <StateSlotText>Mortgaged</StateSlotText>;
    const rent =
      space.type === "property"
        ? computePropertyRent(state, space, own)
        : space.type === "transport"
          ? computeTransportRent(state, own.ownerId)
          : computeUtilityRent(state, own.ownerId);
    return <StateSlotText>Rent {formatCAD(rent)}</StateSlotText>;
  }
  if (space.type === "tax") return <StateSlotText>{formatCAD(space.amount)}</StateSlotText>;
  return null;
}

function BoardSpace({
  space,
  state,
  onInspect,
  highlighted,
}: {
  space: Space;
  state: GameState;
  onInspect?: (spaceIndex: number, anchor?: DOMRect) => void;
  highlighted?: boolean;
}) {
  const { row, col } = gridPosition(space.index);
  const edge = edgeForIndex(space.index);
  const rotation = ROTATION[edge];
  const swap = needsDimensionSwap(rotation);
  const ownable = space.type === "property" || space.type === "transport" || space.type === "utility";
  const own = ownable ? state.ownership[space.index] : undefined;
  const owner = own ? state.players.find((p) => p.id === own.ownerId) : undefined;
  const ownerColor = owner ? PLAYER_COLOR_HEX[owner.color] : undefined;
  const mortgaged = Boolean(own?.mortgaged);

  const plateColor =
    space.type === "property"
      ? COLOR_GROUP_VAR[space.color]
      : space.type === "transport"
        ? TRANSPORT_PLATE_COLOR
        : space.type === "utility"
          ? UTILITY_PLATE_COLOR
          : undefined;
  const plateInk = space.type === "property" ? regionInkClass(space.color) : "text-white";
  const regionLabel =
    space.type === "property" || space.type === "transport" || space.type === "utility" ? (space.regionLabel ?? "") : "";

  const label = describeSpace(space, state.ownership, state.players);

  // (Task 6) Passes the tile's own bounding rect along so the property
  // popover can anchor itself next to whichever tile was actually
  // clicked, instead of always opening dead centre.
  function inspect(rect: DOMRect) {
    onInspect?.(space.index, rect);
  }

  // Ownership (rank 2 in the hierarchy, after the tokens themselves): a
  // saturated inset ring in the owner's colour plus a faint wash across
  // the whole face — box-shadow rather than a border, so it composes
  // cleanly with the tile's own elevation shadow instead of fighting it.
  const boxShadow = ownerColor ? `inset 0 0 0 2.5px ${ownerColor}, ${TILE_ELEVATION}` : TILE_ELEVATION;

  const content = (
    <div
      className={`flex min-h-0 min-w-0 flex-col ${swap ? "" : "h-full w-full"} ${
        edge === "corner" ? "h-full w-full items-center justify-center gap-1 p-1 text-center" : ""
      }`}
      style={{
        ...(swap
          ? {
              position: "absolute",
              left: "50%",
              top: "50%",
              width: `${ROTATED_CONTENT_WIDTH_PCT}%`,
              height: `${ROTATED_CONTENT_HEIGHT_PCT}%`,
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            }
          : rotation
            ? { transform: `rotate(${rotation}deg)` }
            : undefined),
      }}
    >
      {edge === "corner" ? (
        <>
          <CornerIcon space={space} className="h-[clamp(18px,3.6cqw,30px)] w-[clamp(18px,3.6cqw,30px)] shrink-0" />
          <NameBlock lines={space.lines} scale={CORNER_SCALE} />
          {/* Always rendered for the jail corner (a space-type branch,
              not a theme branch) — modern's CSS leaves it visually
              unified with the rest of the corner, heritage tints it as
              a distinct strip. See .board-jail-visiting in globals.css. */}
          {space.type === "jail" && (
            <span className="board-jail-visiting w-full shrink-0 rounded-[2px] px-1 py-0.5 text-[6px] leading-none tracking-wide text-board-ink/60 uppercase">
              Just visiting
            </span>
          )}
        </>
      ) : (
        <>
          {plateColor && (
            <Plate
              color={plateColor}
              ink={plateInk}
              label={regionLabel}
              houses={own?.hotel ? 0 : (own?.houses ?? 0)}
              hotel={own?.hotel ?? false}
              dimmed={Boolean(own)}
            />
          )}
          <div className={mortgaged ? "line-through decoration-1" : undefined}>
            <NameBlock lines={space.lines} />
          </div>
          {stateSlotFor(space, state, own)}
        </>
      )}
    </div>
  );

  return (
    <div
      role="gridcell"
      tabIndex={0}
      aria-label={`${label}. Press Enter for details.`}
      onClick={(e) => inspect(e.currentTarget.getBoundingClientRect())}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inspect(e.currentTarget.getBoundingClientRect());
        }
      }}
      className={`board-tile-rule relative flex cursor-pointer overflow-hidden rounded-[5px] bg-board outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        edge === "corner" ? "items-center justify-center" : ""
      } ${highlighted ? "z-20 ring-4 ring-accent animate-pulse" : ""} ${mortgaged ? "opacity-[.58]" : ""}`}
      style={{ gridRow: row, gridColumn: col, boxShadow }}
    >
      {ownerColor && (
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{ backgroundColor: ownerColor, opacity: 0.11 }}
          aria-hidden="true"
        />
      )}

      <div className="relative z-[1] flex h-full w-full flex-col">{content}</div>

      {owner && (
        <span
          className="absolute top-0.5 right-0.5 z-20 h-2 w-2 rounded-full ring-1 ring-board"
          style={{ backgroundColor: ownerColor }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

// (Task 3) Drawn, not emoji — flat currentColor vectors matching the
// player tokens' own art style, on the same 24x24 grid.
function CornerIcon({ space, className }: { space: Space; className?: string }) {
  const shape = (() => {
    switch (space.type) {
      case "go":
        return (
          <path
            d="M4 12h13M12 5l7 7-7 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case "jail":
        return (
          <>
            <rect x="4" y="4" width="16" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <rect x="8.1" y="4" width="1.8" height="16" />
            <rect x="14.1" y="4" width="1.8" height="16" />
          </>
        );
      case "free":
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M9.3 17V7h3.7a3 3 0 010 6H9.3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </>
        );
      case "gotojail":
        return (
          <>
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <rect x="11" y="6.5" width="2" height="7" rx="1" />
            <circle cx="12" cy="16.5" r="1.2" />
          </>
        );
      default:
        return null;
    }
  })();
  if (!shape) return null;
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      {shape}
    </svg>
  );
}

// The client only ever sees the post-move GameState (no event-stream
// access here — see JAIL_HOLD_MS above), so "just got sent to jail" is
// detected purely from the position/inJail transition since the last
// render: not in jail before, in jail now, sitting on the jail space.
function useJailHolds(players: readonly PlayerState[]): Set<string> {
  const prevRef = useRef<Map<string, { position: number; inJail: boolean }>>(new Map());
  const [holdingIds, setHoldingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevRef.current;
    const next = new Map<string, { position: number; inJail: boolean }>();
    const newlyJailed: string[] = [];
    for (const p of players) {
      const before = prev.get(p.id);
      if (before && !before.inJail && p.inJail && p.position === JAIL_INDEX) {
        newlyJailed.push(p.id);
      }
      next.set(p.id, { position: p.position, inJail: p.inJail });
    }
    prevRef.current = next;

    if (newlyJailed.length === 0) return;
    setHoldingIds(new Set(newlyJailed));
    const timer = setTimeout(() => setHoldingIds(new Set()), JAIL_HOLD_MS);
    return () => clearTimeout(timer);
  }, [players]);

  return holdingIds;
}

// (Section 4a) Desktop board size: fills available vertical space up to
// the sidebar's own width (24rem/384px, see MobileSheet's md:w-96) plus
// its gap, capped at a sensible max so it doesn't balloon on ultra-wide
// monitors. Below md this is irrelevant — w-full there just fills the
// viewport (Section 4e), so the md: prefix keeps it scoped to desktop.
const DESKTOP_MAX_WIDTH = "md:max-w-[min(calc(100vh-120px),calc(100vw-464px),900px)]";

export function Board({ state, className, onInspect, game, session, dispatch, muted }: BoardProps) {
  const spaces = MAPS[state.settings.mapId].spaces;
  const playersBySpace = new Map<number, PlayerState[]>();
  for (const player of state.players) {
    if (player.bankrupt) continue;
    const list = playersBySpace.get(player.position) ?? [];
    list.push(player);
    playersBySpace.set(player.position, list);
  }

  const jailHoldingIds = useJailHolds(state.players);
  const highlightIndex = jailHoldingIds.size > 0 ? GOTOJAIL_INDEX : null;

  return (
    // (Task 4) data-map-id scopes --felt/--tile/--ink to the board's own
    // DOM subtree — this element and nothing outside it (see globals.css,
    // [data-map-id="…"]). Everything themed by map (this gradient
    // included) has to read --felt, never --color-canvas: that token is
    // now permanently the fixed panel background, not a per-map one.
    <div
      data-map-id={state.settings.mapId}
      // (Task 5) No mx-auto here: this is a flex ITEM in a row whose parent
      // already centres the whole [board, panel] pair with
      // justify-center. Auto margins on a flex item absorb free space
      // before justify-content ever sees it — with mx-auto, the board
      // alone swallowed the entire slack as its own symmetric margins,
      // leaving zero margin after the panel and inflating the board-panel
      // gap to ~5x the intended 40px. mx-auto still centres it correctly
      // on mobile, where this stacks in a column instead of a row.
      className={`relative mx-auto w-full max-w-[760px] md:mx-0 ${DESKTOP_MAX_WIDTH} rounded-[28px] p-3 sm:p-6 ${className ?? ""}`}
      style={{
        background:
          "radial-gradient(circle at 50% 42%, var(--felt) 0%, color-mix(in srgb, var(--felt) 70%, black) 100%)",
      }}
    >
      <div
        className="board-paper-texture relative aspect-square w-full overflow-hidden rounded-[2px] bg-board [container-type:inline-size]"
        style={{ boxShadow: "var(--board-shadow)" }}
      >
        <div
          role="grid"
          aria-label="Game board"
          // Discrete tiles, not a continuous slab: the actual felt/table
          // colour shows through these (3px) gaps, and each tile below
          // is independently rounded — that separation is what reads as
          // "objects on felt" rather than a document with grid lines.
          // backgroundColor here (not bg-canvas): --color-canvas is the
          // fixed panel background now, not this map's felt.
          className="grid h-full w-full"
          style={{
            gap: "var(--board-grid-gap)",
            gridTemplateColumns: GRID_TEMPLATE,
            gridTemplateRows: GRID_TEMPLATE,
            backgroundColor: "var(--felt)",
          }}
        >
          {spaces.map((space) => (
            <BoardSpace
              key={space.index}
              space={space}
              state={state}
              onInspect={onInspect}
              highlighted={highlightIndex === space.index}
            />
          ))}
          {/* (Task 5) The 9x9 interior is a defined inset well, not empty
              parchment or a flat continuation of the tile field: 2% darker
              than the tiles, rounded, sitting slightly below the board's
              surface (inset shadow) the way a real card table has a felt
              well at its centre. Hosts the turn controls (Fix B/Section 4d). */}
          <div
            className="relative flex items-center justify-center overflow-hidden rounded-[12px]"
            style={{
              gridRow: "2 / 11",
              gridColumn: "2 / 11",
              backgroundColor: "color-mix(in srgb, black 2%, var(--tile))",
              boxShadow: "inset 0 2px 6px rgba(0,0,0,.18), inset 0 0 0 1px rgba(0,0,0,.06)",
            }}
          >
            {/* (Fix B) No longer centred/shrink-wrapped — BoardCenterControls
                now fills this whole inset box top-to-bottom itself (turn
                info at top, event log stretching to the bottom edge), so
                this just hands it the full available box. */}
            <div className="absolute inset-0 z-10 flex flex-col">
              {game && dispatch && (
                <BoardCenterControls game={game} session={session ?? null} dispatch={dispatch} muted={muted ?? true} />
              )}
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 z-30">
          {state.players
            .filter((p) => !p.bankrupt)
            .map((player) => {
              const sameSpace = playersBySpace.get(player.position) ?? [];
              const offsetIndex = sameSpace.findIndex((p) => p.id === player.id);
              return (
                <PlayerToken
                  key={player.id}
                  player={player}
                  offsetIndex={offsetIndex}
                  offsetCount={sameSpace.length}
                  jailHoldAt={jailHoldingIds.has(player.id) ? GOTOJAIL_INDEX : null}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}
