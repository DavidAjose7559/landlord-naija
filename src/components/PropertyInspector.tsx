"use client";

import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  GO_SALARY,
  TRANSPORT_INDEXES,
  TRANSPORT_RENT,
  UTILITY_INDEXES,
  UTILITY_RENT_MULTIPLIER,
  type PropertySpace,
  type Space,
  type TaxSpace,
  type TransportSpace,
  type UtilitySpace,
} from "@/game/board";
import {
  buildHouseBlockedReason,
  JAIL_FINE,
  MAX_JAIL_TURNS,
  mortgageBlockedReason,
  ownsFullUnmortgagedGroup,
  unmortgageBlockedReason,
} from "@/game/engine";
import { MAPS } from "@/game/maps";
import type { ClientAction } from "@/lib/api/client-action";
import type { GameState, PlayerState, PropertyOwnership } from "@/game/types";
import type { PlayerSession } from "@/lib/session";
import { COLOR_GROUP_VAR, regionInkClass, TRANSPORT_PLATE_COLOR, UTILITY_PLATE_COLOR } from "@/lib/board-colors";
import { PLAYER_COLOR_HEX } from "@/lib/player-colors";
import { Money } from "./Money";
import { RegionBadge } from "./RegionBadge";
import { TokenIcon } from "./TokenIcon";

