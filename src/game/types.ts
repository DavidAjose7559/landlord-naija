import { dollars } from "@/lib/money";
import type { PlayerColor } from "@/lib/player-colors";
import type { Deck } from "./board";
import type { MapId } from "./maps/types";

// Mirrors the `games.state` jsonb column: the full, realtime-synced game
// state snapshot. Denormalized copies of some fields (roll_index,
// current_player_index, turn_phase, doubles_count) also live as real
// columns on `games` for querying/indexing — this is the shape sent to
// clients as one blob.

export type GameStatus = "lobby" | "active" | "finished";

export type NaijaToken = "danfo" | "keke" | "jollof" | "gele" | "okada" | "agbada" | "suya" | "bottle";

// Original artwork (see TokenIcon.tsx) — generic silhouettes, not traced
// from or resembling any existing product.
export type ClassicToken =
  | "tophat"
  | "racecar"
  | "dog"
  | "boot"
  | "ship"
  | "thimble"
  | "wheelbarrow"
  | "iron";

export type PlayerToken = NaijaToken | ClassicToken;

// Host-configured, frozen once status leaves "lobby" (see games.settings /
// GameState.settings). Every field here is actually wired into engine.ts —
// see engine.test.ts's "settings" describe block for an ON/OFF pair per
// setting.
export interface GameSettings {
  mapId: MapId;
  maxPlayers: number; // 2-8
  privateRoom: boolean; // true = not listed via GET /api/games/public
  startingCashCents: number;
  randomizePlayerOrder: boolean; // shuffled at START_GAME time (outside the pure engine, like card shuffling)
  doubleRentOnFullSet: boolean;
  freeParkingCash: boolean; // tax payments pool into GameState.freeParkingPot, paid out on landing
  freeParkingSkipsTurn: boolean; // landing on Free Parking/its map equivalent forces the player to miss their next turn
  // OFF: landing on an unowned space offers BUY or DECLINE_BUY only — a
  // decline always leaves it with the bank, no auction ever triggers.
  // ON: the decision is BUY or START_AUCTION only — DECLINE_BUY is
  // rejected, since there's no plain decline once auctions are on.
  auctionsEnabled: boolean;
  collectRentWhileJailed: boolean; // false = no rent owed to a currently-jailed owner
  mortgageEnabled: boolean;
  evenBuild: boolean;
  allowManualBankruptcy: boolean; // true = DECLARE_BANKRUPT works with no pending debt (voluntary quit)
  bankruptcyTransfersAssets: boolean; // false = assets return to the bank unowned/unimproved, not to the creditor
  tradingEnabled: boolean;
  turnTimeLimitSeconds: number; // 0 = off
}

export const DEFAULT_SETTINGS: GameSettings = {
  mapId: "naija",
  maxPlayers: 4,
  privateRoom: true,
  startingCashCents: dollars(1500),
  randomizePlayerOrder: true,
  doubleRentOnFullSet: true,
  freeParkingCash: false,
  freeParkingSkipsTurn: false,
  auctionsEnabled: false,
  collectRentWhileJailed: true,
  mortgageEnabled: true,
  evenBuild: true,
  allowManualBankruptcy: false,
  bankruptcyTransfersAssets: true,
  tradingEnabled: true,
  turnTimeLimitSeconds: 0,
};

// The default is "awaiting_roll" (matches the games.turn_phase DB default).
export type TurnPhase =
  | "awaiting_roll" // must ROLL (or PAY_JAIL_FINE/USE_JAIL_FREE if in jail)
  | "awaiting_purchase" // landed on an unowned space; BUY or DECLINE_BUY/START_AUCTION depending on settings.auctionsEnabled
  | "awaiting_auction" // (settings.auctionsEnabled) declined/can't afford; PLACE_BID or PASS_AUCTION
  | "awaiting_payment" // owes rent/tax/a card's pay effect; see pendingDebt
  | "awaiting_card" // landed on a card space; waiting for a DRAW_CARD action
  | "awaiting_end_turn" // move fully resolved; may build/trade/mortgage, then END_TURN
  | "game_over";

