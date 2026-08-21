import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isMidDebtResolution, tradeOfferValid } from "@/game/engine";
import { tradeOfferSchema } from "@/lib/api/client-action";
import { callRpc, loadGameByRoomCode, loadPlayerByClientToken, loadTrade } from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";

const counterSchema = z
  .object({
    clientToken: z.string().min(1),
    offer: tradeOfferSchema,
    request: tradeOfferSchema,
  })
  .strict();

const MAX_TRADE_ROUNDS = 10;

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string; tradeId: string }> },
) {
  try {
    const { code, tradeId } = await context.params;
    const roomCode = parseRoomCode(code);
    const body = await parseJsonBody(request, counterSchema);

    const game = await loadGameByRoomCode(roomCode);
    if (game.status !== "active") throw new ApiError(409, "the game isn't active");
    if (!game.state.settings.tradingEnabled) throw new ApiError(409, "trading is disabled for this room");

    const player = await loadPlayerByClientToken(game.id, body.clientToken);
    const parent = await loadTrade(game.id, tradeId);
    if (parent.status !== "open") throw new ApiError(409, "that offer is no longer open");
    if (parent.fromPlayerId !== player.id && parent.toPlayerId !== player.id) {
      throw new ApiError(403, "only the two players in this negotiation can counter it");
    }

    const round = parent.round + 1;
    if (round > MAX_TRADE_ROUNDS) {
      throw new ApiError(409, "This negotiation has gone on long enough.");
    }

    // Countering swaps roles: the countering player becomes the new
    // from_player_id, proposing fresh terms from their own perspective.
    const toPlayerId = parent.fromPlayerId === player.id ? parent.toPlayerId : parent.fromPlayerId;

    if (isMidDebtResolution(game.state, player.id) || isMidDebtResolution(game.state, toPlayerId)) {
      throw new ApiError(409, "a trade can't involve a player who's mid-debt-resolution");
    }
    if (!tradeOfferValid(game.state, player.id, body.offer)) {
      throw new ApiError(400, "you can't offer that — check ownership, cash, and that nothing has houses on it");
    }
    if (!tradeOfferValid(game.state, toPlayerId, body.request)) {
      throw new ApiError(400, "you can't request that — check their ownership, cash, and that nothing has houses on it");
    }

    const newTradeId = randomUUID();
    await callRpc("counter_trade", {
      p_id: newTradeId,
      p_parent_trade_id: tradeId,
      p_game_id: game.id,
      p_from_player_id: player.id,
      p_to_player_id: toPlayerId,
      p_offer: body.offer,
      p_request: body.request,
      p_round: round,
    });

    return NextResponse.json({ tradeId: newTradeId, round }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
