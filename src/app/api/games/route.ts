import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSeed } from "@/game/dice";
import { createInitialGameState } from "@/game/engine";
import { DEFAULT_SETTINGS } from "@/game/types";
import { callRpc } from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { generateRoomCode } from "@/lib/api/room-code";
import { parseJsonBody } from "@/lib/api/validate";

// Every field optional — the host can configure the room from the lobby
// (see UPDATE_SETTINGS) instead, this just saves a round trip when they
// already know what they want at creation time.
const createGameSchema = z
  .object({
    settings: z
      .object({
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
      })
      .partial()
      .optional(),
  })
  .strict();

const MAX_ROOM_CODE_ATTEMPTS = 5;

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request, createGameSchema);

    const { seed, hash } = createServerSeed();
    const settings = { ...DEFAULT_SETTINGS, ...body.settings };
    const state = createInitialGameState(settings);
    const gameId = randomUUID();

    let roomCode = generateRoomCode();
    for (let attempt = 1; ; attempt++) {
      try {
        await callRpc("create_game", {
          p_id: gameId,
          p_room_code: roomCode,
          p_server_seed_hash: hash,
          p_state: state,
          p_server_seed: seed,
        });
        break;
      } catch (error) {
        const isRoomCodeCollision = error instanceof ApiError && error.status === 409;
        if (isRoomCodeCollision && attempt < MAX_ROOM_CODE_ATTEMPTS) {
          roomCode = generateRoomCode();
          continue;
        }
        throw error;
      }
    }

    // The seed itself is never returned — only its hash, published so
    // every player can verify fairness once it's revealed at game end.
    return NextResponse.json({ roomCode, serverSeedHash: hash }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
