// The rules engine, as a pure function. No DB, no network, no randomness
// generated in here — dice and drawn-card ids are passed in as arguments by
// the caller, which is what makes reduce() deterministic and testable.

import { dollars } from "@/lib/money";
import {
  GO_SALARY,
  HOUSE_COST_BY_GROUP,
  JAIL_INDEX,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TRANSPORT_INDEXES,
  TRANSPORT_RENT,
  UTILITY_INDEXES,
  UTILITY_RENT_MULTIPLIER,
  type ColorGroup,
  type Deck,
  type PropertySpace,
  type Space,
} from "./board";
import type { Card, CardEffect } from "./cards";
import { MAPS } from "./maps";
import type {
  GameSettings,
  GameState,
  PendingAuction,
  PendingDebt,
  PlayerState,
  PropertyOwnership,
  TradeOffer,
  TurnPhase,
} from "./types";

export const JAIL_FINE = dollars(50);
export const MAX_JAIL_TURNS = 3;
export const MAX_DOUBLES = 3;
// (Section 3) Countdown duration, and how far a new high bid resets it —
// shared between the API layer (which owns GameState.auctionDeadline,
// same as turnStartedAt) and the client (which renders the countdown from
// it), so the two can never disagree about how long an auction runs.
export const AUCTION_DURATION_MS = 10_000;
const MAX_HOUSES_IN_BANK = 32;
const MAX_HOTELS_IN_BANK = 12;
const BOARD_SIZE = 40;

// The 40-space skeleton (which index is which SpaceType) is identical on
// every map, so board *content* is the only thing that varies per game —
// looked up fresh from state.settings.mapId wherever it's needed, rather
// than imported as a fixed module-level constant.
function boardOf(state: GameState): readonly Space[] {
  return MAPS[state.settings.mapId].spaces;
}

// ============================================================================
// actions / events
// ============================================================================

export type GameAction =
  | { type: "START_GAME" }
  | { type: "UPDATE_SETTINGS"; playerId: string; settings: Partial<GameSettings> }
  | { type: "ROLL"; playerId: string; d1: number; d2: number }
  | { type: "BUY"; playerId: string }
  | { type: "DECLINE_BUY"; playerId: string }
  // Manual "Put up for auction" — beside Buy/Decline, works regardless of
  // settings.auctionOnDecline (that setting only controls the automatic
  // trigger on a plain decline).
  | { type: "START_AUCTION"; playerId: string }
  | { type: "PLACE_BID"; playerId: string; amount: number }
  // No explicit "pass" — the auction is simultaneous and timer-driven now
  // (Section 3), not turn-by-turn; not bidding before the deadline IS
  // passing. Resolved server-side once the deadline the API layer set has
  // actually elapsed (mirrors FORCE_END_TURN's turnStartedAt check).
  | { type: "RESOLVE_AUCTION_TIMEOUT" }
  | { type: "PAY_RENT"; playerId: string }
  | { type: "RAISE_DEBT_HELP"; playerId: string }
  | { type: "DRAW_CARD"; playerId: string; cardId: string }
  | { type: "BUILD_HOUSE"; playerId: string; spaceIndex: number }
  | { type: "SELL_HOUSE"; playerId: string; spaceIndex: number }
  | { type: "MORTGAGE"; playerId: string; spaceIndex: number }
  | { type: "UNMORTGAGE"; playerId: string; spaceIndex: number }
  | { type: "PAY_JAIL_FINE"; playerId: string }
  | { type: "USE_JAIL_FREE"; playerId: string }
  | { type: "END_TURN"; playerId: string }
  | { type: "FORCE_END_TURN"; playerId: string }
  | { type: "DECLARE_BANKRUPT"; playerId: string }
  // Trade negotiation (proposing/countering/declining/cancelling) lives
  // entirely in the `trades` table now, outside the pure engine — see
  // src/app/api/games/[code]/trades/**. Only the moment a trade is
  // actually accepted needs a real state mutation (cash/ownership/jail-
  // free cards changing hands), so that's the only trade action reduce()
  // still knows about. playerId must be toPlayerId (the accepting side);
  // give/receive/fromPlayerId/toPlayerId come from the trades-table row
  // the API layer already loaded, not from client input.
  | {
      type: "EXECUTE_ACCEPTED_TRADE";
      playerId: string;
      fromPlayerId: string;
      toPlayerId: string;
      give: TradeOffer;
      receive: TradeOffer;
    };

export type GameEvent =
  | { type: "GAME_STARTED" }
  | { type: "SETTINGS_UPDATED" }
  | { type: "ROLLED"; playerId: string; d1: number; d2: number; isDoubles: boolean }
  | { type: "PASSED_GO"; playerId: string; amount: number }
  | { type: "MOVED"; playerId: string; from: number; to: number }
  | { type: "PROPERTY_PURCHASED"; playerId: string; spaceIndex: number; price: number }
  | { type: "PROPERTY_DECLINED"; playerId: string; spaceIndex: number }
  | { type: "AUCTION_STARTED"; spaceIndex: number; manual: boolean }
  | { type: "BID_PLACED"; playerId: string; amount: number }
  | { type: "AUCTION_BIDDER_DISQUALIFIED"; playerId: string; spaceIndex: number }
  | { type: "AUCTION_WON"; playerId: string; spaceIndex: number; amount: number }
  | { type: "AUCTION_ENDED_NO_WINNER"; spaceIndex: number }
  | { type: "RENT_PAID"; payerId: string; payeeId: string; spaceIndex: number; amount: number }
  | { type: "TAX_PAID"; playerId: string; amount: number; spaceIndex: number }
  | { type: "FREE_PARKING_PAID"; playerId: string; amount: number }
  | { type: "CARD_DRAWN"; playerId: string; deck: Deck; cardId: string; text: string }
  | { type: "CARD_CASH_COLLECTED"; playerId: string; amount: number }
  | { type: "CARD_CASH_PAID"; playerId: string; amount: number }
  | { type: "CARD_CASH_COLLECTED_FROM_EACH"; playerId: string; amountPerPlayer: number; totalAmount: number }
  | { type: "CARD_CASH_PAID_TO_EACH"; playerId: string; amountPerPlayer: number; totalAmount: number }
  | { type: "CARD_JAIL_FREE_RECEIVED"; playerId: string }
  | { type: "DEBT_PENDING"; playerId: string; amount: number; creditorId: string; reason: string }
  | { type: "HOUSE_BUILT"; playerId: string; spaceIndex: number; houses: number; hotel: boolean; price: number }
  | { type: "HOUSE_SOLD"; playerId: string; spaceIndex: number; houses: number; hotel: boolean; amount: number }
  | { type: "MORTGAGED"; playerId: string; spaceIndex: number; amount: number }
  | { type: "UNMORTGAGED"; playerId: string; spaceIndex: number; amount: number }
  | { type: "DEBT_RELIEF_APPLIED"; playerId: string; operations: DebtReliefOperation[] }
  | { type: "SENT_TO_JAIL"; playerId: string; reason: string }
  | { type: "JAIL_ESCAPED"; playerId: string; method: "doubles" | "fine" | "forcedFine" | "card"; amount?: number }
  | { type: "TURN_ENDED"; playerId: string }
  | { type: "TURN_TIMED_OUT"; playerId: string }
  | { type: "TURN_SKIPPED"; playerId: string }
  | { type: "PLAYER_BANKRUPT"; playerId: string; creditorId: string | "bank" }
  | { type: "PROPERTIES_RETURNED_TO_MARKET"; playerId: string }
  | { type: "GAME_OVER"; winnerPlayerId: string }
  | { type: "TRADE_ACCEPTED"; fromPlayerId: string; toPlayerId: string; give: TradeOffer; receive: TradeOffer };

// The state a freshly-created game starts in, before any player has
// joined. The caller (API layer) pushes players into `players` directly
// as they join — that's a lobby-only operation, not a GameAction, since
// joining isn't part of the in-progress turn state machine.
export function createInitialGameState(settings: GameSettings): GameState {
  return {
    settings,
    hostPlayerId: null,
    status: "lobby",
    turnPhase: "awaiting_roll",
    currentPlayerIndex: 0,
    rollIndex: 0,
    doublesCount: 0,
    players: [],
    ownership: {},
    winnerPlayerId: null,
    lastRoll: null,
    pendingCardDeck: null,
    pendingDebt: null,
    pendingAuction: null,
    freeParkingPot: 0,
    turnStartedAt: null,
    auctionDeadline: null,
  };
}

// ============================================================================
// dev-only integrity guard — every cash figure in this engine is integer
// cents. A non-integer or negative value means a bug, not bad user input.
// ============================================================================

const DEV = process.env.NODE_ENV !== "production";

