import { NextResponse } from "next/server";
import { z } from "zod";
import { reduce } from "@/game/engine";
import {
  callRpc,
  gameRowToPublicJson,
  loadGameByRoomCode,
  loadPlayerByClientToken,
  shuffleFreshDecks,
} from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";

const startSchema = z.object({ clientToken: z.string().min(1) }).strict();

function shufflePlayers<T>(players: readonly T[]): T[] {
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const roomCode = parseRoomCode(code);
    const body = await parseJsonBody(request, startSchema);

    const game = await loadGameByRoomCode(roomCode);
    if (game.status !== "lobby") {
      throw new ApiError(409, "game has already started");
    }

    const player = await loadPlayerByClientToken(game.id, body.clientToken);
    if (player.id !== game.state.hostPlayerId) {
      throw new ApiError(403, "only the host can start the game");
    }
    if (game.state.players.length < 2) {
      throw new ApiError(409, "need at least 2 players to start");
    }

    // (settings.randomizePlayerOrder) Shuffling player turn order — and
    // reassigning seatIndex to match — happens here, outside the pure
    // engine, same as card-deck shuffling.
    const orderedPlayers = game.state.settings.randomizePlayerOrder
      ? shufflePlayers(game.state.players)
      : game.state.players;
    const startState = {
      ...game.state,
      players: orderedPlayers.map((p, seatIndex) => ({ ...p, seatIndex })),
    };

    const { state: reducedState } = reduce(startState, { type: "START_GAME" });
    const newState = { ...reducedState, turnStartedAt: Date.now() };
    const decks = shuffleFreshDecks(game.state.settings.mapId);

    await callRpc("start_game", {
      p_game_id: game.id,
      p_new_state: newState,
      p_treasure_deck: decks.treasure,
      p_surprise_deck: decks.surprise,
    });

    const updated = await loadGameByRoomCode(roomCode);
    return NextResponse.json(gameRowToPublicJson(updated));
  } catch (error) {
    return errorResponse(error);
  }
}
