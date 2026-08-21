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
  PendingDebt,
  PlayerState,
  PropertyOwnership,
  TradeOffer,
  TurnPhase,
} from "./types";

const JAIL_FINE = dollars(50);
const MAX_JAIL_TURNS = 3;
const MAX_DOUBLES = 3;
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
  | { type: "PLACE_BID"; playerId: string; amount: number }
  | { type: "PASS_AUCTION"; playerId: string }
  | { type: "PAY_RENT"; playerId: string }
  | { type: "DRAW_CARD"; playerId: string; cardId: string }
  | { type: "BUILD_HOUSE"; playerId: string; spaceIndex: number }
  | { type: "SELL_HOUSE"; playerId: string; spaceIndex: number }
  | { type: "MORTGAGE"; playerId: string; spaceIndex: number }
  | { type: "UNMORTGAGE"; playerId: string; spaceIndex: number }
  | { type: "CHOOSE_TAX"; playerId: string; option: "flat" | "percent" }
  | { type: "PAY_JAIL_FINE"; playerId: string }
  | { type: "USE_JAIL_FREE"; playerId: string }
  | { type: "END_TURN"; playerId: string }
  | { type: "FORCE_END_TURN"; playerId: string }
  | { type: "DECLARE_BANKRUPT"; playerId: string }
  | {
      type: "PROPOSE_TRADE";
      fromPlayerId: string;
      toPlayerId: string;
      give: TradeOffer;
      receive: TradeOffer;
    }
  | { type: "ACCEPT_TRADE"; playerId: string; tradeId: number }
  | { type: "DECLINE_TRADE"; playerId: string; tradeId: number };

export type GameEvent =
  | { type: "GAME_STARTED" }
  | { type: "SETTINGS_UPDATED" }
  | { type: "ROLLED"; playerId: string; d1: number; d2: number; isDoubles: boolean }
  | { type: "PASSED_GO"; playerId: string; amount: number }
  | { type: "MOVED"; playerId: string; from: number; to: number }
  | { type: "PROPERTY_PURCHASED"; playerId: string; spaceIndex: number; price: number }
  | { type: "PROPERTY_DECLINED"; playerId: string; spaceIndex: number }
  | { type: "AUCTION_STARTED"; spaceIndex: number }
  | { type: "BID_PLACED"; playerId: string; amount: number }
  | { type: "AUCTION_PASSED"; playerId: string }
  | { type: "AUCTION_WON"; playerId: string; spaceIndex: number; amount: number }
  | { type: "AUCTION_ENDED_NO_WINNER"; spaceIndex: number }
  | { type: "RENT_PAID"; payerId: string; payeeId: string; spaceIndex: number; amount: number }
  | { type: "TAX_PAID"; playerId: string; amount: number }
  | { type: "FREE_PARKING_PAID"; playerId: string; amount: number }
  | { type: "CARD_DRAWN"; playerId: string; deck: Deck; cardId: string; text: string }
  | { type: "DEBT_PENDING"; playerId: string; amount: number; creditorId: string; reason: string }
  | { type: "HOUSE_BUILT"; playerId: string; spaceIndex: number; houses: number; hotel: boolean }
  | { type: "HOUSE_SOLD"; playerId: string; spaceIndex: number; houses: number; hotel: boolean }
  | { type: "MORTGAGED"; playerId: string; spaceIndex: number }
  | { type: "UNMORTGAGED"; playerId: string; spaceIndex: number }
  | { type: "SENT_TO_JAIL"; playerId: string; reason: string }
  | { type: "JAIL_ESCAPED"; playerId: string; method: "doubles" | "fine" | "card" }
  | { type: "TURN_ENDED"; playerId: string }
  | { type: "TURN_TIMED_OUT"; playerId: string }
  | { type: "PLAYER_BANKRUPT"; playerId: string; creditorId: string | "bank" }
  | { type: "PROPERTIES_RETURNED_TO_MARKET"; playerId: string }
  | { type: "GAME_OVER"; winnerPlayerId: string }
  | { type: "TRADE_PROPOSED"; tradeId: number }
  | { type: "TRADE_ACCEPTED"; tradeId: number }
  | { type: "TRADE_DECLINED"; tradeId: number }
  | { type: "TRADE_REJECTED"; tradeId: number; reason: string };

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
    pendingTaxChoice: null,
    pendingDebt: null,
    pendingAuction: null,
    freeParkingPot: 0,
    turnStartedAt: null,
    trades: [],
    nextTradeId: 1,
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
// decision, a tax choice, raising cash for a debt, drawing a card).
function isPausingPhase(state: GameState): boolean {
  const phase = phaseOf(state);
  return (
    phase === "awaiting_purchase" ||
    phase === "awaiting_tax_choice" ||
    phase === "awaiting_payment" ||
    phase === "awaiting_card"
  );
}