function assertValidCents(value: number, label: string): void {
  if (!DEV) return;
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of cents, got ${value}`);
  }
  if (value < 0) {
    throw new Error(`${label} must not be negative, got ${value}`);
  }
}

function assertStateInvariants(state: GameState): void {
  if (!DEV) return;
  for (const player of state.players) {
    assertValidCents(player.cashCents, `players[${player.id}].cashCents`);
  }
  if (state.pendingDebt) {
    assertValidCents(state.pendingDebt.amount, "pendingDebt.amount");
  }
}

// ============================================================================
// small pure helpers
// ============================================================================

function findPlayer(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find((p) => p.id === playerId);
}

function currentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayerIndex];
}

// TS narrows `state.turnPhase` to a literal after an early-return guard and
// (incorrectly, for a mutable object) doesn't widen it back across calls
// that go on to mutate it (moveAndResolve, applyCardEffect, ...). This
// re-reads it as the full TurnPhase union so later comparisons type-check.
function phaseOf(state: GameState): TurnPhase {
  return state.turnPhase;
}

function diceTotal(roll: { d1: number; d2: number } | null): number {
  return roll ? roll.d1 + roll.d2 : 0;
}

function nextActivePlayerIndex(players: PlayerState[], fromIndex: number): number {
  const n = players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIndex + step) % n;
    if (!players[idx].bankrupt) return idx;
  }
  return fromIndex;
}

// The single choke point every "this turn is over" path funnels through —
// advances to the next active player and resets per-turn state. Centralized
// so settings.freeParkingSkipsTurn's skip flag can never slip past it no
// matter which of the several call sites ended the previous turn (a normal
// END_TURN, a forced timeout, a jail-stuck roll, a bankruptcy mid-turn...).
// Bounded to state.players.length iterations so a pathological all-players-
// flagged state can't loop forever.
function advanceTurn(state: GameState, events: GameEvent[]): void {
  state.currentPlayerIndex = nextActivePlayerIndex(state.players, state.currentPlayerIndex);
  state.doublesCount = 0;
  state.lastRoll = null;
  state.turnPhase = "awaiting_roll";

  for (let guard = 0; guard < state.players.length; guard++) {
    const next = currentPlayer(state);
    if (!next.skipNextTurn) return;
    next.skipNextTurn = false;
    events.push({ type: "TURN_SKIPPED", playerId: next.id });
    state.currentPlayerIndex = nextActivePlayerIndex(state.players, state.currentPlayerIndex);
  }
}

// Whether the current player gets to roll again after this action resolves:
// only true if the roll that's currently in flight was doubles.
function nextPhaseAfterResolution(state: GameState): TurnPhase {
  if (state.lastRoll && state.lastRoll.d1 === state.lastRoll.d2) {
    return "awaiting_roll";
  }
  return "awaiting_end_turn";
}

// True while landing resolution has paused the turn on something that
// needs its own action before anything else can proceed (a purchase
// decision, raising cash for a debt, drawing a card).
function isPausingPhase(state: GameState): boolean {
  const phase = phaseOf(state);
  return phase === "awaiting_purchase" || phase === "awaiting_payment" || phase === "awaiting_card";
}

// Exported for the property inspector (src/components/PropertyInspector.tsx)
// — it needs to know a region's full membership to render "owner holds 2 of
// 3" and the region-overview strip, without duplicating this lookup.
export function ownedPropertyIndexesInGroup(state: GameState, color: ColorGroup): number[] {
  return boardOf(state)
    .filter((s): s is PropertySpace => s.type === "property" && s.color === color)
    .map((s) => s.index);
}

export function ownsFullUnmortgagedGroup(state: GameState, ownerId: string, color: ColorGroup): boolean {
  return ownedPropertyIndexesInGroup(state, color).every((idx) => {
    const own = state.ownership[idx];
    return own !== undefined && own.ownerId === ownerId && !own.mortgaged;
  });
}

// Exported for mortgageBlockedReason/unmortgageBlockedReason below — same
// reasoning as the rent-function exports: the UI needs the identical
// type-narrowing the handler uses, not a re-derived copy of it.
export function getMortgageableSpace(
  state: GameState,
  spaceIndex: number,
): (Space & { price: number; mortgageValue: number; unmortgageCost: number }) | undefined {
  const space = boardOf(state)[spaceIndex];
  if (space.type === "property" || space.type === "transport" || space.type === "utility") {
    return space;
  }
  return undefined;
}

// Exported (along with computeTransportRent/computeUtilityRent below) so
// the property inspector can display "the rent this would charge right
// now" using the exact same function resolveLanding calls to actually
// charge it — importing this rather than re-deriving the number is what
// structurally guarantees the two can never drift apart.
export function computePropertyRent(state: GameState, space: PropertySpace, own: PropertyOwnership): number {
  const tierIndex = own.hotel ? 5 : own.houses;
  let rent = space.rent[tierIndex];
  if (
    tierIndex === 0 &&
    state.settings.doubleRentOnFullSet &&
    ownsFullUnmortgagedGroup(state, own.ownerId, space.color)
  ) {
    rent *= 2;
  }
  return rent;
}

export function computeTransportRent(state: GameState, ownerId: string): number {
  const ownedCount = TRANSPORT_INDEXES.filter((idx) => {
    const own = state.ownership[idx];
    return own !== undefined && own.ownerId === ownerId && !own.mortgaged;
  }).length;
  return TRANSPORT_RENT[Math.max(0, ownedCount - 1)] ?? 0;
}

export function computeUtilityRent(state: GameState, ownerId: string): number {
  const ownedCount = UTILITY_INDEXES.filter((idx) => {
    const own = state.ownership[idx];
    return own !== undefined && own.ownerId === ownerId && !own.mortgaged;
  }).length;
  const multiplier =
    ownedCount >= 2 ? UTILITY_RENT_MULTIPLIER.allOwned : UTILITY_RENT_MULTIPLIER.oneOwned;
  return dollars(diceTotal(state.lastRoll) * multiplier);
}

// Charges `amount` from `payer` to `creditorId` ("bank" credits no one). If
// the payer can't cover it right now, parks it as a pending debt instead of
// letting cash go negative.
function chargeOrDefer(
  state: GameState,
  payer: PlayerState,
  amount: number,
  creditorId: string | "bank",
  reason: PendingDebt["reason"],
  events: GameEvent[],
): void {
  if (amount <= 0) return;
  if (payer.cashCents >= amount) {
    payer.cashCents -= amount;
    if (creditorId !== "bank") {
      const creditor = findPlayer(state, creditorId);
      if (creditor) creditor.cashCents += amount;
    } else if (state.settings.freeParkingCash) {
      state.freeParkingPot += amount;
    }
  } else {
    state.pendingDebt = { amount, creditorId, reason };
    state.turnPhase = "awaiting_payment";
    events.push({ type: "DEBT_PENDING", playerId: payer.id, amount, creditorId, reason });
  }
}

// ============================================================================
// movement / landing resolution
// ============================================================================

function payGoIfPassed(player: PlayerState, passed: boolean, events: GameEvent[]): void {
  if (!passed) return;
  player.cashCents += GO_SALARY;
  events.push({ type: "PASSED_GO", playerId: player.id, amount: GO_SALARY });
}

// Moves `player` forward by `steps` around the board (wrapping), paying GO
// if the wrap crosses/lands on it, then resolves whatever they land on.
function moveAndResolve(state: GameState, player: PlayerState, steps: number, events: GameEvent[]): void {
  const from = player.position;
  const rawTo = from + steps;
  const to = ((rawTo % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
  const passedGo = rawTo >= BOARD_SIZE && boardOf(state)[to].type !== "gotojail";

  payGoIfPassed(player, passedGo, events);
  player.position = to;
  events.push({ type: "MOVED", playerId: player.id, from, to });
  resolveLanding(state, player, events);
}

// Teleports `player` to `to` (a card's moveTo), paying GO only if the card
// says so (authorial intent, not a wrap computation), then resolves landing.
function teleportAndResolve(
  state: GameState,
  player: PlayerState,
  to: number,
  payGo: boolean,
  events: GameEvent[],
): void {
  const from = player.position;
  payGoIfPassed(player, payGo, events);
  player.position = to;
  events.push({ type: "MOVED", playerId: player.id, from, to });
  resolveLanding(state, player, events);
}

function sendToJail(player: PlayerState, reason: string, events: GameEvent[]): void {
  player.position = JAIL_INDEX;
  player.inJail = true;
  player.jailTurns = 0;
  events.push({ type: "SENT_TO_JAIL", playerId: player.id, reason });
}

// Resolves whatever `player` just landed on. May pause the turn by setting
// turnPhase to awaiting_purchase/awaiting_payment/awaiting_card; otherwise
// leaves turnPhase for the caller (moveAndResolve/teleportAndResolve callers
// higher up) to finalize via nextPhaseAfterResolution.
function resolveLanding(state: GameState, player: PlayerState, events: GameEvent[]): void {
  const space = boardOf(state)[player.position];

  switch (space.type) {
    case "go":
    case "jail":
      return;

    case "free": {
      if (state.settings.freeParkingCash && state.freeParkingPot > 0) {
        const amount = state.freeParkingPot;
        state.freeParkingPot = 0;
        player.cashCents += amount;
        events.push({ type: "FREE_PARKING_PAID", playerId: player.id, amount });
      }
      if (state.settings.freeParkingSkipsTurn) {
        player.skipNextTurn = true;
      }
      return;
    }

    case "gotojail":
      sendToJail(player, "landed on Go To Kirikiri", events);
      return;

    case "tax": {
      chargeOrDefer(state, player, space.amount, "bank", "tax", events);
      if (state.turnPhase !== "awaiting_payment") {
        events.push({ type: "TAX_PAID", playerId: player.id, amount: space.amount, spaceIndex: space.index });
      }
      return;
    }

    case "card": {
      state.turnPhase = "awaiting_card";
      state.pendingCardDeck = space.deck;
      return;
    }

    case "property":
    case "transport":
    case "utility": {
      const own = state.ownership[space.index];
      if (!own) {
        state.turnPhase = "awaiting_purchase";
        return;
      }
      if (own.ownerId === player.id || own.mortgaged) {
        return;
      }
      if (!state.settings.collectRentWhileJailed) {
        const owner = findPlayer(state, own.ownerId);
        if (owner?.inJail) return;
      }
      const rent =
        space.type === "property"
          ? computePropertyRent(state, space, own)
          : space.type === "transport"
            ? computeTransportRent(state, own.ownerId)
            : computeUtilityRent(state, own.ownerId);

      chargeOrDefer(state, player, rent, own.ownerId, "rent", events);
      if (state.turnPhase !== "awaiting_payment") {
        events.push({
          type: "RENT_PAID",
          payerId: player.id,
          payeeId: own.ownerId,
          spaceIndex: space.index,
          amount: rent,
        });
      }
      return;
    }
  }
}

function findNearestAhead(from: number, targets: readonly number[]): number {
  const sorted = [...targets].sort((a, b) => a - b);
  return sorted.find((idx) => idx > from) ?? sorted[0];
}

// ============================================================================
// card effects
// ============================================================================

function applyCardEffect(state: GameState, player: PlayerState, card: Card, events: GameEvent[]): void {
  const effect: CardEffect = card.effect;

  switch (effect.type) {
    case "collect":
      player.cashCents += effect.amount;
      events.push({ type: "CARD_CASH_COLLECTED", playerId: player.id, amount: effect.amount });
      return;

    case "pay":
      chargeOrDefer(state, player, effect.amount, "bank", "card", events);
      if (state.turnPhase !== "awaiting_payment") {
        events.push({ type: "CARD_CASH_PAID", playerId: player.id, amount: effect.amount });
      }
      return;

    case "collectFromEach": {
      let total = 0;
      for (const other of state.players) {
        if (other.id === player.id || other.bankrupt) continue;
        const paid = Math.min(effect.amount, other.cashCents);
        other.cashCents -= paid;
        player.cashCents += paid;
        total += paid;
      }
      events.push({
        type: "CARD_CASH_COLLECTED_FROM_EACH",
        playerId: player.id,
        amountPerPlayer: effect.amount,
        totalAmount: total,
      });
      return;
    }

    case "payEach": {
      let remaining = player.cashCents;
      let total = 0;
      for (const other of state.players) {
        if (other.id === player.id || other.bankrupt) continue;
        const paid = Math.min(effect.amount, remaining);
        remaining -= paid;
        other.cashCents += paid;
        total += paid;
      }
      player.cashCents = remaining;
      events.push({
        type: "CARD_CASH_PAID_TO_EACH",
        playerId: player.id,
        amountPerPlayer: effect.amount,
        totalAmount: total,
      });
      return;
    }

    case "moveTo":
      teleportAndResolve(state, player, effect.to, effect.passGoPays, events);
      return;

    case "moveBack": {
      const to = ((player.position - effect.spaces) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
      teleportAndResolve(state, player, to, false, events);
      return;
    }

    case "goToJail":
      sendToJail(player, "drew a Go To Kirikiri card", events);
      return;

    case "jailFree":
      player.jailFreeCards += 1;
      events.push({ type: "CARD_JAIL_FREE_RECEIVED", playerId: player.id });
      return;

    case "repairs": {
      const board = boardOf(state);
      let cost = 0;
      for (const [idxStr, own] of Object.entries(state.ownership)) {
        if (own.ownerId !== player.id) continue;
        const idx = Number(idxStr);
        const space = board[idx];
        if (space.type !== "property") continue;
        cost += own.hotel ? effect.perHotel : own.houses * effect.perHouse;
      }
      chargeOrDefer(state, player, cost, "bank", "card", events);
      if (cost > 0 && state.turnPhase !== "awaiting_payment") {
        events.push({ type: "CARD_CASH_PAID", playerId: player.id, amount: cost });
      }
      return;
    }

    case "nearestTransport": {
      const to = findNearestAhead(player.position, TRANSPORT_INDEXES);
      const wrapped = to <= player.position;
      const from = player.position;
      payGoIfPassed(player, wrapped, events);
      player.position = to;
      events.push({ type: "MOVED", playerId: player.id, from, to });

      const own = state.ownership[to];
      if (!own) {
        state.turnPhase = "awaiting_purchase";
        return;
      }
      if (own.ownerId !== player.id && !own.mortgaged) {
        const rent = computeTransportRent(state, own.ownerId) * effect.rentMultiplier;
        chargeOrDefer(state, player, rent, own.ownerId, "rent", events);
        if (state.turnPhase !== "awaiting_payment") {
          events.push({ type: "RENT_PAID", payerId: player.id, payeeId: own.ownerId, spaceIndex: to, amount: rent });
        }
      }
      return;
    }

    case "nearestUtility": {
      const to = findNearestAhead(player.position, UTILITY_INDEXES);
      const wrapped = to <= player.position;
      const from = player.position;
      payGoIfPassed(player, wrapped, events);
      player.position = to;
      events.push({ type: "MOVED", playerId: player.id, from, to });

      const own = state.ownership[to];
      if (!own) {
        state.turnPhase = "awaiting_purchase";
        return;
      }
      if (own.ownerId !== player.id && !own.mortgaged) {
        // Uses the same roll that landed them here (see computeUtilityRent),
        // scaled to this card's fixed 10x rather than the ownership tier.
        const rent = dollars(diceTotal(state.lastRoll) * effect.rentMultiplier);
        chargeOrDefer(state, player, rent, own.ownerId, "rent", events);
        if (state.turnPhase !== "awaiting_payment") {
          events.push({ type: "RENT_PAID", payerId: player.id, payeeId: own.ownerId, spaceIndex: to, amount: rent });
        }
      }
      return;
    }
  }
}

// ============================================================================
// houses
// ============================================================================

function groupHouseLevel(state: GameState, spaceIndex: number): number {
  const own = state.ownership[spaceIndex];
  return own.hotel ? 5 : own.houses;
}

function totalHousesInPlay(state: GameState): number {
  let total = 0;
  for (const own of Object.values(state.ownership)) {
    if (!own.hotel) total += own.houses;
  }
  return total;
}

function totalHotelsInPlay(state: GameState): number {
  let total = 0;
  for (const own of Object.values(state.ownership)) {
    if (own.hotel) total += 1;
  }
  return total;
}

// (Section H finding) canBuildHouse only ever returns a boolean, and a
// rejected BUILD_HOUSE surfaces as the API's generic "action had no
// effect" — which technically never lies, but isn't the "clear message"
// the even-build rule specifically calls for. This gives the UI a
// human reason to show *before* dispatching, so an illegal build is a
// disabled button with an explanation rather than a silent no-op.
// Pure/no secrets — safe to import client-side, same as netWorth.
//
// (Voluntary-mortgage pass) previously skipped the turn/phase check
// entirely — canBuildHouse doesn't check it either, since handleBuildHouse
// enforces it independently, but that means the UI could show an *enabled*
// Build button on someone else's turn that then silently no-ops on click,
// exactly the bug class this function exists to prevent. Now matches
// handleBuildHouse's own gate exactly (any phase except resolving a debt or
// game over), so the two can't drift out of sync with each other.
export function buildHouseBlockedReason(state: GameState, playerId: string, spaceIndex: number): string | null {
  if (currentPlayer(state).id !== playerId) return "Wait for your turn.";
  if (state.turnPhase === "awaiting_payment") return "Resolve your debt first.";
  if (state.turnPhase === "game_over") return "The game is over.";
  const space = boardOf(state)[spaceIndex];
  if (space.type !== "property") return "Not a buildable property.";
  const own = state.ownership[spaceIndex];
  if (!own || own.ownerId !== playerId) return "You don't own this.";
  if (own.mortgaged) return "Unmortgage this first.";
  if (own.hotel) return "Already has a hotel.";
  if (!ownsFullUnmortgagedGroup(state, playerId, space.color)) {
    return "You need to own the whole region, unmortgaged, first.";
  }

  const group = ownedPropertyIndexesInGroup(state, space.color);
  const levels = group.map((idx) => groupHouseLevel(state, idx));
  const thisLevel = groupHouseLevel(state, spaceIndex);
  if (state.settings.evenBuild && thisLevel !== Math.min(...levels)) {
    return "Build evenly — this region has properties with fewer houses first.";
  }

  if (thisLevel < 4) {
    return totalHousesInPlay(state) < MAX_HOUSES_IN_BANK ? null : "The bank is out of houses.";
  }
  return totalHotelsInPlay(state) < MAX_HOTELS_IN_BANK ? null : "The bank is out of hotels.";
}

// Same pattern, for SELL_HOUSE — canSellHouse doesn't check turn/phase
// either (handleSellHouse does), and even-sell can silently block a
// mid-stack sale the exact same way even-build blocks a mid-stack build.
export function sellHouseBlockedReason(state: GameState, playerId: string, spaceIndex: number): string | null {
  if (currentPlayer(state).id !== playerId) return "Wait for your turn.";
  if (state.turnPhase === "game_over") return "The game is over.";
  const space = boardOf(state)[spaceIndex];
  if (space.type !== "property") return "Not a sellable property.";
  const own = state.ownership[spaceIndex];
  if (!own || own.ownerId !== playerId) return "You don't own this.";
  const thisLevel = groupHouseLevel(state, spaceIndex);
  if (thisLevel === 0) return "Nothing to sell here.";

  const group = ownedPropertyIndexesInGroup(state, space.color);
  const levels = group.map((idx) => groupHouseLevel(state, idx));
  if (state.settings.evenBuild && thisLevel !== Math.max(...levels)) {
    return "Sell evenly — this region has properties with more houses first.";
  }
  if (thisLevel === 5 && totalHousesInPlay(state) + 4 > MAX_HOUSES_IN_BANK) {
    return "Not enough houses left in the bank to downgrade this hotel.";
  }
  return null;
}

// Voluntary mortgaging — the whole point of this pass: raise cash by
// mortgaging properties that have nothing to do with what you're about to
// build, any time on your own turn, whether or not you owe anything.
// Mirrors handleMortgage's own checks exactly (plus the turn/phase gate
// that function also needed — see its comment) so the two can't drift.
export function mortgageBlockedReason(state: GameState, playerId: string, spaceIndex: number): string | null {
  if (!state.settings.mortgageEnabled) return "Mortgaging is turned off for this room.";
  if (currentPlayer(state).id !== playerId) return "Wait for your turn.";
  if (state.turnPhase === "game_over") return "The game is over.";
  const space = getMortgageableSpace(state, spaceIndex);
  if (!space) return "Not mortgageable.";
  const own = state.ownership[spaceIndex];
  if (!own || own.ownerId !== playerId) return "You don't own this.";
  if (own.mortgaged) return "Already mortgaged.";
  if (own.houses > 0 || own.hotel) return "Sell the houses first.";
  return null;
}

export function unmortgageBlockedReason(state: GameState, playerId: string, spaceIndex: number): string | null {
  if (!state.settings.mortgageEnabled) return "Mortgaging is turned off for this room.";
  if (currentPlayer(state).id !== playerId) return "Wait for your turn.";
  if (state.turnPhase === "game_over") return "The game is over.";
  const space = getMortgageableSpace(state, spaceIndex);
  if (!space) return "Not mortgageable.";
  const own = state.ownership[spaceIndex];
  if (!own || own.ownerId !== playerId) return "You don't own this.";
  if (!own.mortgaged) return "Not mortgaged.";
  const player = currentPlayer(state);
  if (player.cashCents < space.unmortgageCost) return "You can't afford this yet.";
  return null;
}

function canBuildHouse(state: GameState, playerId: string, spaceIndex: number): boolean {
  const space = boardOf(state)[spaceIndex];
  if (space.type !== "property") return false;
  const own = state.ownership[spaceIndex];
  if (!own || own.ownerId !== playerId || own.mortgaged) return false;
  if (own.hotel) return false;
  if (!ownsFullUnmortgagedGroup(state, playerId, space.color)) return false;

  const group = ownedPropertyIndexesInGroup(state, space.color);
  const levels = group.map((idx) => groupHouseLevel(state, idx));
  const thisLevel = groupHouseLevel(state, spaceIndex);
  if (state.settings.evenBuild && thisLevel !== Math.min(...levels)) return false; // even build rule

  if (thisLevel < 4) {
    return totalHousesInPlay(state) < MAX_HOUSES_IN_BANK;
  }
  // thisLevel === 4: this build converts to a hotel.
  return totalHotelsInPlay(state) < MAX_HOTELS_IN_BANK;
}

function canSellHouse(state: GameState, playerId: string, spaceIndex: number): boolean {
  const space = boardOf(state)[spaceIndex];
  if (space.type !== "property") return false;
  const own = state.ownership[spaceIndex];
  if (!own || own.ownerId !== playerId) return false;
  const thisLevel = groupHouseLevel(state, spaceIndex);
  if (thisLevel === 0) return false;

  const group = ownedPropertyIndexesInGroup(state, space.color);
  const levels = group.map((idx) => groupHouseLevel(state, idx));
  if (state.settings.evenBuild && thisLevel !== Math.max(...levels)) return false; // even sell rule
  if (thisLevel === 5) {
    return totalHousesInPlay(state) + 4 <= MAX_HOUSES_IN_BANK;
  }
  return true;
}

// ============================================================================
// bankruptcy
// ============================================================================

function resolveBankruptcy(
  state: GameState,
  player: PlayerState,
  creditorId: string | "bank",
  events: GameEvent[],
): void {
  // Houses/hotels always liquidate to the bank at half price before assets
  // move, per the standard rule (and this engine has no auction to sell
  // improved property through otherwise).
  const board = boardOf(state);
  for (const [idxStr, own] of Object.entries(state.ownership)) {
    if (own.ownerId !== player.id) continue;
    const idx = Number(idxStr);
    const space = board[idx];
    if (space.type !== "property") continue;
    if (own.hotel) {
      player.cashCents += Math.floor(space.houseCost / 2);
      own.hotel = false;
      own.houses = 4;
    }
    while (own.houses > 0) {
      player.cashCents += Math.floor(space.houseCost / 2);
      own.houses -= 1;
    }
  }

  const creditor = creditorId !== "bank" ? findPlayer(state, creditorId) : undefined;
  const transferToCreditor = state.settings.bankruptcyTransfersAssets && creditor !== undefined;
  let hadProperties = false;

  for (const [idxStr, own] of Object.entries(state.ownership)) {
    if (own.ownerId !== player.id) continue;
    hadProperties = true;
    const idx = Number(idxStr);
    if (transferToCreditor && creditor) {
      own.ownerId = creditor.id;
    } else {
      delete state.ownership[idx];
    }
  }

  if (creditor) {
    creditor.cashCents += player.cashCents;
    if (transferToCreditor) {
      creditor.jailFreeCards += player.jailFreeCards;
    }
  }

  player.cashCents = 0;
  player.jailFreeCards = 0;
  player.bankrupt = true;
  events.push({ type: "PLAYER_BANKRUPT", playerId: player.id, creditorId });
  if (!transferToCreditor && hadProperties) {
    events.push({ type: "PROPERTIES_RETURNED_TO_MARKET", playerId: player.id });
  }

  // Only clear pendingDebt if it actually belonged to THIS player (they
  // were the current player mid-payment). Real bug this fixes: another
  // player voluntarily going bankrupt (settings.allowManualBankruptcy) used
  // to unconditionally null out whatever debt the ACTUAL current player was
  // resolving — leaving them stuck in awaiting_payment with no pendingDebt
  // object to act on, and no way out (DECLARE_BANKRUPT requires a real
  // pendingDebt unless manual bankruptcy is also on) — a genuine deadlock.
  if (state.pendingDebt && currentPlayer(state).id === player.id && state.turnPhase === "awaiting_payment") {
    state.pendingDebt = null;
  }

  // Remove this player from any auction they were part of — a bankrupt
  // bidder's cash is gone, their bids shouldn't be able to win. If they
  // held the effective high bid, auctionHighBid naturally reverts to the
  // next-eligible bidder (or null) since it's always recomputed from
  // eligiblePlayerIds, not stored. If NO eligible bidders remain at all,
  // the auction can never resolve on its own (nobody left to place a
  // winning bid, though it still WILL eventually timeout-resolve since
  // RESOLVE_AUCTION_TIMEOUT isn't gated to auction participants) — finish
  // it immediately rather than leave it hanging.
  if (state.pendingAuction && state.pendingAuction.eligiblePlayerIds.includes(player.id)) {
    const auction = state.pendingAuction;
    const wasHighBidder = auctionHighBid(auction)?.playerId === player.id;
    auction.eligiblePlayerIds = auction.eligiblePlayerIds.filter((id) => id !== player.id);
    if (wasHighBidder) {
      events.push({ type: "AUCTION_BIDDER_DISQUALIFIED", playerId: player.id, spaceIndex: auction.spaceIndex });
    }
    if (auction.eligiblePlayerIds.length === 0) {
      finishAuction(state, events);
    }
  }

  const solvent = state.players.filter((p) => !p.bankrupt);
  if (solvent.length <= 1) {
    state.status = "finished";
    state.turnPhase = "game_over";
    state.winnerPlayerId = solvent[0]?.id ?? null;
    if (state.winnerPlayerId) {
      events.push({ type: "GAME_OVER", winnerPlayerId: state.winnerPlayerId });
    }
  } else if (state.currentPlayerIndex === state.players.indexOf(player) && !state.pendingAuction) {
    // If an auction is still open, defer the turn-advance to finishAuction
    // instead — forcing turnPhase to "awaiting_roll" here would strand the
    // still-live auction (PLACE_BID/RESOLVE_AUCTION_TIMEOUT both require
    // turnPhase === "awaiting_auction" and would silently no-op forever).
    advanceTurn(state, events);
  }
}

// Total net worth (cash + property price + house value - mortgage debt),
// used for the optional time-limit ending.
export function netWorth(state: GameState, playerId: string): number {
  const player = findPlayer(state, playerId);
  if (!player) return 0;
  let worth = player.cashCents;
  for (const [idxStr, own] of Object.entries(state.ownership)) {
    if (own.ownerId !== playerId) continue;
    const space = getMortgageableSpace(state, Number(idxStr));
    if (!space) continue;
    worth += own.mortgaged ? 0 : space.price;
    if (space.type === "property") {
      const houseCost = HOUSE_COST_BY_GROUP[space.color];
      worth += own.hotel ? houseCost * 5 : own.houses * houseCost;
    }
  }
  return worth;
}

// (Winner screen) The same total as netWorth, itemized — property value
// is counted at full price regardless of mortgage status, with the
// outstanding mortgage shown as its own negative line rather than just
// zeroing the property out.
export interface NetWorthBreakdown {
  cashCents: number;
  propertyValueCents: number;
  houseValueCents: number;
  mortgageDebtCents: number;
  totalCents: number;
}

export function netWorthBreakdown(state: GameState, playerId: string): NetWorthBreakdown {
  const player = findPlayer(state, playerId);
  if (!player) {
    return { cashCents: 0, propertyValueCents: 0, houseValueCents: 0, mortgageDebtCents: 0, totalCents: 0 };
  }

  let propertyValueCents = 0;
  let houseValueCents = 0;
  let mortgageDebtCents = 0;
  for (const [idxStr, own] of Object.entries(state.ownership)) {
    if (own.ownerId !== playerId) continue;
    const space = getMortgageableSpace(state, Number(idxStr));
    if (!space) continue;
    propertyValueCents += space.price;
    if (own.mortgaged) mortgageDebtCents += space.mortgageValue;
    if (space.type === "property") {
      const houseCost = HOUSE_COST_BY_GROUP[space.color];
      houseValueCents += own.hotel ? houseCost * 5 : own.houses * houseCost;
    }
  }

  const cashCents = player.cashCents;
  const totalCents = cashCents + propertyValueCents + houseValueCents - mortgageDebtCents;
  return { cashCents, propertyValueCents, houseValueCents, mortgageDebtCents, totalCents };
}

// ============================================================================
// debt relief ("Help me raise it")
// ============================================================================

export interface DebtReliefOperation {
  type: "mortgage" | "sellHouse";
  spaceIndex: number;
}

export interface DebtReliefPlan {
  operations: DebtReliefOperation[];
  projectedCashCents: number;
  sufficient: boolean;
}

// Simulates the minimum-pain liquidation order the spec calls for, on a
// scratch clone — never mutates the real state. Strict priority: mortgage
// bare (houseless, unmortgaged) properties cheapest-first; only once
// mortgaging every bare property still isn't enough, sell houses
// (respecting evenBuild) from the largest-invested colour group down,
// hotel-holding groups last; only if that's still not enough, mortgage the
// properties step 2 just made bare. This ordering is what guarantees a
// house is never sold while an unmortgaged bare property still exists —
// step 1 only stops early (minimum pain) when it alone already covers the
// debt; otherwise it exhausts every bare property before step 2 runs at
// all. The caller (handleRaiseDebtHelp) re-derives and applies this same
// plan for real only once the player has confirmed it.
export function computeDebtReliefPlan(state: GameState, playerId: string): DebtReliefPlan {
  const player = findPlayer(state, playerId);
  const debt = state.pendingDebt?.amount ?? 0;
  if (!player) return { operations: [], projectedCashCents: 0, sufficient: false };

  const scratch = structuredClone(state);
  const scratchPlayer = findPlayer(scratch, playerId)!;
  const operations: DebtReliefOperation[] = [];

  function bareUnmortgagedCheapestFirst(): number[] {
    return Object.entries(scratch.ownership)
      .filter(([, own]) => own.ownerId === playerId && !own.mortgaged && own.houses === 0 && !own.hotel)
      .map(([idx]) => Number(idx))
      .sort((a, b) => getMortgageableSpace(scratch, a)!.mortgageValue - getMortgageableSpace(scratch, b)!.mortgageValue);
  }

  function mortgageOne(idx: number): void {
    const space = getMortgageableSpace(scratch, idx)!;
    scratch.ownership[idx].mortgaged = true;
    scratchPlayer.cashCents += space.mortgageValue;
    operations.push({ type: "mortgage", spaceIndex: idx });
  }

  const allBare = bareUnmortgagedCheapestFirst();
  const bareTotal = allBare.reduce((sum, idx) => sum + getMortgageableSpace(scratch, idx)!.mortgageValue, 0);

  if (scratchPlayer.cashCents + bareTotal >= debt) {
    for (const idx of allBare) {
      if (scratchPlayer.cashCents >= debt) break;
      mortgageOne(idx);
    }
  } else {
    for (const idx of allBare) mortgageOne(idx);

    const board = boardOf(scratch);
    const colorGroups = new Map<ColorGroup, number[]>();
    for (const [idxStr, own] of Object.entries(scratch.ownership)) {
      if (own.ownerId !== playerId) continue;
      const idx = Number(idxStr);
      const space = board[idx];
      if (space.type !== "property" || (own.houses === 0 && !own.hotel)) continue;
      const list = colorGroups.get(space.color) ?? [];
      list.push(idx);
      colorGroups.set(space.color, list);
    }

    const investment = (indexes: number[]) =>
      indexes.reduce((sum, idx) => sum + (scratch.ownership[idx].hotel ? 5 : scratch.ownership[idx].houses), 0);
    const hasHotel = (indexes: number[]) => indexes.some((idx) => scratch.ownership[idx].hotel);

    const orderedGroups = [...colorGroups.values()].sort((a, b) => {
      const aHotel = hasHotel(a) ? 1 : 0;
      const bHotel = hasHotel(b) ? 1 : 0;
      if (aHotel !== bHotel) return aHotel - bHotel; // hotel-holding groups sell last
      return investment(b) - investment(a); // largest-invested group first
    });

    for (const groupIndexes of orderedGroups) {
      while (scratchPlayer.cashCents < debt) {
        const sellable = groupIndexes.filter((idx) => canSellHouse(scratch, playerId, idx));
        if (sellable.length === 0) break;
        const target = sellable[0]; // canSellHouse already enforces even-sell (max level first)
        const space = board[target] as PropertySpace;
        const own = scratch.ownership[target];
        scratchPlayer.cashCents += Math.floor(space.houseCost / 2);
        if (own.hotel) {
          own.hotel = false;
          own.houses = 4;
        } else {
          own.houses -= 1;
        }
        operations.push({ type: "sellHouse", spaceIndex: target });
      }
      if (scratchPlayer.cashCents >= debt) break;
    }

    if (scratchPlayer.cashCents < debt) {
      for (const idx of bareUnmortgagedCheapestFirst()) {
        if (scratchPlayer.cashCents >= debt) break;
        mortgageOne(idx);
      }
    }
  }

  return {
    operations,
    projectedCashCents: scratchPlayer.cashCents,
    sufficient: scratchPlayer.cashCents >= debt,
  };
}

// ============================================================================
// action handlers
// ============================================================================

function handleRoll(state: GameState, action: Extract<GameAction, { type: "ROLL" }>, events: GameEvent[]): void {
  const player = currentPlayer(state);
  if (player.id !== action.playerId || state.turnPhase !== "awaiting_roll") return;

  const isDoubles = action.d1 === action.d2;
  state.rollIndex += 1;
  state.lastRoll = { d1: action.d1, d2: action.d2 };
  events.push({ type: "ROLLED", playerId: player.id, d1: action.d1, d2: action.d2, isDoubles });

  if (player.inJail) {
    if (isDoubles) {
      player.inJail = false;
      player.jailTurns = 0;
      events.push({ type: "JAIL_ESCAPED", playerId: player.id, method: "doubles" });
      // Explicitly no movement on a jail doubles-escape; the turn just ends.
      events.push({ type: "TURN_ENDED", playerId: player.id });
      advanceTurn(state, events);
      return;
    }

    player.jailTurns += 1;
    if (player.jailTurns >= MAX_JAIL_TURNS) {
      chargeOrDefer(state, player, JAIL_FINE, "bank", "jailFine", events);
      player.inJail = false;
      player.jailTurns = 0;
      if (phaseOf(state) === "awaiting_payment") return; // must raise the fine first
      events.push({ type: "JAIL_ESCAPED", playerId: player.id, method: "forcedFine", amount: JAIL_FINE });
      moveAndResolve(state, player, action.d1 + action.d2, events);
      if (isPausingPhase(state)) {
        return;
      }
      state.turnPhase = "awaiting_end_turn"; // forced move never grants a re-roll
      return;
    }

    // Still stuck; turn ends without moving.
    events.push({ type: "TURN_ENDED", playerId: player.id });
    advanceTurn(state, events);
    return;
  }

  if (isDoubles) {
    state.doublesCount += 1;
    if (state.doublesCount >= MAX_DOUBLES) {
      sendToJail(player, "rolled three doubles in a row", events);
      events.push({ type: "TURN_ENDED", playerId: player.id });
      advanceTurn(state, events);
      return;
    }
  } else {
    state.doublesCount = 0;
  }

  moveAndResolve(state, player, action.d1 + action.d2, events);
  if (isPausingPhase(state)) {
    return;
  }
  state.turnPhase = nextPhaseAfterResolution(state);
}

function handleBuy(state: GameState, playerId: string, events: GameEvent[]): void {
  const player = currentPlayer(state);
  if (player.id !== playerId || state.turnPhase !== "awaiting_purchase") return;

  const space = getMortgageableSpace(state, player.position);
  if (!space || state.ownership[player.position]) return;
  if (player.cashCents < space.price) return;

  player.cashCents -= space.price;
  state.ownership[player.position] = {
    ownerId: player.id,
    houses: 0,
    hotel: false,
    mortgaged: false,
  };
  events.push({ type: "PROPERTY_PURCHASED", playerId: player.id, spaceIndex: player.position, price: space.price });
  state.turnPhase = nextPhaseAfterResolution(state);
}

function handleDeclineBuy(state: GameState, playerId: string, events: GameEvent[]): void {
  const player = currentPlayer(state);
  if (player.id !== playerId || state.turnPhase !== "awaiting_purchase") return;
  const spaceIndex = player.position;
  events.push({ type: "PROPERTY_DECLINED", playerId: player.id, spaceIndex });
  if (state.settings.auctionOnDecline) {
    startAuction(state, spaceIndex, false, events);
    return;
  }
  state.turnPhase = nextPhaseAfterResolution(state);
}

// Manual "Put up for auction" (beside Buy/Decline) — works regardless of
// settings.auctionOnDecline, which only governs the automatic trigger on a
// plain decline. Still only the current player, still only while the
// purchase decision is live.
function handleStartAuction(state: GameState, playerId: string, events: GameEvent[]): void {
  const player = currentPlayer(state);
  if (player.id !== playerId || state.turnPhase !== "awaiting_purchase") return;
  const spaceIndex = player.position;
  if (state.ownership[spaceIndex]) return;
  events.push({ type: "PROPERTY_DECLINED", playerId: player.id, spaceIndex });
  startAuction(state, spaceIndex, true, events);
}

// ============================================================================
// auctions — simultaneous and timer-driven (Section 3), not turn-by-turn.
// The countdown deadline itself lives outside this pure engine (see
// GameState.auctionDeadline's own comment) — reduce() only ever sees
// PLACE_BID (from any eligible player, any time) or RESOLVE_AUCTION_TIMEOUT
// (dispatched by the API layer once it's verified the deadline passed).
// ============================================================================

function startAuction(state: GameState, spaceIndex: number, manual: boolean, events: GameEvent[]): void {
  const eligiblePlayerIds = state.players.filter((p) => !p.bankrupt).map((p) => p.id);
  if (eligiblePlayerIds.length === 0) return;
  state.pendingAuction = { spaceIndex, eligiblePlayerIds, bids: [] };
  state.turnPhase = "awaiting_auction";
  events.push({ type: "AUCTION_STARTED", spaceIndex, manual });
}

// The effective high bid is always recomputed from the full bid ledger
// filtered to still-eligible bidders — never stored redundantly — so a
// disqualified (bankrupt) bidder's offer silently falls back to whoever's
// next without any special-case "revert" logic elsewhere.
// Exported so the auction UI computes "who's leading, at what amount"
// using the exact same logic finishAuction actually pays out on, rather
// than a re-derived copy that could drift — same reasoning as
// computePropertyRent/computeTransportRent above.
export function auctionHighBid(auction: PendingAuction): { playerId: string; amount: number } | null {
  let best: { playerId: string; amount: number } | null = null;
  for (const bid of auction.bids) {
    if (!auction.eligiblePlayerIds.includes(bid.playerId)) continue;
    if (!best || bid.amount > best.amount) best = bid;
  }
  return best;
}

function finishAuction(state: GameState, events: GameEvent[]): void {
  const auction = state.pendingAuction;
  if (!auction) return;
  const high = auctionHighBid(auction);

  if (high) {
    const winner = findPlayer(state, high.playerId);
    if (winner) {
      winner.cashCents -= high.amount;
      state.ownership[auction.spaceIndex] = {
        ownerId: winner.id,
        houses: 0,
        hotel: false,
        mortgaged: false,
      };
      events.push({ type: "AUCTION_WON", playerId: winner.id, spaceIndex: auction.spaceIndex, amount: high.amount });
    }
  } else {
    events.push({ type: "AUCTION_ENDED_NO_WINNER", spaceIndex: auction.spaceIndex });
  }

  state.pendingAuction = null;
  // If the player whose turn this technically still is has since gone
  // bankrupt (e.g. mid-auction, from an unrelated debt or a voluntary
  // quit), nextPhaseAfterResolution would hand the turn right back to
  // someone who can no longer act — advance past them instead. See
  // resolveBankruptcy's matching deferral for the other half of this.
  if (currentPlayer(state).bankrupt) {
    advanceTurn(state, events);
  } else {
    state.turnPhase = nextPhaseAfterResolution(state);
  }
}

function handlePlaceBid(
  state: GameState,
  action: Extract<GameAction, { type: "PLACE_BID" }>,
  events: GameEvent[],
): void {
  const auction = state.pendingAuction;
  if (!auction || state.turnPhase !== "awaiting_auction") return;
  if (!auction.eligiblePlayerIds.includes(action.playerId)) return;
  const player = findPlayer(state, action.playerId);
  if (!player) return;
  const currentHigh = auctionHighBid(auction)?.amount ?? 0;
  if (action.amount <= currentHigh) return; // stale — "Someone outbid you" (surfaced by the API layer)
  if (player.cashCents < action.amount) return;

  auction.bids.push({ playerId: action.playerId, amount: action.amount });
  events.push({ type: "BID_PLACED", playerId: action.playerId, amount: action.amount });
}

function handleResolveAuctionTimeout(state: GameState, events: GameEvent[]): void {
  if (!state.pendingAuction || state.turnPhase !== "awaiting_auction") return;
  finishAuction(state, events);
}

// (Debt panel choice 2, "Help me raise it") Re-derives the same plan
// computeDebtReliefPlan would preview and applies it for real — mortgaging
// and selling houses through the normal handlers so events/invariants stay
// identical to a player doing it manually. Only raises cash; the player
// still has to PAY_RENT afterward (same as choice 1), so a stale/insincere
// plan can never silently pay a debt the player didn't confirm.
function handleRaiseDebtHelp(state: GameState, playerId: string, events: GameEvent[]): void {
  if (state.turnPhase !== "awaiting_payment" || !state.pendingDebt) return;
  if (currentPlayer(state).id !== playerId) return;

  const plan = computeDebtReliefPlan(state, playerId);
  if (!plan.sufficient || plan.operations.length === 0) return;

  for (const op of plan.operations) {
    if (op.type === "mortgage") {
      handleMortgage(state, playerId, op.spaceIndex, events);
    } else {
      handleSellHouse(state, playerId, op.spaceIndex, events);
    }
  }
  events.push({ type: "DEBT_RELIEF_APPLIED", playerId, operations: plan.operations });
}

function handlePayRent(state: GameState, playerId: string, events: GameEvent[]): void {
  const player = findPlayer(state, playerId);
  if (!player || state.turnPhase !== "awaiting_payment" || !state.pendingDebt) return;
  if (player.cashCents < state.pendingDebt.amount) return;

  const { amount, creditorId, reason } = state.pendingDebt;
  player.cashCents -= amount;
  if (creditorId !== "bank") {
    const creditor = findPlayer(state, creditorId);
    if (creditor) creditor.cashCents += amount;
  } else if (state.settings.freeParkingCash) {
    state.freeParkingPot += amount;
  }
  state.pendingDebt = null;
  if (reason === "rent") {
    events.push({ type: "RENT_PAID", payerId: player.id, payeeId: creditorId, spaceIndex: player.position, amount });
  } else if (reason === "tax") {
    events.push({ type: "TAX_PAID", playerId: player.id, amount, spaceIndex: player.position });
  } else if (reason === "card") {
    events.push({ type: "CARD_CASH_PAID", playerId: player.id, amount });
  } else if (reason === "jailFine") {
    events.push({ type: "JAIL_ESCAPED", playerId: player.id, method: "forcedFine", amount });
  }
  state.turnPhase = nextPhaseAfterResolution(state);
}

function handleDrawCard(
  state: GameState,
  action: Extract<GameAction, { type: "DRAW_CARD" }>,
  events: GameEvent[],
): void {
  const player = currentPlayer(state);
  if (player.id !== action.playerId || state.turnPhase !== "awaiting_card" || !state.pendingCardDeck) return;

  const deck = MAPS[state.settings.mapId].decks[state.pendingCardDeck];
  const card = deck.find((c) => c.id === action.cardId);
  if (!card) return;

  events.push({ type: "CARD_DRAWN", playerId: player.id, deck: card.deck, cardId: card.id, text: card.text });
  state.pendingCardDeck = null;
  // Placeholder so a non-movement effect (collect/pay/jailFree/repairs,
  // which never call resolveLanding) doesn't leave turnPhase stuck on
  // "awaiting_card" — the check below would then wrongly treat it as still
  // pending. Movement effects (moveTo/moveBack/nearest*) overwrite this via
  // resolveLanding; chargeOrDefer overwrites it too if payment is short.
  state.turnPhase = "awaiting_end_turn";
  applyCardEffect(state, player, card, events);

  if (isPausingPhase(state)) {
    return;
  }
  state.turnPhase = nextPhaseAfterResolution(state);
}

function handleBuildHouse(state: GameState, playerId: string, spaceIndex: number, events: GameEvent[]): void {
  const player = currentPlayer(state);
  if (player.id !== playerId) return;
  // (Voluntary-mortgage pass) was awaiting_roll/awaiting_end_turn only —
  // building is now available at any point on your own turn (mortgage
  // three properties, then build, all before or after rolling), the same
  // as mortgaging/selling. awaiting_payment stays excluded on purpose:
  // building new houses while you owe an unresolved debt stays disallowed
  // (see handleSellHouse's comment — only unwinding is allowed there).
  if (state.turnPhase === "awaiting_payment" || state.turnPhase === "game_over") return;
  if (!canBuildHouse(state, playerId, spaceIndex)) return;

  const space = boardOf(state)[spaceIndex] as PropertySpace;
  const own = state.ownership[spaceIndex];
  if (player.cashCents < space.houseCost) return;

  player.cashCents -= space.houseCost;
  if (own.houses === 4) {
    own.houses = 0;
    own.hotel = true;
  } else {
    own.houses += 1;
  }
  events.push({ type: "HOUSE_BUILT", playerId, spaceIndex, houses: own.houses, hotel: own.hotel, price: space.houseCost });
}

function handleSellHouse(state: GameState, playerId: string, spaceIndex: number, events: GameEvent[]): void {
  const player = currentPlayer(state);
  if (player.id !== playerId) return;
  // awaiting_payment is included (not just awaiting_roll/awaiting_end_turn)
  // so a debtor can sell houses to raise cash — both as the "raise it
  // myself" self-service option and via computeDebtReliefPlan's own
  // internal call to this same handler — and, since the Voluntary-mortgage
  // pass, so can any player on any other phase of their own turn, whether
  // or not they owe anything. Only game_over is excluded. Building new
  // houses mid-debt stays disallowed (see handleBuildHouse), only
  // unwinding does.
  if (state.turnPhase === "game_over") return;
  if (!canSellHouse(state, playerId, spaceIndex)) return;

  const space = boardOf(state)[spaceIndex] as PropertySpace;
  const own = state.ownership[spaceIndex];
  const saleAmount = Math.floor(space.houseCost / 2);
  player.cashCents += saleAmount;
  if (own.hotel) {
    own.hotel = false;
    own.houses = 4;
  } else {
    own.houses -= 1;
  }
  events.push({ type: "HOUSE_SOLD", playerId, spaceIndex, houses: own.houses, hotel: own.hotel, amount: saleAmount });
}

// (Voluntary-mortgage pass, real bug) this had NO turn or phase check at
// all — any player could mortgage their own property during anyone else's
// turn, in any phase, including mid-auction or mid-someone-else's-debt.
// Now gated the same as handleSellHouse: any phase on your own turn except
// game_over. Deliberately NOT excluding awaiting_payment — mortgaging is
// as legitimate a self-service debt-relief move as selling houses is (see
// that handler's comment), and computeDebtReliefPlan's own internal call
// to this same handler depends on awaiting_payment staying reachable here.
function handleMortgage(state: GameState, playerId: string, spaceIndex: number, events: GameEvent[]): void {
  if (!state.settings.mortgageEnabled) return;
  if (currentPlayer(state).id !== playerId) return;
  if (state.turnPhase === "game_over") return;
  const own = state.ownership[spaceIndex];
  const space = getMortgageableSpace(state, spaceIndex);
  if (!own || !space || own.ownerId !== playerId || own.mortgaged) return;
  if (own.houses > 0 || own.hotel) return;

  const player = findPlayer(state, playerId);
  if (!player) return;

  own.mortgaged = true;
  player.cashCents += space.mortgageValue;
  events.push({ type: "MORTGAGED", playerId, spaceIndex, amount: space.mortgageValue });
}

function handleUnmortgage(state: GameState, playerId: string, spaceIndex: number, events: GameEvent[]): void {
  if (!state.settings.mortgageEnabled) return;
  if (currentPlayer(state).id !== playerId) return;
  if (state.turnPhase === "game_over") return;
  const own = state.ownership[spaceIndex];
  const space = getMortgageableSpace(state, spaceIndex);
  if (!own || !space || own.ownerId !== playerId || !own.mortgaged) return;

  const player = findPlayer(state, playerId);
  if (!player || player.cashCents < space.unmortgageCost) return;

  own.mortgaged = false;
  player.cashCents -= space.unmortgageCost;
  events.push({ type: "UNMORTGAGED", playerId, spaceIndex, amount: space.unmortgageCost });
}

function handlePayJailFine(state: GameState, playerId: string, events: GameEvent[]): void {
  const player = currentPlayer(state);
  if (player.id !== playerId || !player.inJail || state.turnPhase !== "awaiting_roll") return;
  if (player.cashCents < JAIL_FINE) return;

  player.cashCents -= JAIL_FINE;
  player.inJail = false;
  player.jailTurns = 0;
  events.push({ type: "JAIL_ESCAPED", playerId, method: "fine", amount: JAIL_FINE });
}

function handleUseJailFree(state: GameState, playerId: string, events: GameEvent[]): void {
  const player = currentPlayer(state);
  if (player.id !== playerId || !player.inJail || state.turnPhase !== "awaiting_roll") return;
  if (player.jailFreeCards <= 0) return;

  player.jailFreeCards -= 1;
  player.inJail = false;
  player.jailTurns = 0;
  events.push({ type: "JAIL_ESCAPED", playerId, method: "card" });
}

function handleEndTurn(state: GameState, playerId: string, events: GameEvent[]): void {
  const player = currentPlayer(state);
  if (player.id !== playerId || state.turnPhase !== "awaiting_end_turn") return;

  events.push({ type: "TURN_ENDED", playerId });
  advanceTurn(state, events);
}

// (Section 3 turn watchdog) Forces the stuck turn to resolve when the
// caller (API layer, which owns wall-clock time — see turnStartedAt) has
// verified the game has sat in the same turn_phase with the same current
// player beyond the turn time limit (settings.turnTimeLimitSeconds, or a
// 3-minute default when unset — see the API route). "The game must never
// deadlock": every phase a player can get stuck in has a resolution here,
// each reusing the exact same handler a real player action would —
// awaiting_purchase auto-declines (respecting auctionOnDecline, same as a
// real DECLINE_BUY), awaiting_payment forces the debtor bankrupt (same as
// a real DECLARE_BANKRUPT), awaiting_roll/awaiting_end_turn just skip the
// turn. awaiting_auction has its own timeout path (RESOLVE_AUCTION_TIMEOUT)
// since it isn't turn-bound at all; awaiting_card has no safe forced move
// here (the drawn card's identity is deck state the pure engine doesn't
// own — the caller would have to draw one on the player's behalf, which
// is a product decision, not a mechanical one) and is deliberately left
// alone.
function handleForceEndTurn(state: GameState, playerId: string, events: GameEvent[]): void {
  const player = currentPlayer(state);
  if (player.id !== playerId) return;

  switch (state.turnPhase) {
    case "awaiting_roll":
    case "awaiting_end_turn":
      events.push({ type: "TURN_TIMED_OUT", playerId });
      advanceTurn(state, events);
      return;
    case "awaiting_purchase":
      events.push({ type: "TURN_TIMED_OUT", playerId });
      handleDeclineBuy(state, playerId, events);
      return;
    case "awaiting_payment":
      if (!state.pendingDebt) return;
      events.push({ type: "TURN_TIMED_OUT", playerId });
      resolveBankruptcy(state, player, state.pendingDebt.creditorId, events);
      return;
    default:
      return;
  }
}

// Host-only, lobby-only. Rejected outright once the game is active — settings
// freeze at start per the spec ("reject any mutation with a clear error");
// the caller surfaces a message using the fact this was a no-op.
function handleUpdateSettings(
  state: GameState,
  action: Extract<GameAction, { type: "UPDATE_SETTINGS" }>,
  events: GameEvent[],
): void {
  if (state.status !== "lobby") return;
  if (state.hostPlayerId !== action.playerId) return;

  const patch = action.settings;
  if (patch.maxPlayers !== undefined) {
    if (patch.maxPlayers < MIN_PLAYERS || patch.maxPlayers > MAX_PLAYERS) return;
    if (patch.maxPlayers < state.players.length) return;
  }

  state.settings = { ...state.settings, ...patch };
  events.push({ type: "SETTINGS_UPDATED" });
}

function handleDeclareBankrupt(state: GameState, playerId: string, events: GameEvent[]): void {
  const player = findPlayer(state, playerId);
  if (!player || player.bankrupt) return;
  const hasPendingDebt =
    state.pendingDebt !== null && state.turnPhase === "awaiting_payment" && currentPlayer(state).id === playerId;
  if (!hasPendingDebt && !state.settings.allowManualBankruptcy) return;
  const creditorId = state.pendingDebt?.creditorId ?? "bank";
  resolveBankruptcy(state, player, creditorId, events);
}

// Exported for the trades API routes (propose/counter): they need the same
// "no houses, must actually own it, can afford it" check before writing a
// new open offer, not just at accept time. Pure/no secrets, same as
// netWorth/computeDebtReliefPlan — safe to import server- or client-side.
export function tradeOfferValid(state: GameState, playerId: string, offer: TradeOffer): boolean {
  const player = findPlayer(state, playerId);
  if (!player) return false;
  if (offer.cashCents > player.cashCents) return false;
  if (offer.jailFreeCards > player.jailFreeCards) return false;
  for (const idx of offer.spaceIndexes) {
    const own = state.ownership[idx];
    if (!own || own.ownerId !== playerId) return false;
    if (own.houses > 0 || own.hotel) return false; // can't trade improved property
  }
  return true;
}

// A player currently frozen mid-debt-resolution can't be traded with —
// "or one part of an active debt resolution" — since pendingDebt only ever
// belongs to the current player, that's the only id to check.
export function isMidDebtResolution(state: GameState, playerId: string): boolean {
  return state.turnPhase === "awaiting_payment" && state.pendingDebt !== null && currentPlayer(state).id === playerId;
}

// The only trade-related engine action: actually executing one both sides
// have already agreed to (proposing/countering/declining live in the
// `trades` table, outside the pure engine). Re-validates both offers
// against the LIVE state — ownership/cash may have moved since the offer
// was made — and pushes no events at all if anything's gone stale, which
// the API layer reads as "the board has changed since this offer was
// made" rather than executing a partial/stale trade.
function handleExecuteAcceptedTrade(
  state: GameState,
  action: Extract<GameAction, { type: "EXECUTE_ACCEPTED_TRADE" }>,
  events: GameEvent[],
): void {
  if (!state.settings.tradingEnabled) return;
  if (action.playerId !== action.toPlayerId) return;
  if (isMidDebtResolution(state, action.fromPlayerId) || isMidDebtResolution(state, action.toPlayerId)) return;
  if (!tradeOfferValid(state, action.fromPlayerId, action.give)) return;
  if (!tradeOfferValid(state, action.toPlayerId, action.receive)) return;

  const from = findPlayer(state, action.fromPlayerId);
  const to = findPlayer(state, action.toPlayerId);
  if (!from || !to) return;

  from.cashCents -= action.give.cashCents;
  to.cashCents += action.give.cashCents;
  from.jailFreeCards -= action.give.jailFreeCards;
  to.jailFreeCards += action.give.jailFreeCards;
  for (const idx of action.give.spaceIndexes) state.ownership[idx].ownerId = to.id;

  to.cashCents -= action.receive.cashCents;
  from.cashCents += action.receive.cashCents;
  to.jailFreeCards -= action.receive.jailFreeCards;
  from.jailFreeCards += action.receive.jailFreeCards;
  for (const idx of action.receive.spaceIndexes) state.ownership[idx].ownerId = from.id;

  events.push({
    type: "TRADE_ACCEPTED",
    fromPlayerId: action.fromPlayerId,
    toPlayerId: action.toPlayerId,
    give: action.give,
    receive: action.receive,
  });
}

// ============================================================================
// reduce
// ============================================================================

export function reduce(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const draft = structuredClone(state);
  const events: GameEvent[] = [];

  switch (action.type) {
    case "START_GAME":
      draft.status = "active";
      draft.turnPhase = "awaiting_roll";
      draft.currentPlayerIndex = 0;
      draft.doublesCount = 0;
      events.push({ type: "GAME_STARTED" });
      break;
    case "UPDATE_SETTINGS":
      handleUpdateSettings(draft, action, events);
      break;
    case "ROLL":
      handleRoll(draft, action, events);
      break;
    case "BUY":
      handleBuy(draft, action.playerId, events);
      break;
    case "DECLINE_BUY":
      handleDeclineBuy(draft, action.playerId, events);
      break;
    case "START_AUCTION":
      handleStartAuction(draft, action.playerId, events);
      break;
    case "PLACE_BID":
      handlePlaceBid(draft, action, events);
      break;
    case "RESOLVE_AUCTION_TIMEOUT":
      handleResolveAuctionTimeout(draft, events);
      break;
    case "PAY_RENT":
      handlePayRent(draft, action.playerId, events);
      break;
    case "RAISE_DEBT_HELP":
      handleRaiseDebtHelp(draft, action.playerId, events);
      break;
    case "DRAW_CARD":
      handleDrawCard(draft, action, events);
      break;
    case "BUILD_HOUSE":
      handleBuildHouse(draft, action.playerId, action.spaceIndex, events);
      break;
    case "SELL_HOUSE":
      handleSellHouse(draft, action.playerId, action.spaceIndex, events);
      break;
    case "MORTGAGE":
      handleMortgage(draft, action.playerId, action.spaceIndex, events);
      break;
    case "UNMORTGAGE":
      handleUnmortgage(draft, action.playerId, action.spaceIndex, events);
      break;
    case "PAY_JAIL_FINE":
      handlePayJailFine(draft, action.playerId, events);
      break;
    case "USE_JAIL_FREE":
      handleUseJailFree(draft, action.playerId, events);
      break;
    case "END_TURN":
      handleEndTurn(draft, action.playerId, events);
      break;
    case "FORCE_END_TURN":
      handleForceEndTurn(draft, action.playerId, events);
      break;
    case "DECLARE_BANKRUPT":
      handleDeclareBankrupt(draft, action.playerId, events);
      break;
    case "EXECUTE_ACCEPTED_TRADE":
      handleExecuteAcceptedTrade(draft, action, events);
      break;
  }

  assertStateInvariants(draft);
  return { state: draft, events };
}
