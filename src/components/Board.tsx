"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { GOTOJAIL_INDEX, JAIL_INDEX, type Space } from "@/game/board";
import { MAPS } from "@/game/maps";
import type { GameState, PlayerState } from "@/game/types";
import type { ClientAction } from "@/lib/api/client-action";
import type { PublicGame } from "@/lib/api/public-game";
import type { PlayerSession } from "@/lib/session";
import { formatCAD } from "@/lib/money";
import { COLOR_GROUP_VAR } from "@/lib/board-colors";
import { PLAYER_TOKEN_COLOR } from "@/lib/tokens";
import { setBoardCenterSlot } from "@/lib/board-center-slot";
import { BoardCenterControls } from "./BoardCenterControls";
import { TokenIcon } from "./TokenIcon";

interface BoardProps {
  state: GameState;
  className?: string;
  onInspect?: (spaceIndex: number) => void;
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
// (Fix A) Tracks are NOT uniform: corners are 13.2% of the board, the 9
// inner tracks on each edge are 8.2% — depth-to-width ~1.6, close to a
// real board, versus the dead-flat 1:1 a uniform 11x11 grid gives every
// cell. `TRACKS` mirrors that in `grid-template-columns`/`-rows`;
// `trackCenterPercent` replaces the old flat `/11` division for anything
// that needs a track's centre as a percentage of the board box (token
// placement).
// ============================================================================

const CORNER_TRACK_PCT = 13.2;
const EDGE_TRACK_PCT = 8.2;
const TRACKS = [CORNER_TRACK_PCT, ...Array(9).fill(EDGE_TRACK_PCT), CORNER_TRACK_PCT];
const GRID_TEMPLATE = `${CORNER_TRACK_PCT}% repeat(9, ${EDGE_TRACK_PCT}%) ${CORNER_TRACK_PCT}%`;

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

// This is a single-viewer screen board, not a physical table with players
// on every side — so unlike a real board, the top row reads normally too.
// Only the side columns rotate, purely so a longer name fits a narrow
// tall cell by running along the column instead of being squeezed
// horizontally.
const ROTATION: Record<Edge, number> = { bottom: 0, left: 90, top: 0, right: -90, corner: 0 };

// (Fix A) Left/right cells are landscape boxes (13.2% wide x 8.2% tall —
// depth runs along the width, since that's the outward direction from the
// board's centre). Rotating their content 90deg to read along the ring
// means the CONTENT needs a portrait box (dimensions swapped) before
// rotation, or it overflows the cell's actual (landscape) bounds. Top/
// bottom/corner never rotate, so they never need this — see
// `barGoesFirst` for why only edge orientation, not rotation, varies there.
const ROTATED_CONTENT_WIDTH_PCT = (EDGE_TRACK_PCT / CORNER_TRACK_PCT) * 100;
const ROTATED_CONTENT_HEIGHT_PCT = (CORNER_TRACK_PCT / EDGE_TRACK_PCT) * 100;

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
      className="absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm shadow-lg"
      style={{ backgroundColor: PLAYER_TOKEN_COLOR[player.token] }}
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

function SpaceBar({ color }: { color: string }) {
  // .board-space-bar: heritage adds a black rule beneath the strip (see
  // globals.css) — Board.tsx never checks which theme is active, it just
  // always emits this class and lets the ambient [data-theme] scope decide
  // whether that rule exists.
  return <div className="board-space-bar h-[clamp(4px,1.9cqw,15px)] w-full shrink-0" style={{ backgroundColor: color }} />;
}

function HousePips({ houses, hotel, barColor }: { houses: number; hotel: boolean; barColor: string }) {
  if (hotel) {
    return (
      <div className="flex shrink-0 justify-center py-0.5">
        <div className="h-2.5 w-4 rounded-[2px]" style={{ backgroundColor: barColor }} />
      </div>
    );
  }
  if (houses === 0) return null;
  return (
    <div className="flex shrink-0 justify-center gap-0.5 py-0.5">
      {Array.from({ length: houses }).map((_, i) => (
        <div key={i} className="h-1.5 w-1.5 rounded-[1px] bg-accent" />
      ))}
    </div>
  );
}

// "Saturated colour bars flush at each space's outer edge" (Section G) —
// the outer edge for each screen edge is a different physical side of the
// cell (bottom row -> screen-bottom, left column -> screen-left, etc), so
// which end of the pre-rotation flex column the bar sits at has to vary:
// full-bleed (no padding) at the "top" end for the top row (its outward
// edge is already screen-up, unrotated per the earlier rotation decision)
// and at the "bottom" end for bottom/left/right, whose rotation/geometry
// puts pre-rotation-bottom on their respective outward screen edge.
function barGoesFirst(edge: Edge): boolean {
  return edge === "top";
}

function BoardSpace({
  space,
  state,
  onInspect,
  highlighted,
}: {
  space: Space;
  state: GameState;
  onInspect?: (spaceIndex: number) => void;
  highlighted?: boolean;
}) {
  const { row, col } = gridPosition(space.index);
  const edge = edgeForIndex(space.index);
  const rotation = ROTATION[edge];
  const ownable = space.type === "property" || space.type === "transport" || space.type === "utility";
  const own = ownable ? state.ownership[space.index] : undefined;
  const owner = own ? state.players.find((p) => p.id === own.ownerId) : undefined;
  const barColor = space.type === "property" ? COLOR_GROUP_VAR[space.color] : undefined;

  const label = describeSpace(space, state.ownership, state.players);

  const bar = barColor ? <SpaceBar color={barColor} /> : null;
  const content = (
    // min-w-0/min-h-0 down this whole chain is load-bearing, not
    // decorative: a flex item's default min-width/min-height is `auto`
    // (its content's natural, unwrapped/unclamped size), not 0 — so
    // without it, line-clamp never gets a chance to actually constrain
    // anything: the name sizes itself to its full unwrapped width/height,
    // blows past the cell, and only then gets hard-clipped by the cell's
    // own overflow-hidden. That reads as text missing from both ends
    // horizontally, or the price shoved out below the cell's bottom edge
    // vertically — both symptoms of the same root cause.
    //
    // The name gets the flexible vertical space (absorbing whatever room
    // is left after the bar and price, both shrink-0 below), but that
    // flex-grow has to live on a WRAPPER div around the clamped span, not
    // on the span itself: -webkit-line-clamp (which line-clamp-4 uses)
    // measures unreliably on an element that is ALSO `flex: 1 1 0%` —
    // Chromium/WebKit compute its box against a zero flex-basis before
    // content is measured, so the clamp silently stops limiting anything
    // and the name overflows its own line-clamp box. Giving the WRAPPER
    // the flex-grow (ordinary flex-basis: auto — no conflict) and leaving
    // the span a plain non-flex child inside it sidesteps that entirely.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-0 overflow-hidden p-0 text-center">
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
        {/* line-clamp-6: NOT a design choice about how many lines a name
            "should" take — the wrapper's own flex-1 + overflow-hidden is
            what actually bounds it. This cap only needs to sit above
            whatever the longest real name ever needs, so it never becomes
            the reason a line goes missing (the earlier line-clamp-5 was
            doing exactly that for "Murtala Muhammed Airport": the wrapper
            had a 6th line's worth of room sitting unused, capped off by
            an arbitrary "5"). */}
        <span className="board-space-name line-clamp-6 min-h-0 min-w-0 [overflow-wrap:anywhere] text-[clamp(8px,1.9cqw,18px)] leading-[1] font-semibold tracking-normal text-board-ink uppercase">
          {space.name}
        </span>
      </div>
      {space.type === "property" || space.type === "transport" || space.type === "utility" ? (
        <span className="board-price min-w-0 shrink-0 leading-[1.1] text-[clamp(8px,1.7cqw,15px)] tabular-nums text-board-ink/60">{formatCAD(space.price)}</span>
      ) : space.type === "tax" ? (
        <span className="board-price min-w-0 shrink-0 leading-[1.1] text-[clamp(8px,1.7cqw,15px)] tabular-nums text-board-ink/60">{formatCAD(space.amount)}</span>
      ) : null}
      {own && !own.mortgaged && space.type === "property" && (
        <HousePips houses={own.houses} hotel={own.hotel} barColor={barColor!} />
      )}
    </div>
  );

  function inspect() {
    onInspect?.(space.index);
  }

  return (
    <div
      role="gridcell"
      tabIndex={0}
      aria-label={`${label}. Press Enter for details.`}
      onClick={inspect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inspect();
        }
      }}
      className={`relative flex cursor-pointer overflow-hidden rounded-[3px] bg-board outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        edge === "corner" ? "items-center justify-center" : ""
      } ${highlighted ? "z-20 ring-4 ring-accent animate-pulse" : ""}`}
      style={{ gridRow: row, gridColumn: col }}
    >
      {own?.mortgaged && (
        <div
          className="pointer-events-none absolute inset-0 z-10 bg-board/70"
          style={{
            backgroundImage:
              "linear-gradient(to top right, transparent calc(50% - 1px), var(--color-danger) 50%, transparent calc(50% + 1px))",
          }}
        />
      )}

