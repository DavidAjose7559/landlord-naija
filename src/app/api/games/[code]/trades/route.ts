import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isMidDebtResolution, tradeOfferValid } from "@/game/engine";
import { callRpc, loadGameByRoomCode, loadPlayerByClientToken } from "@/lib/api/game-state";
import { tradeOfferSchema } from "@/lib/api/client-action";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";

const proposeSchema = z
  .object({
    clientToken: z.string().min(1),
    toPlayerId: z.string().uuid(),
    offer: tradeOfferSchema,
    request: tradeOfferSchema,
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const roomCode = parseRoomCode(code);
    const body = await parseJsonBody(request, proposeSchema);

    const game = await loadGameByRoomCode(roomCode);
    if (game.status !== "active") {
      throw new ApiError(409, "the game isn't active");
    }
    if (!game.state.settings.tradingEnabled) {
      throw new ApiError(409, "trading is disabled for this room");
    }

    const player = await loadPlayerByClientToken(game.id, body.clientToken);
    if (player.id === body.toPlayerId) {
      throw new ApiError(400, "can't trade with yourself");
    }
    if (!game.state.players.some((p) => p.id === body.toPlayerId && !p.bankrupt)) {
      throw new ApiError(404, "that player isn't in this game");
    }
    if (isMidDebtResolution(game.state, player.id) || isMidDebtResolution(game.state, body.toPlayerId)) {
      throw new ApiError(409, "a trade can't involve a player who's mid-debt-resolution");
    }
    if (!tradeOfferValid(game.state, player.id, body.offer)) {
      throw new ApiError(400, "you can't offer that — check ownership, cash, and that nothing has houses on it");
    }
    if (!tradeOfferValid(game.state, body.toPlayerId, body.request)) {
      throw new ApiError(400, "you can't request that — check their ownership, cash, and that nothing has houses on it");
    }

    const tradeId = randomUUID();
    await callRpc("propose_trade", {
      p_id: tradeId,
      p_game_id: game.id,
      p_from_player_id: player.id,
      p_to_player_id: body.toPlayerId,
      p_offer: body.offer,
      p_request: body.request,
    });

    return NextResponse.json({ tradeId }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
