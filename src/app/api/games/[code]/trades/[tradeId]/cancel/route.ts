import { NextResponse } from "next/server";
import { z } from "zod";
import { callRpc, loadGameByRoomCode, loadPlayerByClientToken, loadTrade } from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";

const cancelSchema = z.object({ clientToken: z.string().min(1) }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string; tradeId: string }> },
) {
  try {
    const { code, tradeId } = await context.params;
    const roomCode = parseRoomCode(code);
    const body = await parseJsonBody(request, cancelSchema);

    const game = await loadGameByRoomCode(roomCode);
    const player = await loadPlayerByClientToken(game.id, body.clientToken);
    const trade = await loadTrade(game.id, tradeId);
    if (trade.status !== "open") throw new ApiError(409, "that offer is no longer open");
    // The current round's proposer withdraws their own open offer — after
    // a counter, that's whichever side's from_player_id this row has now.
    if (trade.fromPlayerId !== player.id) throw new ApiError(403, "only the current proposer can cancel this offer");

    await callRpc("respond_trade", { p_trade_id: tradeId, p_status: "cancelled" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