function ownedPropertyIndexesInGroup(state: GameState, color: ColorGroup): number[] {
  return boardOf(state)
    .filter((s): s is PropertySpace => s.type === "property" && s.color === color)
    .map((s) => s.index);
}

function ownsFullUnmortgagedGroup(state: GameState, ownerId: string, color: ColorGroup): boolean {
  return ownedPropertyIndexesInGroup(state, color).every((idx) => {
    const own = state.ownership[idx];
    return own !== undefined && own.ownerId === ownerId && !own.mortgaged;
  });
}

function getMortgageableSpace(
  state: GameState,
  spaceIndex: number,
): (Space & { price: number; mortgageValue: number; unmortgageCost: number }) | undefined {
  const space = boardOf(state)[spaceIndex];
  if (space.type === "property" || space.type === "transport" || space.type === "utility") {
    return space;
  }
  return undefined;
}

function computePropertyRent(state: GameState, space: PropertySpace, own: PropertyOwnership): number {
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

function computeTransportRent(state: GameState, ownerId: string): number {
  const ownedCount = TRANSPORT_INDEXES.filter((idx) => {
    const own = state.ownership[idx];
    return own !== undefined && own.ownerId === ownerId && !own.mortgaged;
  }).length;
  return TRANSPORT_RENT[Math.max(0, ownedCount - 1)] ?? 0;
}

function computeUtilityRent(state: GameState, ownerId: string): number {
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
      return;
    }

    case "gotojail":
      sendToJail(player, "landed on Go To Kirikiri", events);
      return;

    case "tax": {
      if (space.choice) {
        state.turnPhase = "awaiting_tax_choice";
        state.pendingTaxChoice = { spaceIndex: space.index };
        return;
      }
      chargeOrDefer(state, player, space.amount, "bank", "tax", events);
      if (state.turnPhase !== "awaiting_payment") {
        events.push({ type: "TAX_PAID", playerId: player.id, amount: space.amount });
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
      return;

    case "pay":
      chargeOrDefer(state, player, effect.amount, "bank", "card", events);
      return;

    case "collectFromEach":
      for (const other of state.players) {
        if (other.id === player.id || other.bankrupt) continue;
        const paid = Math.min(effect.amount, other.cashCents);
        other.cashCents -= paid;
        player.cashCents += paid;
      }
      return;

    case "payEach": {
      let remaining = player.cashCents;
      for (const other of state.players) {
        if (other.id === player.id || other.bankrupt) continue;
        const paid = Math.min(effect.amount, remaining);
        remaining -= paid;
        other.cashCents += paid;
      }
      player.cashCents = remaining;
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

  if (state.pendingDebt) {
    state.pendingDebt = null;
  }

  const solvent = state.players.filter((p) => !p.bankrupt);
  if (solvent.length <= 1) {
    state.status = "finished";
    state.turnPhase = "game_over";
    state.winnerPlayerId = solvent[0]?.id ?? null;
    if (state.winnerPlayerId) {
      events.push({ type: "GAME_OVER", winnerPlayerId: state.winnerPlayerId });
    }
  } else if (state.currentPlayerIndex === state.players.indexOf(player)) {
    state.currentPlayerIndex = nextActivePlayerIndex(state.players, state.currentPlayerIndex);
    state.turnPhase = "awaiting_roll";
    state.doublesCount = 0;
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
      state.doublesCount = 0;
      state.currentPlayerIndex = nextActivePlayerIndex(state.players, state.currentPlayerIndex);
      state.turnPhase = "awaiting_roll";
      events.push({ type: "TURN_ENDED", playerId: player.id });
      return;
    }

    player.jailTurns += 1;
    if (player.jailTurns >= MAX_JAIL_TURNS) {
      chargeOrDefer(state, player, JAIL_FINE, "bank", "tax", events);
      player.inJail = false;
      player.jailTurns = 0;
      if (phaseOf(state) === "awaiting_payment") return; // must raise the fine first
      moveAndResolve(state, player, action.d1 + action.d2, events);
      if (isPausingPhase(state)) {
        return;
      }
      state.turnPhase = "awaiting_end_turn"; // forced move never grants a re-roll
      return;
    }

    // Still stuck; turn ends without moving.
    state.doublesCount = 0;
    state.currentPlayerIndex = nextActivePlayerIndex(state.players, state.currentPlayerIndex);
    state.turnPhase = "awaiting_roll";
    events.push({ type: "TURN_ENDED", playerId: player.id });
    return;
  }

  if (isDoubles) {
    state.doublesCount += 1;
    if (state.doublesCount >= MAX_DOUBLES) {
      sendToJail(player, "rolled three doubles in a row", events);
      state.doublesCount = 0;
      state.currentPlayerIndex = nextActivePlayerIndex(state.players, state.currentPlayerIndex);
      state.turnPhase = "awaiting_roll";
      events.push({ type: "TURN_ENDED", playerId: player.id });
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
    startAuction(state, spaceIndex, events);
    return;
  }
  state.turnPhase = nextPhaseAfterResolution(state);
}

// ============================================================================
// auctions (settings.auctionOnDecline)
// ============================================================================

function startAuction(state: GameState, spaceIndex: number, events: GameEvent[]): void {
  const eligiblePlayerIds = state.players.filter((p) => !p.bankrupt).map((p) => p.id);
  if (eligiblePlayerIds.length === 0) return;
  const startIndex = nextActivePlayerIndex(state.players, state.currentPlayerIndex);
  state.pendingAuction = {
    spaceIndex,
    highestBid: 0,
    highestBidderId: null,
    eligiblePlayerIds,
    turnPlayerId: state.players[startIndex].id,
  };
  state.turnPhase = "awaiting_auction";
  events.push({ type: "AUCTION_STARTED", spaceIndex });
}

function advanceAuctionTurn(state: GameState): void {
  const auction = state.pendingAuction;
  if (!auction) return;
  const order = state.players.filter((p) => auction.eligiblePlayerIds.includes(p.id));
  if (order.length === 0) return;
  const currentIdx = order.findIndex((p) => p.id === auction.turnPlayerId);
  const next = order[(currentIdx + 1) % order.length];
  auction.turnPlayerId = next.id;
}

function finishAuction(state: GameState, events: GameEvent[]): void {
  const auction = state.pendingAuction;
  if (!auction) return;

  if (auction.highestBidderId) {
    const winner = findPlayer(state, auction.highestBidderId);
    if (winner) {
      winner.cashCents -= auction.highestBid;
      state.ownership[auction.spaceIndex] = {
        ownerId: winner.id,
        houses: 0,
        hotel: false,
        mortgaged: false,
      };
      events.push({
        type: "AUCTION_WON",
        playerId: winner.id,
        spaceIndex: auction.spaceIndex,
        amount: auction.highestBid,
      });
    }
  } else {
    events.push({ type: "AUCTION_ENDED_NO_WINNER", spaceIndex: auction.spaceIndex });
  }

  state.pendingAuction = null;
  state.turnPhase = nextPhaseAfterResolution(state);
}

function handlePlaceBid(
  state: GameState,
  action: Extract<GameAction, { type: "PLACE_BID" }>,
  events: GameEvent[],
): void {
  const auction = state.pendingAuction;
  if (!auction || state.turnPhase !== "awaiting_auction") return;
  if (auction.turnPlayerId !== action.playerId) return;
  const player = findPlayer(state, action.playerId);
  if (!player) return;
  if (action.amount <= auction.highestBid) return;
  if (player.cashCents < action.amount) return;

  auction.highestBid = action.amount;
  auction.highestBidderId = action.playerId;
  events.push({ type: "BID_PLACED", playerId: action.playerId, amount: action.amount });
  advanceAuctionTurn(state);
}

function handlePassAuction(state: GameState, playerId: string, events: GameEvent[]): void {
  const auction = state.pendingAuction;
  if (!auction || state.turnPhase !== "awaiting_auction") return;
  if (auction.turnPlayerId !== playerId) return;

  auction.eligiblePlayerIds = auction.eligiblePlayerIds.filter((id) => id !== playerId);
  events.push({ type: "AUCTION_PASSED", playerId });

  if (auction.eligiblePlayerIds.length <= 1) {
    finishAuction(state, events);
  } else {
    advanceAuctionTurn(state);
  }
}

// Resolves a choice tax space (e.g. Income Tax: flat $200 or 10% of net
// worth, player's pick). netWorth is computed BEFORE any charge, same as
// landing on it would see.
function handleChooseTax(
  state: GameState,
  action: Extract<GameAction, { type: "CHOOSE_TAX" }>,
  events: GameEvent[],
): void {
  const player = currentPlayer(state);
  if (player.id !== action.playerId || state.turnPhase !== "awaiting_tax_choice" || !state.pendingTaxChoice) {
    return;
  }

  const space = boardOf(state)[state.pendingTaxChoice.spaceIndex];
  if (space.type !== "tax" || !space.choice) return;

  const amount =
    action.option === "flat"
      ? space.choice.flatAmountCents
      : Math.round((netWorth(state, player.id) * space.choice.percentOfNetWorth) / 100);

  state.pendingTaxChoice = null;
  state.turnPhase = "awaiting_end_turn"; // placeholder; chargeOrDefer overwrites if short
  chargeOrDefer(state, player, amount, "bank", "tax", events);
  if (phaseOf(state) === "awaiting_payment") return;

  events.push({ type: "TAX_PAID", playerId: player.id, amount });
  state.turnPhase = nextPhaseAfterResolution(state);
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
    events.push({ type: "TAX_PAID", playerId: player.id, amount });
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
  if (state.turnPhase !== "awaiting_roll" && state.turnPhase !== "awaiting_end_turn") return;
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
  events.push({ type: "HOUSE_BUILT", playerId, spaceIndex, houses: own.houses, hotel: own.hotel });
}

function handleSellHouse(state: GameState, playerId: string, spaceIndex: number, events: GameEvent[]): void {
  const player = currentPlayer(state);
  if (player.id !== playerId) return;
  if (state.turnPhase !== "awaiting_roll" && state.turnPhase !== "awaiting_end_turn") return;
  if (!canSellHouse(state, playerId, spaceIndex)) return;

  const space = boardOf(state)[spaceIndex] as PropertySpace;
  const own = state.ownership[spaceIndex];
  player.cashCents += Math.floor(space.houseCost / 2);
  if (own.hotel) {
    own.hotel = false;
    own.houses = 4;
  } else {
    own.houses -= 1;
  }
  events.push({ type: "HOUSE_SOLD", playerId, spaceIndex, houses: own.houses, hotel: own.hotel });
}

function handleMortgage(state: GameState, playerId: string, spaceIndex: number, events: GameEvent[]): void {
  if (!state.settings.mortgageEnabled) return;
  const own = state.ownership[spaceIndex];
  const space = getMortgageableSpace(state, spaceIndex);
  if (!own || !space || own.ownerId !== playerId || own.mortgaged) return;
  if (own.houses > 0 || own.hotel) return;

  const player = findPlayer(state, playerId);
  if (!player) return;

  own.mortgaged = true;
  player.cashCents += space.mortgageValue;
  events.push({ type: "MORTGAGED", playerId, spaceIndex });
}

function handleUnmortgage(state: GameState, playerId: string, spaceIndex: number, events: GameEvent[]): void {
  const own = state.ownership[spaceIndex];
  const space = getMortgageableSpace(state, spaceIndex);
  if (!own || !space || own.ownerId !== playerId || !own.mortgaged) return;

  const player = findPlayer(state, playerId);
  if (!player || player.cashCents < space.unmortgageCost) return;

  own.mortgaged = false;
  player.cashCents -= space.unmortgageCost;
  events.push({ type: "UNMORTGAGED", playerId, spaceIndex });
}

function handlePayJailFine(state: GameState, playerId: string, events: GameEvent[]): void {
  const player = currentPlayer(state);
  if (player.id !== playerId || !player.inJail || state.turnPhase !== "awaiting_roll") return;
  if (player.cashCents < JAIL_FINE) return;

  player.cashCents -= JAIL_FINE;
  player.inJail = false;
  player.jailTurns = 0;
  events.push({ type: "JAIL_ESCAPED", playerId, method: "fine" });
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
  state.currentPlayerIndex = nextActivePlayerIndex(state.players, state.currentPlayerIndex);
  state.doublesCount = 0;
  state.lastRoll = null;
  state.turnPhase = "awaiting_roll";
}

// (settings.turnTimeLimitSeconds) Forces the current turn to end when the
// caller (API layer, which owns wall-clock time) has verified turnStartedAt
// is old enough. Only fires from a phase with nothing left unresolved — an
// open debt, tax choice, card draw, purchase decision, or auction always
// wins over the clock; the timer just skips a player who won't roll/end.
function handleForceEndTurn(state: GameState, playerId: string, events: GameEvent[]): void {
  const player = currentPlayer(state);
  if (player.id !== playerId) return;
  if (state.turnPhase !== "awaiting_roll" && state.turnPhase !== "awaiting_end_turn") return;

  events.push({ type: "TURN_TIMED_OUT", playerId });
  state.currentPlayerIndex = nextActivePlayerIndex(state.players, state.currentPlayerIndex);
  state.doublesCount = 0;
  state.lastRoll = null;
  state.turnPhase = "awaiting_roll";
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

function tradeOfferValid(state: GameState, playerId: string, offer: TradeOffer): boolean {
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

function handleProposeTrade(
  state: GameState,
  action: Extract<GameAction, { type: "PROPOSE_TRADE" }>,
  events: GameEvent[],
): void {
  if (!state.settings.tradingEnabled) return;
  if (!tradeOfferValid(state, action.fromPlayerId, action.give)) return;
  if (!tradeOfferValid(state, action.toPlayerId, action.receive)) return;

  const id = state.nextTradeId;
  state.nextTradeId += 1;
  state.trades.push({
    id,
    fromPlayerId: action.fromPlayerId,
    toPlayerId: action.toPlayerId,
    give: action.give,
    receive: action.receive,
  });
  events.push({ type: "TRADE_PROPOSED", tradeId: id });
}

function handleAcceptTrade(state: GameState, playerId: string, tradeId: number, events: GameEvent[]): void {
  const trade = state.trades.find((t) => t.id === tradeId);
  if (!trade || trade.toPlayerId !== playerId) return;
  state.trades = state.trades.filter((t) => t.id !== tradeId);

  if (!tradeOfferValid(state, trade.fromPlayerId, trade.give) || !tradeOfferValid(state, trade.toPlayerId, trade.receive)) {
    events.push({ type: "TRADE_REJECTED", tradeId, reason: "no longer valid" });
    return;
  }

  const from = findPlayer(state, trade.fromPlayerId);
  const to = findPlayer(state, trade.toPlayerId);
  if (!from || !to) return;

  from.cashCents -= trade.give.cashCents;
  to.cashCents += trade.give.cashCents;
  from.jailFreeCards -= trade.give.jailFreeCards;
  to.jailFreeCards += trade.give.jailFreeCards;
  for (const idx of trade.give.spaceIndexes) state.ownership[idx].ownerId = to.id;

  to.cashCents -= trade.receive.cashCents;
  from.cashCents += trade.receive.cashCents;
  to.jailFreeCards -= trade.receive.jailFreeCards;
  from.jailFreeCards += trade.receive.jailFreeCards;
  for (const idx of trade.receive.spaceIndexes) state.ownership[idx].ownerId = from.id;

  events.push({ type: "TRADE_ACCEPTED", tradeId });
}

function handleDeclineTrade(state: GameState, playerId: string, tradeId: number, events: GameEvent[]): void {
  const trade = state.trades.find((t) => t.id === tradeId);
  if (!trade || trade.toPlayerId !== playerId) return;
  state.trades = state.trades.filter((t) => t.id !== tradeId);
  events.push({ type: "TRADE_DECLINED", tradeId });
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
    case "PLACE_BID":
      handlePlaceBid(draft, action, events);
      break;
    case "PASS_AUCTION":
      handlePassAuction(draft, action.playerId, events);
      break;
    case "PAY_RENT":
      handlePayRent(draft, action.playerId, events);
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
    case "CHOOSE_TAX":
      handleChooseTax(draft, action, events);
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
    case "PROPOSE_TRADE":
      handleProposeTrade(draft, action, events);
      break;
    case "ACCEPT_TRADE":
      handleAcceptTrade(draft, action.playerId, action.tradeId, events);
      break;
    case "DECLINE_TRADE":
      handleDeclineTrade(draft, action.playerId, action.tradeId, events);
      break;
  }

  assertStateInvariants(draft);
  return { state: draft, events };
}