// Deliberately excludes client_token: that secret lives only on the
// `players` table row and must never be embedded in a broadcast state blob.
export interface PlayerState {
  id: string;
  name: string;
  token: PlayerToken;
  // (Task 10b) Chosen at join time, separate from the token — ownership
  // rings and every player-identity dot key off this now, not the token.
  color: PlayerColor;
  seatIndex: number;
  cashCents: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  jailFreeCards: number;
  bankrupt: boolean;
  // (settings.freeParkingSkipsTurn) armed on landing on Free Parking/its
  // map equivalent; consumed (and cleared) the next time advanceTurn()
  // would otherwise hand this player the roll.
  skipNextTurn: boolean;
}

// Ownership/build state for one ownable space (property, transport, or
// utility). Keyed by board space index in GameState.ownership — spaces with
// no entry are unowned.
export interface PropertyOwnership {
  ownerId: string;
  houses: number; // 0-4
  hotel: boolean;
  mortgaged: boolean;
}

// A debt the current player owes (rent to another player, tax or a card's
// pay effect to the bank) that they didn't have enough cash to cover the
// instant it was incurred. Cleared by PAY_RENT once they can afford it
// (having raised cash via MORTGAGE/SELL_HOUSE), or by DECLARE_BANKRUPT.
export interface PendingDebt {
  amount: number;
  creditorId: string | "bank";
  reason: "rent" | "tax" | "card" | "jailFine";
}

export interface TradeOffer {
  cashCents: number;
  spaceIndexes: number[];
  jailFreeCards: number;
}

// (settings.auctionsEnabled, either a plain decline or START_AUCTION) A
// property nobody bought outright goes up for auction among every solvent player
// simultaneously (Section 3 — no more turn-by-turn bidding). `bids` is a
// full, append-only history (most recent last) rather than just the
// current high bid — that's what lets a bankrupt bidder's offer be
// dropped cleanly: the effective high bid is always recomputed from
// `bids` filtered to `eligiblePlayerIds` (see auctionHighBid in engine.ts),
// so disqualifying a bidder automatically reverts to whoever's next,
// without deleting anything from the ledger.
export interface PendingAuction {
  spaceIndex: number;
  eligiblePlayerIds: string[]; // solvent players still allowed to bid; shrinks only on bankruptcy/leaving, never on a plain non-bid
  bids: { playerId: string; amount: number }[];
}

export interface GameState {
  settings: GameSettings;
  hostPlayerId: string | null;
  status: GameStatus;
  turnPhase: TurnPhase;
  currentPlayerIndex: number;
  rollIndex: number;
  doublesCount: number;
  players: PlayerState[];
  ownership: Record<number, PropertyOwnership>;
  winnerPlayerId: string | null;

  // The dice from the most recent ROLL action. Utility rent uses these
  // ("the actual dice that landed you there") even when resolved a step
  // later, e.g. from inside a card effect.
  lastRoll: { d1: number; d2: number } | null;

  // Set when the current player has landed on a card space; the caller
  // (which owns deck/shuffle state, outside this pure engine) draws from
  // this deck and dispatches DRAW_CARD with the result.
  pendingCardDeck: Deck | null;

  pendingDebt: PendingDebt | null;
  pendingAuction: PendingAuction | null;

  // (settings.freeParkingCash) accumulated tax payments, paid out to
  // whoever next lands on Free Parking. Always 0 and unused when the
  // setting is off.
  freeParkingPot: number;

  // (settings.turnTimeLimitSeconds) epoch ms of when the current turn
  // began; set by the API layer (reduce() itself can't call Date.now() and
  // stay pure) whenever currentPlayerIndex changes. Used to authorize a
  // TIMEOUT_END_TURN action server-side, never trusting client-reported time.
  turnStartedAt: number | null;

  // epoch ms deadline for the current auction, same ownership rules as
  // turnStartedAt: set by the API layer to now + AUCTION_DURATION_MS
  // whenever a new auction starts or a new high bid lands (BID_PLACED
  // resets the clock), cleared when the auction ends. Authorizes
  // RESOLVE_AUCTION_TIMEOUT server-side once it's actually passed.
  auctionDeadline: number | null;
}
