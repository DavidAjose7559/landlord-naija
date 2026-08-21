import { NextResponse } from "next/server";
import { z } from "zod";
import { rollFor } from "@/game/dice";
import type { GameState, PropertyOwnership, TurnPhase } from "@/game/types";
import {
  callRpc,
  gameRowToPublicJson,
  loadGameByRoomCode,
  loadGameServerSeed,
  playerStateToUpdatePayload,
} from "@/lib/api/game-state";
import { spaceIndexSchema } from "@/lib/api/client-action";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";

// Dev-only test harness: sets up a specific board state directly instead of
// grinding out real dice hoping to land on it. Never reachable in
// production — see the two checks at the top of POST, both of which fail
// closed to 404 (not 401/403) so the route doesn't even reveal that it
// exists to anyone probing without the secret.

const turnPhaseValues: [TurnPhase, ...TurnPhase[]] = [
  "awaiting_roll",
  "awaiting_purchase",
  "awaiting_auction",
  "awaiting_payment",
  "awaiting_card",
  "awaiting_end_turn",
  "game_over",
];

const playerPatchSchema = z
  .object({
    cashCents: z.number().int().nonnegative().optional(),
    position: spaceIndexSchema.optional(),
    inJail: z.boolean().optional(),
    jailTurns: z.number().int().min(0).max(3).optional(),
    jailFreeCards: z.number().int().nonnegative().optional(),
    bankrupt: z.boolean().optional(),
  })
  .strict();

const ownershipPatchSchema = z
  .object({
    ownerId: z.string().uuid(),
    houses: z.number().int().min(0).max(4).optional(),
    hotel: z.boolean().optional(),
    mortgaged: z.boolean().optional(),
  })
  .strict();

const seedStateSchema = z
  .object({
    devSecret: z.string().min(1),
    roomCode: z.string(),
    players: z.record(z.string().uuid(), playerPatchSchema).optional(),
    // Keyed by space index as a string (JSON object keys are always
    // strings) — a value of null unowns that space.
    ownership: z.record(z.string(), ownershipPatchSchema.nullable()).optional(),
    // Convenience: sets playerId's position so that their *next real ROLL*
    // (computed from the actual server seed, same as production) lands
    // exactly on spaceIndex. Nothing about the roll itself is faked — this
    // only pre-positions the player standing in front of it.
    landOn: z.object({ playerId: z.string().uuid(), spaceIndex: spaceIndexSchema }).optional(),
    currentPlayerIndex: z.number().int().nonnegative().optional(),
    turnPhase: z.enum(turnPhaseValues).optional(),
    // Required, not defaulted — a caller has to consciously decide to
    // touch a game people might currently be playing. Games in "lobby" or
    // "finished" don't need it; dev_seed_state itself enforces the same
    // rule server-side, so this isn't just an app-layer nicety.
    confirmActive: z.boolean(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    if (process.env.NODE_ENV === "production") throw new ApiError(404, "not found");
    const configuredSecret = process.env.DEV_HARNESS_SECRET;
    if (!configuredSecret) throw new ApiError(404, "not found");

    const body = await parseJsonBody(request, seedStateSchema);
    if (body.devSecret !== configuredSecret) throw new ApiError(404, "not found");

    const roomCode = parseRoomCode(body.roomCode);
    const game = await loadGameByRoomCode(roomCode);
    if (game.status === "active" && !body.confirmActive) {
      throw new ApiError(409, "refusing to seed an active game without confirmActive: true");
    }

    const players = game.state.players.map((p) => {
      const patch = body.players?.[p.id];
      if (!patch) return p;
      return {
        ...p,
        ...(patch.cashCents !== undefined && { cashCents: patch.cashCents }),
        ...(patch.position !== undefined && { position: patch.position }),
        ...(patch.inJail !== undefined && { inJail: patch.inJail }),
        ...(patch.jailTurns !== undefined && { jailTurns: patch.jailTurns }),
        ...(patch.jailFreeCards !== undefined && { jailFreeCards: patch.jailFreeCards }),
        ...(patch.bankrupt !== undefined && { bankrupt: patch.bankrupt }),
      };
    });

    if (body.landOn) {
      const target = players.find((p) => p.id === body.landOn!.playerId);
      if (!target) throw new ApiError(400, "landOn.playerId isn't a player in this game");
      const seed = await loadGameServerSeed(game.id);
      const { d1, d2 } = rollFor(seed, game.id, game.state.rollIndex);
      const total = d1 + d2;
      target.position = ((body.landOn.spaceIndex - total) % 40 + 40) % 40;
    }

    const ownership: Record<number, PropertyOwnership> = { ...game.state.ownership };
    if (body.ownership) {
      for (const [idxStr, patch] of Object.entries(body.ownership)) {
        const idx = Number(idxStr);
        if (!Number.isInteger(idx) || idx < 0 || idx > 39) {
          throw new ApiError(400, `invalid ownership space index "${idxStr}"`);
        }
        if (patch === null) {
          delete ownership[idx];
        } else {
          ownership[idx] = {
            ownerId: patch.ownerId,
            houses: patch.houses ?? 0,
            hotel: patch.hotel ?? false,
            mortgaged: patch.mortgaged ?? false,
          };
        }
      }
    }

    const newState: GameState = {
      ...game.state,
      players,
      ownership,
      currentPlayerIndex: body.currentPlayerIndex ?? game.state.currentPlayerIndex,
      turnPhase: body.turnPhase ?? (body.landOn ? "awaiting_roll" : game.state.turnPhase),
    };

    await callRpc("dev_seed_state", {
      p_game_id: game.id,
      p_new_state: newState,
      p_player_updates: players.map(playerStateToUpdatePayload),
      p_confirm_active: body.confirmActive,
    });

    const updated = await loadGameByRoomCode(roomCode);
    return NextResponse.json(gameRowToPublicJson(updated));
  } catch (error) {
    return errorResponse(error);
  }
}