interface PropertyInspectorProps {
  state: GameState;
  spaceIndex: number;
  // (Task 6) The clicked tile's own viewport rect — undefined when opened
  // from somewhere without a tile to anchor to (the panel's property
  // list), in which case the popover falls back to centred.
  anchor?: DOMRect;
  session?: PlayerSession | null;
  dispatch?: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

const DRAG_TO_CLOSE_THRESHOLD = 90;
const POPOVER_WIDTH = 322;
const POPOVER_MARGIN = 12; // never closer than this to a viewport edge
const TILE_GAP = 14; // gap between the tile and the popover
const ARROW_HALF = 8;

interface PopoverPos {
  left: number;
  top: number;
  arrowSide: "left" | "right" | null;
  arrowTop: number;
  ready: boolean;
}

// (Task 6) "Rebuild as a 322px popover anchored to the tile with an arrow
// pointing at it. Board stays visible." Placed on whichever side of the
// tile has more room (right if the tile is in the viewport's left half,
// left otherwise), vertically centred on the tile and clamped to the
// viewport. Needs the popover's own rendered height before it can settle
// on a final position, so it renders invisibly for one layout pass first.
function usePopoverPosition(anchor: DOMRect | undefined, ref: React.RefObject<HTMLDivElement | null>, resizeTick: number): PopoverPos {
  const [pos, setPos] = useState<PopoverPos>({ left: 0, top: 0, arrowSide: null, arrowTop: 0, ready: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const height = el.offsetHeight;

    if (!anchor) {
      setPos({
        left: Math.max(POPOVER_MARGIN, (vw - POPOVER_WIDTH) / 2),
        top: Math.max(POPOVER_MARGIN, (vh - height) / 2),
        arrowSide: null,
        arrowTop: 0,
        ready: true,
      });
      return;
    }

    const tileCenterY = anchor.top + anchor.height / 2;
    const placeRight = anchor.left + anchor.width / 2 < vw / 2;
    let left = placeRight ? anchor.right + TILE_GAP : anchor.left - TILE_GAP - POPOVER_WIDTH;
    left = Math.min(Math.max(left, POPOVER_MARGIN), Math.max(POPOVER_MARGIN, vw - POPOVER_WIDTH - POPOVER_MARGIN));

    const maxTop = Math.max(POPOVER_MARGIN, vh - height - POPOVER_MARGIN);
    const top = Math.min(Math.max(tileCenterY - height / 2, POPOVER_MARGIN), maxTop);

    const arrowTop = Math.min(Math.max(tileCenterY - top, ARROW_HALF + 14), Math.max(ARROW_HALF + 14, height - ARROW_HALF - 14));

    setPos({ left, top, arrowSide: placeRight ? "left" : "right", arrowTop, ready: true });
    // resizeTick forces a recompute on window resize without needing to
    // watch `ref` (a stable object) as a dependency itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, resizeTick]);

  return pos;
}

// Read-only-by-default, mutating only through the Buy/Build/Mortgage
// footer (Task 6) when session+dispatch are supplied and it's actually
// this player's move. Desktop: an anchored popover next to the clicked
// tile, board fully visible behind it, dismissed on outside click or
// Escape. Below md: a swipe-down bottom sheet, matching MobileSheet's
// own pattern.
export function PropertyInspector({ state, spaceIndex, anchor, session, dispatch, onClose, onNavigate }: PropertyInspectorProps) {
  const [isDesktop, setIsDesktop] = useState(true);
  const [resizeTick, setResizeTick] = useState(0);
  const titleId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(anchor, popoverRef, resizeTick);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    function onResize() {
      setResizeTick((t) => t + 1);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Outside click to dismiss — no dimmed backdrop (the board has to stay
  // visible), so this is the only thing standing in for one. mousedown
  // rather than click so a drag-to-select gesture that ends outside the
  // popover doesn't spuriously close it.
  useEffect(() => {
    if (!isDesktop) return;
    function onMouseDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isDesktop, onClose]);

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > DRAG_TO_CLOSE_THRESHOLD || info.velocity.y > 700) onClose();
  }

  const content = (
    <SpaceCard state={state} spaceIndex={spaceIndex} onNavigate={onNavigate} titleId={titleId} session={session} dispatch={dispatch} />
  );

  if (isDesktop) {
    return createPortal(
      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        className="fixed z-40 flex flex-col gap-3 rounded-2xl bg-surface p-4 text-xs shadow-2xl ring-1 ring-white/10"
        style={{ width: POPOVER_WIDTH, left: pos.left, top: pos.top, opacity: pos.ready ? 1 : 0 }}
      >
        {pos.arrowSide && (
          <span
            className="absolute h-3 w-3 rotate-45 bg-surface ring-1 ring-white/10"
            style={{
              top: pos.arrowTop - ARROW_HALF,
              ...(pos.arrowSide === "left" ? { left: -ARROW_HALF } : { right: -ARROW_HALF }),
            }}
            aria-hidden="true"
          />
        )}
        {content}
      </div>,
      document.body,
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 bg-black/60"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 40 }}
        onClick={onClose}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.4 }}
          dragMomentum={false}
          onDragEnd={handleDragEnd}
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] touch-none flex-col overflow-hidden rounded-t-3xl bg-surface shadow-[0_-12px_40px_rgba(0,0,0,0.5)]"
        >
          <div className="flex shrink-0 justify-center py-2.5">
            <span className="h-1 w-10 rounded-full bg-white/20" />
          </div>
          <div className="flex-1 touch-pan-y overflow-y-auto px-5 pb-6 text-xs">{content}</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ============================================================================
// shared bits
// ============================================================================

const RENT_TIER_LABELS = ["Base", "1 house", "2 houses", "3 houses", "4 houses", "Hotel"];

function ownerOf(state: GameState, ownerId: string | undefined): PlayerState | undefined {
  return ownerId ? state.players.find((p) => p.id === ownerId) : undefined;
}

// (Task 6) Owner moved to rank 2 in the hierarchy, right under the name —
// a token chip in the owner's own colour, not a grey text row at the
// bottom of a 14-row list.
function OwnerChip({ owner }: { owner: PlayerState | undefined }) {
  if (!owner) {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted">
        Unowned
      </span>
    );
  }
  const color = PLAYER_COLOR_HEX[owner.color];
  return (
    <span
      className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ backgroundColor: `${color}26`, color }}
    >
      <TokenIcon token={owner.token} className="text-sm" />
      Owned by {owner.name}
    </span>
  );
}

// (Task 6) "when / get" column headers turn a list into a table for
// free — only one rung is ever the answer: highlighted in the accent
// colour (danfo yellow, task 9), every other rung dropped to 45%.
function RentLadder({ rows, currentIndex }: { rows: { label: string; amount: number }[]; currentIndex: number | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-2 pb-0.5 text-[9px] font-semibold tracking-[0.1em] text-muted uppercase">
        <span>When</span>
        <span>Get</span>
      </div>
      {rows.map((row, i) => (
        <div
          key={i}
          className={`flex items-center justify-between rounded-md px-2 py-1 text-[13px] ${
            i === currentIndex ? "bg-accent/15 font-semibold text-accent" : "text-ink/45"
          }`}
        >
          <span>{row.label}</span>
          <span className="tabular-nums">
            <Money cents={row.amount} />
          </span>
        </div>
      ))}
    </div>
  );
}

