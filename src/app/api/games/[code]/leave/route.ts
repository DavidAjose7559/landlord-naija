import { NextResponse } from "next/server";
import { z } from "zod";
import { callRpc, loadGameByRoomCode, loadPlayerByClientToken } from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";

const leaveSchema = z.object({ clientToken: z.string().min(1) }).strict();

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const roomCode = parseRoomCode(code);
    const body = await parseJsonBody(request, leaveSchema);

    const game = await loadGameByRoomCode(roomCode);
    if (game.status !== "lobby") {
      throw new ApiError(409, "can't leave — the game has already started");
    }

    const player = await loadPlayerByClientToken(game.id, body.clientToken);

    const remainingPlayers = game.state.players.filter((p) => p.id !== player.id);

    // If the host left, promote whoever has the lowest seatIndex among the
    // players still here.
    const hostPlayerId =
      game.state.hostPlayerId === player.id
        ? (remainingPlayers.length > 0
            ? remainingPlayers.reduce((lowest, p) => (p.seatIndex < lowest.seatIndex ? p : lowest)).id
            : null)
        : game.state.hostPlayerId;

    const newState = { ...game.state, players: remainingPlayers, hostPlayerId };

    await callRpc("leave_lobby", { p_game_id: game.id, p_player_id: player.id, p_new_state: newState });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
