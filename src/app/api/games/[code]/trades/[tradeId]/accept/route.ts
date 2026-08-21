import { NextResponse } from "next/server";
import { z } from "zod";
import { reduce } from "@/game/engine";
import {
  callRpc,
  gameRowToPublicJson,
  loadGameByRoomCode,
  loadPlayerByClientToken,
  loadTrade,
  playerStateToUpdatePayload,
} from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";

const acceptSchema = z.object({ clientToken: z.string().min(1) }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string; tradeId: string }> },
) {
  try {
    const { code, tradeId } = await context.params;
    const roomCode = parseRoomCode(code);
    const body = await parseJsonBody(request, acceptSchema);

    const game = await loadGameByRoomCode(roomCode);
    if (game.status !== "active") throw new ApiError(409, "the game isn't active");

    const player = await loadPlayerByClientToken(game.id, body.clientToken);
    const trade = await loadTrade(game.id, tradeId);
    if (trade.status !== "open") throw new ApiError(409, "that offer is no longer open");
    if (trade.toPlayerId !== player.id) throw new ApiError(403, "only the trade's recipient can accept it");

    const { state: newState, events } = reduce(game.state, {
      type: "EXECUTE_ACCEPTED_TRADE",
      playerId: player.id,
      fromPlayerId: trade.fromPlayerId,
      toPlayerId: trade.toPlayerId,
      give: trade.offer,
      receive: trade.request,
    });

    if (events.length === 0) {
      return NextResponse.json({
        ok: false,
        reason: "The board has changed since this offer was made.",
        ...gameRowToPublicJson(game),
      });
    }

    await callRpc("apply_game_action", {
      p_game_id: game.id,
      p_expected_roll_index: game.state.rollIndex,
      p_new_state: newState,
      p_new_status: newState.status,
      p_new_roll_index: newState.rollIndex,
      p_new_current_player_index: newState.currentPlayerIndex,
      p_new_turn_phase: newState.turnPhase,
      p_new_doubles_count: newState.doublesCount,
      p_player_updates: newState.players.map(playerStateToUpdatePayload),
      p_events: events.map((e) => ({ type: e.type, payload: e })),
      p_accepted_trade_id: tradeId,
    });

    const updated = await loadGameByRoomCode(roomCode);
    return NextResponse.json({ ok: true, ...gameRowToPublicJson(updated) });
  } catch (error) {
    return errorResponse(error);
  }
}
