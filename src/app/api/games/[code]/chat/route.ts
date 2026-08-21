import { NextResponse } from "next/server";
import { z } from "zod";
import { callRpc, loadGameByRoomCode, loadPlayerByClientToken } from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15_000;

const chatSchema = z
  .object({
    clientToken: z.string().min(1),
    body: z.string().trim().min(1).max(300),
  })
  .strict();

// Deliberately separate from the action route and GameAction entirely —
// chat never touches games.state, never goes through reduce(), and never
// writes an events row. It only ever inserts into `messages`. Available
// in any turnPhase, any game status (lobby included, so people can talk
// while waiting for stragglers) — there is no game-state gate here at
// all, on purpose.
export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const roomCode = parseRoomCode(code);
    const body = await parseJsonBody(request, chatSchema);

    // Namespaced (see the action route's identical comment) — the
    // in-memory rate limiter is one shared map keyed purely by string.
    if (!checkRateLimit(`chat:${body.clientToken}`, RATE_LIMIT, RATE_WINDOW_MS)) {
      throw new ApiError(429, "sending messages too fast — slow down a moment");
    }

    const game = await loadGameByRoomCode(roomCode);
    // Unlike bug reports, a bad/missing clientToken is a hard rejection
    // here, not a soft fallback — "spectators can read but not post" only
    // holds if posting genuinely requires a real seat.
    const player = await loadPlayerByClientToken(game.id, body.clientToken);

    await callRpc("post_message", {
      p_game_id: game.id,
      p_player_id: player.id,
      p_body: body.body,
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
