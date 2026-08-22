import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { PlayerState } from "@/game/types";
import { callRpc, loadGameByRoomCode } from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";
import { autoAssignColor, PLAYER_COLORS } from "@/lib/player-colors";

const joinSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    token: z.enum([
      "danfo",
      "keke",
      "jollof",
      "gele",
      "okada",
      "agbada",
      "suya",
      "bottle",
      "tophat",
      "racecar",
      "dog",
      "boot",
      "ship",
      "thimble",
      "wheelbarrow",
      "iron",
    ]),
    // Optional — a player who doesn't pick one (or joins via an older
    // client) gets the most distinct remaining colour auto-assigned below.
    color: z.enum(PLAYER_COLORS).optional(),
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
    if (game.state.players.length >= game.state.settings.maxPlayers) {
      throw new ApiError(409, "game is full");
    }
    if (game.state.players.some((p) => p.token === body.token)) {
      throw new ApiError(409, "that piece is already taken");
    }
    const takenColors = game.state.players.map((p) => p.color);
    if (body.color && takenColors.includes(body.color)) {
      throw new ApiError(409, "that colour is already taken");
    }
    const color = body.color ?? autoAssignColor(takenColors);

    const playerId = randomUUID();
    // Same construction as the server seed: a real secret, not a UUID.
    const clientToken = randomBytes(32).toString("hex");
    const seatIndex = game.state.players.length;
    const startingCashCents = game.state.settings.startingCashCents;

    const newPlayer: PlayerState = {
      id: playerId,
      name: body.name,
      token: body.token,
      color,
      seatIndex,
      cashCents: startingCashCents,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailFreeCards: 0,
      bankrupt: false,
      skipNextTurn: false,
    };

    // The first player to join becomes host (see UPDATE_SETTINGS /
    // LEAVE_LOBBY promotion — a game has no players yet when it's created,
    // so this is the earliest point a host can meaningfully exist).
    const newState = {
      ...game.state,
      players: [...game.state.players, newPlayer],
      hostPlayerId: game.state.hostPlayerId ?? playerId,
    };

    await callRpc("join_game", {
      p_game_id: game.id,
      p_player_id: playerId,
      p_name: body.name,
      p_token: body.token,
      p_seat_index: seatIndex,
      p_cash_cents: startingCashCents,
      p_client_token: clientToken,
      p_new_state: newState,
    });

    return NextResponse.json({ playerId, clientToken }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
