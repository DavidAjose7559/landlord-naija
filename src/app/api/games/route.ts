import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSeed } from "@/game/dice";
import { createInitialGameState } from "@/game/engine";
import { callRpc } from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { generateRoomCode } from "@/lib/api/room-code";
import { parseJsonBody } from "@/lib/api/validate";

const createGameSchema = z.object({}).strict();

const MAX_ROOM_CODE_ATTEMPTS = 5;

export async function POST(request: Request) {
  try {
    await parseJsonBody(request, createGameSchema);

    const { seed, hash } = createServerSeed();
    // Defaults to the naija map for now; game settings (including map
    // choice, configured in the lobby before start) layer on top of this.
    const state = createInitialGameState("naija");
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
