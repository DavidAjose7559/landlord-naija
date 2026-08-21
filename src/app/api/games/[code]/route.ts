import { NextResponse } from "next/server";
import { gameRowToPublicJson, loadGameByRoomCode } from "@/lib/api/game-state";
import { errorResponse } from "@/lib/api/errors";
import { parseRoomCode } from "@/lib/api/validate";

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const roomCode = parseRoomCode(code);
    const game = await loadGameByRoomCode(roomCode);
    return NextResponse.json(gameRowToPublicJson(game));
  } catch (error) {
    return errorResponse(error);
  }
}
