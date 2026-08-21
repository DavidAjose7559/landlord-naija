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

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const roomCode = parseRoomCode(code);
    const body = await parseJsonBody(request, startSchema);

    const game = await loadGameByRoomCode(roomCode);
    if (game.status !== "lobby") {
      throw new ApiError(409, "game has already started");
    }

    // The host is whoever joined first (seat 0) — there's no separate
    // host concept at creation time, since a game has no players yet
    // when it's created.
    const player = await loadPlayerByClientToken(game.id, body.clientToken);
    if (player.seatIndex !== 0) {
      throw new ApiError(403, "only the host (first player) can start the game");
    }
    if (game.state.players.length < 2) {
      throw new ApiError(409, "need at least 2 players to start");
    }

    const { state: newState } = reduce(game.state, { type: "START_GAME" });
    const decks = shuffleFreshDecks(game.state.mapId);

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
