"use client";

import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { useEffect, useId, useState } from "react";
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
import { computePropertyRent, JAIL_FINE, MAX_JAIL_TURNS, ownsFullUnmortgagedGroup } from "@/game/engine";
import { MAPS } from "@/game/maps";
import type { GameState, PlayerState } from "@/game/types";
import { COLOR_GROUP_HEX } from "@/lib/board-colors";
import { PLAYER_TOKEN_COLOR } from "@/lib/tokens";
import { Modal } from "./Modal";
import { Money } from "./Money";
import { TokenIcon } from "./TokenIcon";

interface PropertyInspectorProps {
  state: GameState;
  spaceIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

const DRAG_TO_CLOSE_THRESHOLD = 90;

// Read-only, no turn restriction, no state mutation: renders purely from
// `state`, dispatches nothing. Desktop gets the shared Modal (centered,
// tap-outside/Escape already built in); below md it's a swipe-down bottom
// sheet instead, matching MobileSheet's isMobile-via-matchMedia pattern.
export function PropertyInspector({ state, spaceIndex, onClose, onNavigate }: PropertyInspectorProps) {
  const [isDesktop, setIsDesktop] = useState(true);
  const titleId = useId();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Escape-to-close for the mobile sheet — the desktop path renders through
  // Modal, which already handles this itself.
  useEffect(() => {
    if (isDesktop) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isDesktop, onClose]);

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > DRAG_TO_CLOSE_THRESHOLD || info.velocity.y > 700) onClose();
  }

  const content = <SpaceCard state={state} spaceIndex={spaceIndex} onNavigate={onNavigate} titleId={titleId} />;

  if (isDesktop) {
    return (
      <Modal onClose={onClose} className="max-w-lg" ariaLabelledBy={titleId}>
        {content}
      </Modal>
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
          <div className="flex-1 touch-pan-y overflow-y-auto px-5 pb-6">{content}</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ============================================================================
// per-space-type card bodies
// ============================================================================

const RENT_TIER_LABELS = ["Base", "1 house", "2 houses", "3 houses", "4 houses", "Hotel"];

function ownerOf(state: GameState, ownerId: string | undefined): PlayerState | undefined {
  return ownerId ? state.players.find((p) => p.id === ownerId) : undefined;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className="tabular-nums text-ink">{value}</span>
    </div>
  );
}

function OwnerRow({ state, ownerId }: { state: GameState; ownerId: string | undefined }) {
  const owner = ownerOf(state, ownerId);
  return (
    <Row
      label="Owner"
      value={
        owner ? (
          <span className="inline-flex items-center gap-1.5">
            <TokenIcon token={owner.token} className="text-base" />
            {owner.name}
          </span>
        ) : (
          "Unowned"
        )
      }
    />
  );
}

function HousePipsRow({ own }: { own: { houses: number; hotel: boolean } | undefined }) {
  if (!own) return null;
  return (
    <Row
      label="Improvements"
      value={
        own.hotel ? "Hotel" : own.houses > 0 ? `${own.houses} house${own.houses > 1 ? "s" : ""}` : "None"
      }
    />
  );
}

function SpaceCard({
  state,
  spaceIndex,
  onNavigate,
  titleId,
}: {
  state: GameState;
  spaceIndex: number;
  onNavigate: (index: number) => void;
  titleId: string;
}) {
  const map = MAPS[state.settings.mapId];
  const space = map.spaces[spaceIndex];

  return (
    <div className="flex flex-col gap-4">
      <h2 id={titleId} className="text-lg font-bold text-ink">
        {space.name}
      </h2>
      <SpaceBody state={state} space={space} onNavigate={onNavigate} />
    </div>
  );
}

function SpaceBody({
  state,
  space,
  onNavigate,
}: {
  state: GameState;
  space: Space;
  onNavigate: (index: number) => void;
}) {
  switch (space.type) {
    case "property":
      return <PropertyBody state={state} space={space} onNavigate={onNavigate} />;
    case "transport":
      return <TransportBody state={state} space={space} />;
    case "utility":
      return <UtilityBody state={state} space={space} />;
    case "tax":
      return <TaxBody state={state} space={space} />;
    case "go":
      return <p className="text-sm text-ink">Landing on or passing GO pays <Money cents={GO_SALARY} />.</p>;
    case "jail":
      return <JailBody state={state} />;
    case "gotojail":
      return (
        <p className="text-sm text-ink">
          Land here and you go straight to {MAPS[state.settings.mapId].jailLabel} — no passing GO, no collecting.
        </p>
      );
    case "free":
      return <FreeParkingBody state={state} />;
    case "card":
      return (
        <p className="text-sm text-ink">
          Draw a random card from the {MAPS[state.settings.mapId].deckLabels[space.deck]} deck — could be a
          windfall, a bill, or something stranger.
        </p>
      );
  }
}

function JailBody({ state }: { state: GameState }) {
  const map = MAPS[state.settings.mapId];
  return (
    <p className="text-sm text-ink">
      Just passing through does nothing. Sent here — via Go To {map.jailLabel}, a card, or three doubles in one
      turn — and you&apos;re stuck for up to {MAX_JAIL_TURNS} turns unless you roll doubles, pay{" "}
      <Money cents={JAIL_FINE} />, or use a Get Out of Jail Free card.
      {!state.settings.collectRentWhileJailed && " Owners sitting in jail don't collect rent while they're in here."}
    </p>
  );
}

function FreeParkingBody({ state }: { state: GameState }) {
  const map = MAPS[state.settings.mapId];
  if (!state.settings.freeParkingCash) {
    return <p className="text-sm text-ink">Just a rest stop — nothing happens when you land here.</p>;
  }
  return (
    <p className="text-sm text-ink">
      Tax and bank payments pool up here. Land on {map.freeParkingLabel} and you collect the whole pot — currently{" "}
      <Money cents={state.freeParkingPot} />.
    </p>
  );
}

function TaxBody({ state, space }: { state: GameState; space: TaxSpace }) {
  return (
    <div className="flex flex-col gap-2 text-sm text-ink">
      {space.choice ? (
        <p>
          Pay <Money cents={space.choice.flatAmountCents} /> flat, or {space.choice.percentOfNetWorth}% of your net
          worth — your choice when you land here.
        </p>
      ) : (
        <p>
          Pay <Money cents={space.amount} /> to the bank when you land here.
        </p>
      )}
      {state.settings.freeParkingCash && (
        <p className="text-xs text-muted">
          {space.choice ? "The flat option adds" : "This adds"} to the Free Parking pot instead of vanishing.
        </p>
      )}
    </div>
  );
}

function TransportBody({ state, space }: { state: GameState; space: TransportSpace }) {
  const own = state.ownership[space.index];
  const ownedCount = own
    ? TRANSPORT_INDEXES.filter((idx) => {
        const o = state.ownership[idx];
        return o !== undefined && o.ownerId === own.ownerId && !o.mortgaged;
      }).length
    : 0;
  const currentTier = own && !own.mortgaged ? ownedCount - 1 : null;

  let reason: string | null = null;
  if (own) {
    reason = own.mortgaged
      ? "Mortgaged — no rent"
      : `${ownedCount} transport hub${ownedCount > 1 ? "s" : ""} owned`;
  }

  return (
    <div className="flex flex-col gap-3">
      <Row label="Price" value={<Money cents={space.price} />} />
      {reason && <p className="text-xs text-accent">{reason}</p>}
      <table className="w-full border-collapse text-sm">
        <tbody>
          {TRANSPORT_RENT.map((amount, i) => (
            <tr key={i} className={i === currentTier ? "rounded-lg bg-accent/15" : ""}>
              <td className="py-1 pr-3 text-muted">{i + 1} owned</td>
              <td className="py-1 text-right tabular-nums text-ink">
                <Money cents={amount} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <OwnerRow state={state} ownerId={own?.ownerId} />
      <Row label="Mortgage value" value={<Money cents={space.mortgageValue} />} />
      <Row label="Unmortgage cost" value={<Money cents={space.unmortgageCost} />} />
    </div>
  );
}

function UtilityBody({ state, space }: { state: GameState; space: UtilitySpace }) {
  const own = state.ownership[space.index];
  const ownedCount = own
    ? UTILITY_INDEXES.filter((idx) => {
        const o = state.ownership[idx];
        return o !== undefined && o.ownerId === own.ownerId && !o.mortgaged;
      }).length
    : 0;
  const active = own && !own.mortgaged ? (ownedCount >= 2 ? "ten" : "four") : null;

  return (
    <div className="flex flex-col gap-3">
      <Row label="Price" value={<Money cents={space.price} />} />
      {own && (
        <p className="text-xs text-accent">
          {own.mortgaged ? "Mortgaged — no rent" : `${ownedCount} utilit${ownedCount > 1 ? "ies" : "y"} owned`}
        </p>
      )}
      <div className="flex flex-col gap-1.5 text-sm">
        <div className={`rounded-lg px-2 py-1.5 ${active === "four" ? "bg-accent/15" : ""}`}>
          <span className="text-ink">×{UTILITY_RENT_MULTIPLIER.oneOwned} the dice roll</span>{" "}
          <span className="text-muted">— one utility owned</span>
        </div>
        <div className={`rounded-lg px-2 py-1.5 ${active === "ten" ? "bg-accent/15" : ""}`}>
          <span className="text-ink">×{UTILITY_RENT_MULTIPLIER.allOwned} the dice roll</span>{" "}
          <span className="text-muted">— both utilities owned</span>
        </div>
      </div>
      <OwnerRow state={state} ownerId={own?.ownerId} />
      <Row label="Mortgage value" value={<Money cents={space.mortgageValue} />} />
      <Row label="Unmortgage cost" value={<Money cents={space.unmortgageCost} />} />
    </div>
  );
}

function PropertyBody({
  state,
  space,
  onNavigate,
}: {
  state: GameState;
  space: PropertySpace;
  onNavigate: (index: number) => void;
}) {
  const map = MAPS[state.settings.mapId];
  const region = map.regions.find((r) => r.id === space.color);
  const own = state.ownership[space.index];
  const barColor = COLOR_GROUP_HEX[space.color];
  const owner = ownerOf(state, own?.ownerId);

  let currentTierIndex: number | null = null;
  let currentRentCents: number | null = null;
  let reason: string | null = null;

  if (own) {
    if (own.mortgaged) {
      reason = "Mortgaged — no rent";
      currentRentCents = 0;
    } else if (!state.settings.collectRentWhileJailed && owner?.inJail) {
      reason = `Owner is in ${map.jailLabel} — not collecting rent`;
      currentRentCents = 0;
    } else {
      currentTierIndex = own.hotel ? 5 : own.houses;
      currentRentCents = computePropertyRent(state, space, own);
      const doubled =
        currentTierIndex === 0 &&
        state.settings.doubleRentOnFullSet &&
        ownsFullUnmortgagedGroup(state, own.ownerId, space.color);
      reason = doubled
        ? "×2 — owner holds the full region"
        : own.hotel
          ? "Hotel"
          : own.houses > 0
            ? `${own.houses} house${own.houses > 1 ? "s" : ""}`
            : "Base rent";
    }
  }

  const regionOwnedByOwner =
    region && own ? region.spaceIndexes.filter((idx) => state.ownership[idx]?.ownerId === own.ownerId).length : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="h-2 w-full rounded-full" style={{ backgroundColor: barColor }} />

      {region && (
        <p className="-mt-2 text-xs text-muted">
          {region.flagEmoji ? `${region.flagEmoji} ` : ""}
          {region.name}
        </p>
      )}

      <Row label="List price" value={<Money cents={space.price} />} />

      {reason && currentRentCents !== null && (
        <div className="rounded-xl bg-accent/10 px-3 py-2">
          <p className="text-sm font-semibold text-ink">
            Currently charging <Money cents={currentRentCents} />
          </p>
          <p className="text-xs text-accent">{reason}</p>
        </div>
      )}

      <table className="w-full border-collapse text-sm">
        <tbody>
          {space.rent.map((amount, i) => (
            <tr key={i} className={i === currentTierIndex ? "rounded-lg bg-accent/15" : ""}>
              <td className="py-1 pr-3 text-muted">{RENT_TIER_LABELS[i]}</td>
              <td className="py-1 text-right tabular-nums text-ink">
                <Money cents={amount} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col gap-1.5 border-t border-white/5 pt-3">
        <Row label="House cost" value={<Money cents={space.houseCost} />} />
        <Row label="Hotel cost" value={<Money cents={space.houseCost} />} />
        <Row label="Mortgage value" value={<Money cents={space.mortgageValue} />} />
        <Row label="Unmortgage cost" value={<Money cents={space.unmortgageCost} />} />
        <OwnerRow state={state} ownerId={own?.ownerId} />
        <HousePipsRow own={own} />
        {region && own && (
          <Row
            label="Region"
            value={`${regionOwnedByOwner} of ${region.spaceIndexes.length} in ${region.name}`}
          />
        )}
      </div>

      {region && (
        <div className="flex flex-wrap gap-1.5 border-t border-white/5 pt-3">
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
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink ${
                  isCurrent ? "ring-2 ring-accent" : "hover:bg-white/10"
                }`}
                style={{ backgroundColor: `${barColor}33` }}
              >
                {chipOwner && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: PLAYER_TOKEN_COLOR[chipOwner.token] }}
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