// (Task 6) Costs collapse to a three-stat footer row instead of four
// full-width lines eating as much space as the rent ladder itself.
function StatFooter({ house, mortgage, unmortgage }: { house?: number; mortgage: number; unmortgage: number }) {
  return (
    <div
      className={`grid gap-1 border-t border-white/5 pt-2 text-center ${house !== undefined ? "grid-cols-3" : "grid-cols-2"}`}
    >
      {house !== undefined && <Stat label="House" cents={house} />}
      <Stat label="Mortgage" cents={mortgage} />
      <Stat label="Unmortgage" cents={unmortgage} />
    </div>
  );
}

function Stat({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[8.5px] font-medium tracking-wide text-muted uppercase">{label}</span>
      <span className="text-xs font-semibold tabular-nums text-ink">
        <Money cents={cents} />
      </span>
    </div>
  );
}

// (Task 6) "Actions live in the card: Buy / Build / Mortgage as a footer
// row, contextual to state and to whether it's yours. Reuse the existing
// blockedReason functions so buttons disable with an explanation." Only
// renders when there's something this viewer could actually do — a
// spectator or another player's turn sees the ladder and nothing else.
function ActionsFooter({
  state,
  space,
  own,
  session,
  dispatch,
}: {
  state: GameState;
  space: PropertySpace | TransportSpace | UtilitySpace;
  own: PropertyOwnership | undefined;
  session: PlayerSession | null | undefined;
  dispatch: ((action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>) | undefined;
}) {
  const [busy, setBusy] = useState(false);
  if (!session || !dispatch) return null;
  const me = state.players.find((p) => p.id === session.playerId);
  if (!me || me.bankrupt) return null;

  const isMyTurn = state.players[state.currentPlayerIndex]?.id === me.id;
  const canBuy = !own && isMyTurn && state.turnPhase === "awaiting_purchase" && me.position === space.index;
  const isMine = Boolean(own && own.ownerId === me.id);
  if (!canBuy && !isMine) return null;

  const buildReason = space.type === "property" ? buildHouseBlockedReason(state, me.id, space.index) : "Not buildable.";
  const mortgageReason = own?.mortgaged
    ? unmortgageBlockedReason(state, me.id, space.index)
    : mortgageBlockedReason(state, me.id, space.index);

  async function act(action: ClientAction) {
    setBusy(true);
    await dispatch!(action);
    setBusy(false);
  }

  return (
    <div className="flex gap-1.5 border-t border-white/5 pt-3">
      {canBuy && (
        <button
          type="button"
          disabled={busy || me.cashCents < space.price}
          onClick={() => act({ type: "BUY" })}
          className="flex-1 rounded-full bg-accent px-3 py-2 text-[11px] font-semibold text-accent-foreground disabled:opacity-40"
        >
          Buy · <Money cents={space.price} />
        </button>
      )}
      {isMine && space.type === "property" && (
        <button
          type="button"
          disabled={busy || buildReason !== null}
          title={buildReason ?? undefined}
          onClick={() => act({ type: "BUILD_HOUSE", spaceIndex: space.index })}
          className="flex-1 rounded-full bg-surface-2 px-3 py-2 text-[11px] font-semibold text-ink disabled:opacity-40"
        >
          Build
        </button>
      )}
      {isMine && (
        <button
          type="button"
          disabled={busy || mortgageReason !== null}
          title={mortgageReason ?? undefined}
          onClick={() => act(own?.mortgaged ? { type: "UNMORTGAGE", spaceIndex: space.index } : { type: "MORTGAGE", spaceIndex: space.index })}
          className="flex-1 rounded-full bg-surface-2 px-3 py-2 text-[11px] font-semibold text-ink disabled:opacity-40"
        >
          {own?.mortgaged ? "Unmortgage" : "Mortgage"}
        </button>
      )}
    </div>
  );
}

function SpaceCard({
  state,
  spaceIndex,
  onNavigate,
  titleId,
  session,
  dispatch,
}: {
  state: GameState;
  spaceIndex: number;
  onNavigate: (index: number) => void;
  titleId: string;
  session?: PlayerSession | null;
  dispatch?: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}) {
  const map = MAPS[state.settings.mapId];
  const space = map.spaces[spaceIndex];

  return (
    <div className="flex flex-col gap-3">
      <h2 id={titleId} className="text-base leading-tight font-bold text-ink">
        {space.name}
      </h2>
      <SpaceBody state={state} space={space} onNavigate={onNavigate} session={session} dispatch={dispatch} />
    </div>
  );
}

function SpaceBody({
  state,
  space,
  onNavigate,
  session,
  dispatch,
}: {
  state: GameState;
  space: Space;
  onNavigate: (index: number) => void;
  session?: PlayerSession | null;
  dispatch?: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}) {
  switch (space.type) {
    case "property":
      return <PropertyBody state={state} space={space} onNavigate={onNavigate} session={session} dispatch={dispatch} />;
    case "transport":
      return <TransportBody state={state} space={space} session={session} dispatch={dispatch} />;
    case "utility":
      return <UtilityBody state={state} space={space} session={session} dispatch={dispatch} />;
    case "tax":
      return <TaxBody state={state} space={space} />;
    case "go":
      return (
        <p className="text-[13px] text-ink">
          Landing on or passing GO pays <Money cents={GO_SALARY} />.
        </p>
      );
    case "jail":
      return <JailBody state={state} />;
    case "gotojail":
      return (
        <p className="text-[13px] text-ink">
          Land here and you go straight to {MAPS[state.settings.mapId].jailLabel} — no passing GO, no collecting.
        </p>
      );
    case "free":
      return <FreeParkingBody state={state} />;
    case "card":
      return (
        <p className="text-[13px] text-ink">
          Draw a random card from the {MAPS[state.settings.mapId].deckLabels[space.deck]} deck — could be a windfall, a
          bill, or something stranger.
        </p>
      );
  }
}

function JailBody({ state }: { state: GameState }) {
  const map = MAPS[state.settings.mapId];
  return (
    <p className="text-[13px] text-ink">
      Just passing through does nothing. Sent here — via Go To {map.jailLabel}, a card, or three doubles in one turn —
      and you&apos;re stuck for up to {MAX_JAIL_TURNS} turns unless you roll doubles, pay <Money cents={JAIL_FINE} />,
      or use a Get Out of Jail Free card.
      {!state.settings.collectRentWhileJailed && " Owners sitting in jail don't collect rent while they're in here."}
    </p>
  );
}

function FreeParkingBody({ state }: { state: GameState }) {
  const map = MAPS[state.settings.mapId];
  if (!state.settings.freeParkingCash && !state.settings.freeParkingSkipsTurn) {
    return <p className="text-[13px] text-ink">Just a rest stop — nothing happens when you land here.</p>;
  }
  return (
    <div className="flex flex-col gap-2 text-[13px] text-ink">
      {state.settings.freeParkingCash && (
        <p>
          Tax and bank payments pool up here. Land on {map.freeParkingLabel} and you collect the whole pot — currently{" "}
          <Money cents={state.freeParkingPot} />.
        </p>
      )}
      {state.settings.freeParkingSkipsTurn && <p>Landing here means you miss your next turn.</p>}
    </div>
  );
}

function TaxBody({ state, space }: { state: GameState; space: TaxSpace }) {
  return (
    <div className="flex flex-col gap-2 text-[13px] text-ink">
      <p>
        Pay <Money cents={space.amount} /> to the bank when you land here.
      </p>
      {state.settings.freeParkingCash && (
        <p className="text-xs text-muted">This adds to the Free Parking pot instead of vanishing.</p>
      )}
    </div>
  );
}

function TransportBody({
  state,
  space,
  session,
  dispatch,
}: {
  state: GameState;
  space: TransportSpace;
  session?: PlayerSession | null;
  dispatch?: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}) {
  const own = state.ownership[space.index];
  const ownedCount = own
    ? TRANSPORT_INDEXES.filter((idx) => {
        const o = state.ownership[idx];
        return o !== undefined && o.ownerId === own.ownerId && !o.mortgaged;
      }).length
    : 0;
  const currentTier = own && !own.mortgaged ? ownedCount - 1 : null;
  const owner = ownerOf(state, own?.ownerId);

  return (
    <div className="flex flex-col gap-3">
      <RegionBadge color={TRANSPORT_PLATE_COLOR} ink="text-white" label={space.regionLabel} />
      <OwnerChip owner={owner} />
      <RentLadder rows={TRANSPORT_RENT.map((amount, i) => ({ label: `${i + 1} owned`, amount }))} currentIndex={currentTier} />
      <StatFooter mortgage={space.mortgageValue} unmortgage={space.unmortgageCost} />
      <ActionsFooter state={state} space={space} own={own} session={session} dispatch={dispatch} />
    </div>
  );
}

function UtilityBody({
  state,
  space,
  session,
  dispatch,
}: {
  state: GameState;
  space: UtilitySpace;
  session?: PlayerSession | null;
  dispatch?: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}) {
  const own = state.ownership[space.index];
  const ownedCount = own
    ? UTILITY_INDEXES.filter((idx) => {
        const o = state.ownership[idx];
        return o !== undefined && o.ownerId === own.ownerId && !o.mortgaged;
      }).length
    : 0;
  const currentTier = own && !own.mortgaged ? (ownedCount >= 2 ? 1 : 0) : null;
  const owner = ownerOf(state, own?.ownerId);

  return (
    <div className="flex flex-col gap-3">
      <RegionBadge color={UTILITY_PLATE_COLOR} ink="text-white" label={space.regionLabel} />
      <OwnerChip owner={owner} />
      <RentLadder
        rows={[
          { label: `×${UTILITY_RENT_MULTIPLIER.oneOwned} dice — 1 owned`, amount: 0 },
          { label: `×${UTILITY_RENT_MULTIPLIER.allOwned} dice — both owned`, amount: 0 },
        ]}
        currentIndex={currentTier}
      />
      <StatFooter mortgage={space.mortgageValue} unmortgage={space.unmortgageCost} />
      <ActionsFooter state={state} space={space} own={own} session={session} dispatch={dispatch} />
    </div>
  );
}

function PropertyBody({
  state,
  space,
  onNavigate,
  session,
  dispatch,
}: {
  state: GameState;
  space: PropertySpace;
  onNavigate: (index: number) => void;
  session?: PlayerSession | null;
  dispatch?: (action: ClientAction) => Promise<{ ok: boolean; reason?: string } | null>;
}) {
  const map = MAPS[state.settings.mapId];
  const region = map.regions.find((r) => r.id === space.color);
  const own = state.ownership[space.index];
  const owner = ownerOf(state, own?.ownerId);

  // Base rent (rung 0) is the answer for an unowned property too — it's
  // what a buyer would be charging from the moment they buy it.
  let currentTierIndex: number | null = 0;
  let reason: string | null = null;

  if (own) {
    if (own.mortgaged) {
      currentTierIndex = null;
      reason = "Mortgaged — no rent";
    } else if (!state.settings.collectRentWhileJailed && owner?.inJail) {
      currentTierIndex = null;
      reason = `Owner is in ${map.jailLabel} — not collecting rent`;
    } else {
      currentTierIndex = own.hotel ? 5 : own.houses;
      const doubled =
        currentTierIndex === 0 &&
        state.settings.doubleRentOnFullSet &&
        ownsFullUnmortgagedGroup(state, own.ownerId, space.color);
      if (doubled) reason = "×2 — owner holds the full region";
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {region && <RegionBadge color={COLOR_GROUP_VAR[space.color]} ink={regionInkClass(space.color)} label={region.name} />}

      <OwnerChip owner={owner} />
      {reason && <p className="-mt-1.5 text-[11px] font-medium text-accent">{reason}</p>}

      <RentLadder rows={space.rent.map((amount, i) => ({ label: RENT_TIER_LABELS[i], amount }))} currentIndex={currentTierIndex} />

      <StatFooter house={space.houseCost} mortgage={space.mortgageValue} unmortgage={space.unmortgageCost} />

      <ActionsFooter state={state} space={space} own={own} session={session} dispatch={dispatch} />

      {region && (
        <div className="flex flex-wrap gap-1 border-t border-white/5 pt-3">
          {region.spaceIndexes.map((idx) => {
            const s = map.spaces[idx];
            if (s.type !== "property") return null;
            const chipOwn = state.ownership[idx];
            const chipOwner = ownerOf(state, chipOwn?.ownerId);
            const isCurrent = idx === space.index;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onNavigate(idx)}
                aria-label={`Inspect ${s.name}`}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-ink ${
                  isCurrent ? "ring-2 ring-accent" : "hover:bg-white/10"
                }`}
                style={{ backgroundColor: `${COLOR_GROUP_VAR[space.color]}33` }}
              >
                {chipOwner && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: PLAYER_COLOR_HEX[chipOwner.color] }}
                    aria-hidden="true"
                  />
                )}
                {s.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
