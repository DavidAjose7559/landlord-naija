import "server-only";

import type { Deck } from "@/game/board";
import { DECKS, shuffleDeck } from "@/game/cards";
import type { GameState, GameStatus, PlayerState, TurnPhase } from "@/game/types";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { PublicGame } from "./public-game";
import { ApiError } from "./errors";
import { secureRandom } from "./rng";

export interface GameRow {
  id: string;
  roomCode: string;
  status: GameStatus;
  serverSeedHash: string;
  serverSeed: string | null; // only non-null once status === "finished"
  rollIndex: number;
  currentPlayerIndex: number;
  turnPhase: TurnPhase;
  doublesCount: number;
  state: GameState;
  createdAt: string;
  updatedAt: string;
}

interface GamesPublicRow {
  id: string;
  room_code: string;
  status: GameStatus;
  server_seed_hash: string;
  server_seed: string | null;
  roll_index: number;
  current_player_index: number;
  turn_phase: TurnPhase;
  doubles_count: number;
  state: GameState;
  created_at: string;
  updated_at: string;
}

function mapGameRow(row: GamesPublicRow): GameRow {
  return {
    id: row.id,
    roomCode: row.room_code,
    status: row.status,
    serverSeedHash: row.server_seed_hash,
    serverSeed: row.server_seed,
    rollIndex: row.roll_index,
    currentPlayerIndex: row.current_player_index,
    turnPhase: row.turn_phase,
    doublesCount: row.doubles_count,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Reads through games_public everywhere, including server-side: it already
// has exactly what every route needs (server_seed masked until finished),
// so there's no separate "internal" query shape to keep in sync.
export async function loadGameByRoomCode(roomCode: string): Promise<GameRow> {
  const { data, error } = await supabaseAdmin
    .from("games_public")
    .select("*")
    .eq("room_code", roomCode)
    .maybeSingle();

  if (error) throw new ApiError(500, "failed to load game");
  if (!data) throw new ApiError(404, "game not found");
  return mapGameRow(data as GamesPublicRow);
}

export function gameRowToPublicJson(row: GameRow): PublicGame {
  return {
    id: row.id,
    roomCode: row.roomCode,
    status: row.status,
    serverSeedHash: row.serverSeedHash,
    serverSeed: row.serverSeed,
    rollIndex: row.rollIndex,
    currentPlayerIndex: row.currentPlayerIndex,
    turnPhase: row.turnPhase,
    doublesCount: row.doublesCount,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function loadGameServerSeed(gameId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("game_secrets")
    .select("server_seed")
    .eq("game_id", gameId)
    .maybeSingle();

  if (error || !data?.server_seed) throw new ApiError(500, "failed to load game secrets");
  return data.server_seed as string;
}

export interface DeckState {
  owambe: string[];
  village: string[];
}

export async function loadDeckState(gameId: string): Promise<DeckState | null> {
  const { data, error } = await supabaseAdmin
    .from("game_secrets")
    .select("deck_state")
    .eq("game_id", gameId)
    .maybeSingle();

  if (error) throw new ApiError(500, "failed to load deck state");
  return (data?.deck_state as DeckState | null) ?? null;
}

export function shuffleFreshDecks(): DeckState {
  return {
    owambe: shuffleDeck(
      DECKS.owambe.map((c) => c.id),
      secureRandom,
    ),
    village: shuffleDeck(
      DECKS.village.map((c) => c.id),
      secureRandom,
    ),
  };
}

// Pops the next card id off the given deck, reshuffling a fresh full deck
// if it's been exhausted. Card selection must come from here (server-side,
// deterministic-from-here-forward only in the sense that it's fixed the
// instant it's popped) — never from the client, exactly like dice.
export function drawNextCardId(
  deckState: DeckState,
  deck: Deck,
): { cardId: string; newDeckState: DeckState } {
  let order = deckState[deck];
  if (order.length === 0) {
    order = shuffleDeck(
      DECKS[deck].map((c) => c.id),
      secureRandom,
    );
  }
  const [cardId, ...remaining] = order;
  return { cardId, newDeckState: { ...deckState, [deck]: remaining } };
}

export interface AuthedPlayer {
  id: string;
  gameId: string;
  seatIndex: number;
}

export async function loadPlayerByClientToken(gameId: string, clientToken: string): Promise<AuthedPlayer> {
  const { data: secret, error: secretError } = await supabaseAdmin
    .from("player_secrets")
    .select("player_id")
    .eq("client_token", clientToken)
    .maybeSingle();

  if (secretError) throw new ApiError(500, "failed to verify client token");
  if (!secret) throw new ApiError(401, "invalid client token");

  const { data: player, error: playerError } = await supabaseAdmin
    .from("players")
    .select("id, game_id, seat_index")
    .eq("id", secret.player_id as string)
    .eq("game_id", gameId)
    .maybeSingle();

  if (playerError) throw new ApiError(500, "failed to load player");
  if (!player) throw new ApiError(401, "client token does not belong to this game");

  return { id: player.id, gameId: player.game_id, seatIndex: player.seat_index };
}

export function playerStateToUpdatePayload(p: PlayerState) {
  return {
    id: p.id,
    cash_cents: p.cashCents,
    position: p.position,
    in_jail: p.inJail,
    jail_turns: p.jailTurns,
    jail_free_cards: p.jailFreeCards,
    bankrupt: p.bankrupt,
  };
}

export async function callRpc(fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.rpc(fn, args);
  if (error) {
    if (error.code === "23505") {
      throw new ApiError(409, "conflict");
    }
    throw new ApiError(500, error.message || `${fn} failed`);
  }
}