      <div
        className={`flex min-w-0 min-h-0 flex-col ${rotation ? "" : "h-full w-full"} ${
          edge === "corner" ? "h-full w-full items-center justify-center gap-1 text-center" : ""
        }`}
        style={{
          ...(rotation
            ? {
                position: "absolute",
                left: "50%",
                top: "50%",
                width: `${ROTATED_CONTENT_WIDTH_PCT}%`,
                height: `${ROTATED_CONTENT_HEIGHT_PCT}%`,
                transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
              }
            : undefined),
          ...(edge === "corner" ? { padding: "var(--board-corner-padding)" } : undefined),
        }}
      >
        {edge === "corner" ? (
          <>
            <span className="shrink-0 text-[clamp(18px,3.6cqw,30px)] leading-none">{cornerIcon(space)}</span>
            <span className="board-space-name line-clamp-3 min-h-0 min-w-0 [overflow-wrap:anywhere] text-[clamp(13px,2.7cqw,21px)] leading-tight font-semibold tracking-wide text-board-ink uppercase">
              {space.name}
            </span>
            {/* Always rendered for the jail corner (a space-type branch,
                not a theme branch) — modern's CSS leaves it visually
                unified with the rest of the corner, heritage tints it as
                a distinct strip. See .board-jail-visiting in globals.css. */}
            {space.type === "jail" && (
              <span className="board-jail-visiting w-full rounded-[2px] px-1 py-0.5 text-[6px] leading-none tracking-wide text-board-ink/60 uppercase">
                Just visiting
              </span>
            )}
          </>
        ) : barGoesFirst(edge) ? (
          <>
            {bar}
            {content}
          </>
        ) : (
          <>
            {content}
            {bar}
          </>
        )}
      </div>

