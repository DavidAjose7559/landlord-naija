import { NextResponse } from "next/server";
import { z } from "zod";
import { reduce } from "@/game/engine";
import { callRpc, gameRowToPublicJson, loadGameByRoomCode, loadPlayerByClientToken } from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";

// Lobby-only, host-only. Mirrors createGameSchema's settings shape, but
// every field stays optional here too — this is a patch, not a replace.
const settingsSchema = z.object({
  mapId: z.enum(["naija", "worldTour", "canada", "classic", "original"]),
  maxPlayers: z.number().int().min(2).max(8),
  privateRoom: z.boolean(),
  startingCashCents: z.number().int().positive(),
  randomizePlayerOrder: z.boolean(),
  doubleRentOnFullSet: z.boolean(),
  freeParkingCash: z.boolean(),
  freeParkingSkipsTurn: z.boolean(),
  auctionOnDecline: z.boolean(),
  collectRentWhileJailed: z.boolean(),
  mortgageEnabled: z.boolean(),
  evenBuild: z.boolean(),
  allowManualBankruptcy: z.boolean(),
  bankruptcyTransfersAssets: z.boolean(),
  tradingEnabled: z.boolean(),
  turnTimeLimitSeconds: z.number().int().min(0),
});

const updateSettingsSchema = z
  .object({
    clientToken: z.string().min(1),
    settings: settingsSchema.partial(),
  })
  .strict();

export async function PATCH(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const roomCode = parseRoomCode(code);
    const body = await parseJsonBody(request, updateSettingsSchema);

    const game = await loadGameByRoomCode(roomCode);
    if (game.status !== "lobby") {
      throw new ApiError(409, "settings are frozen once the game has started");
    }

    const player = await loadPlayerByClientToken(game.id, body.clientToken);

    const { state: newState, events } = reduce(game.state, {
      type: "UPDATE_SETTINGS",
      playerId: player.id,
      settings: body.settings,
    });

    if (events.length === 0) {
      throw new ApiError(403, "only the host can change settings, and maxPlayers can't drop below the current seat count");
    }

    await callRpc("update_settings", { p_game_id: game.id, p_new_state: newState });

    const updated = await loadGameByRoomCode(roomCode);
    return NextResponse.json(gameRowToPublicJson(updated));
  } catch (error) {
    return errorResponse(error);
  }
}
