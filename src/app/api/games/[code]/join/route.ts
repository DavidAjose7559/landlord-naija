import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_STARTING_CASH, MAX_PLAYERS } from "@/game/board";
import type { PlayerState } from "@/game/types";
import { callRpc, loadGameByRoomCode } from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";

const joinSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    token: z.enum(["danfo", "keke", "jollof", "gele", "okada", "agbada", "suya", "bottle"]),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const roomCode = parseRoomCode(code);
    const body = await parseJsonBody(request, joinSchema);

    const game = await loadGameByRoomCode(roomCode);
    if (game.status !== "lobby") {
      // The client is expected to treat this as "watch instead" and route
      // to the board as a spectator (no session), not surface it as a
      // hard failure — see the board page's spectating banner.
      throw new ApiError(409, "game has already started — you can watch from the board instead");
    }
    if (game.state.players.length >= MAX_PLAYERS) {
      throw new ApiError(409, "game is full");
    }
    if (game.state.players.some((p) => p.token === body.token)) {
      throw new ApiError(409, "that piece is already taken");
    }

    const playerId = randomUUID();
    // Same construction as the server seed: a real secret, not a UUID.
    const clientToken = randomBytes(32).toString("hex");
    const seatIndex = game.state.players.length;

    const newPlayer: PlayerState = {
      id: playerId,
      name: body.name,
      token: body.token,
      seatIndex,
      cashCents: DEFAULT_STARTING_CASH,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailFreeCards: 0,
      bankrupt: false,
    };

    const newState = { ...game.state, players: [...game.state.players, newPlayer] };

    await callRpc("join_game", {
      p_game_id: game.id,
      p_player_id: playerId,
      p_name: body.name,
      p_token: body.token,
      p_seat_index: seatIndex,
      p_cash_cents: DEFAULT_STARTING_CASH,
      p_client_token: clientToken,
      p_new_state: newState,
    });

    return NextResponse.json({ playerId, clientToken }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