      {owner && (
        <span
          className="absolute top-0.5 right-0.5 z-20 h-2 w-2 rounded-full ring-1 ring-board"
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
    <div
      className={`relative mx-auto w-full max-w-[760px] ${DESKTOP_MAX_WIDTH} rounded-[28px] p-3 sm:p-6 ${className ?? ""}`}
      style={{ background: "radial-gradient(circle at 50% 42%, var(--color-canvas) 0%, var(--color-canvas-edge) 100%)" }}
    >
      <div
        className="board-paper-texture relative aspect-square w-full overflow-hidden rounded-[2px] bg-board [container-type:inline-size]"
        style={{ boxShadow: "var(--board-shadow)" }}
      >
        <div
          role="grid"
          aria-label="Game board"
          // (Fix 1) bg-canvas, not bg-board-line: each tile needs to read
          // as its own discrete object sitting on the darker felt table,
          // not a slab with hairline rules — the actual table colour
          // showing through the (now 3px) gaps is what sells that,
          // matched by rounded corners on each tile below.
          className="grid h-full w-full bg-canvas"
          style={{ gap: "var(--board-grid-gap)", gridTemplateColumns: GRID_TEMPLATE, gridTemplateRows: GRID_TEMPLATE }}
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
          {/* The 9x9 interior isn't covered by any space — it hosts the
              primary turn controls now (Section 4d), and would otherwise
              fall through to the grid's own background (bg-canvas, the
              dark felt table colour that shows through the gaps between
              tiles — see Fix 1 above), turning the whole centre into a
              dark void without this explicit bg-board fill. */}
          <div
            ref={setBoardCenterSlot}
            className="relative flex items-center justify-center overflow-hidden bg-board"
            style={{ gridRow: "2 / 11", gridColumn: "2 / 11" }}
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
            {/* Portal target for Section 4c: card reveals, the property
                inspector, and any tooltip/toast that would otherwise cover
                the ring of spaces render here instead (see
                useBoardCenterSlot) — stacked above the default centre
                controls via z-20. */}
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
