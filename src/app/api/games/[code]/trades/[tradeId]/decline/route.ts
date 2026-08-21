import { NextResponse } from "next/server";
import { z } from "zod";
import { callRpc, loadGameByRoomCode, loadPlayerByClientToken, loadTrade } from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";

const declineSchema = z.object({ clientToken: z.string().min(1) }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string; tradeId: string }> },
) {
  try {
    const { code, tradeId } = await context.params;
    const roomCode = parseRoomCode(code);
    const body = await parseJsonBody(request, declineSchema);

    const game = await loadGameByRoomCode(roomCode);
    const player = await loadPlayerByClientToken(game.id, body.clientToken);
    const trade = await loadTrade(game.id, tradeId);
    if (trade.status !== "open") throw new ApiError(409, "that offer is no longer open");
    if (trade.toPlayerId !== player.id) throw new ApiError(403, "only the trade's recipient can decline it");

    await callRpc("respond_trade", { p_trade_id: tradeId, p_status: "declined" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
