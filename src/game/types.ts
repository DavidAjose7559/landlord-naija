import type { Deck } from "./board";

// Mirrors the `games.state` jsonb column: the full, realtime-synced game
// state snapshot. Denormalized copies of some fields (roll_index,
// current_player_index, turn_phase, doubles_count) also live as real
// columns on `games` for querying/indexing — this is the shape sent to
// clients as one blob.

export type GameStatus = "lobby" | "active" | "finished";

export type PlayerToken =
  | "danfo"
  | "keke"
  | "jollof"
  | "gele"
  | "okada"
  | "agbada"
  | "suya"
  | "bottle";

// The default is "awaiting_roll" (matches the games.turn_phase DB default).
export type TurnPhase =
  | "awaiting_roll" // must ROLL (or PAY_JAIL_FINE/USE_JAIL_FREE if in jail)
  | "awaiting_purchase" // landed on an unowned space; BUY or DECLINE_BUY
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
  seatIndex: number;
  cashCents: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  jailFreeCards: number;
  bankrupt: boolean;
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
  reason: "rent" | "tax" | "card";
}

export interface TradeOffer {
  cashCents: number;
  spaceIndexes: number[];
  jailFreeCards: number;
}

export interface TradeProposal {
  id: number;
  fromPlayerId: string;
  toPlayerId: string;
  give: TradeOffer; // what fromPlayerId offers
  receive: TradeOffer; // what fromPlayerId wants from toPlayerId
}

export interface GameState {
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

  trades: TradeProposal[];
  nextTradeId: number;
}
