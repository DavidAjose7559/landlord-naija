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
// This list will grow as the game engine is built out.
export type TurnPhase =
  | "awaiting_roll"
  | "awaiting_purchase"
  | "awaiting_card"
  | "in_jail"
  | "awaiting_payment"
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

// A card has been drawn and is awaiting resolution (e.g. a nearestTransport
// card needs the player to buy or pay rent on the space it moved them to).
export interface PendingCard {
  deck: Deck;
  cardId: string;
}

export interface GameState {
  status: GameStatus;
  turnPhase: TurnPhase;
  currentPlayerIndex: number;
  rollIndex: number;
  doublesCount: number;
  players: PlayerState[];
  ownership: Record<number, PropertyOwnership>;
  pendingCard: PendingCard | null;
  winnerPlayerId: string | null;
}
