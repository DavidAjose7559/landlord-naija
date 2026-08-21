import { NextResponse } from "next/server";
import { GENESIS_HASH, hashChain, verifyGame } from "@/game/dice";
import { gameRowToPublicJson, loadGameByRoomCode } from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { parseRoomCode } from "@/lib/api/validate";
import { supabaseAdmin } from "@/lib/supabase/server";

interface RollRow {
  roll_index: number;
  player_id: string;
  die_1: number;
  die_2: number;
  prev_hash: string;
  hash: string;
}

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const roomCode = parseRoomCode(code);
    const game = await loadGameByRoomCode(roomCode);

    if (game.status !== "finished") {
      throw new ApiError(409, "game is not finished yet");
    }
    if (!game.serverSeed) {
      throw new ApiError(500, "seed was not revealed for a finished game");
    }

    const { data, error } = await supabaseAdmin
      .from("rolls")
      .select("roll_index, player_id, die_1, die_2, prev_hash, hash")
      .eq("game_id", game.id)
      .order("roll_index", { ascending: true });

    if (error) throw new ApiError(500, "failed to load roll ledger");
    const ledger = (data ?? []) as RollRow[];

    // Two independent checks: did every die come from the revealed seed
    // (fairness), and is the hash chain itself internally consistent
    // (the ledger hasn't been tampered with or reordered)?
    const dice = verifyGame(
      game.serverSeed,
      game.id,
      ledger.map((r) => ({ rollIndex: r.roll_index, d1: r.die_1, d2: r.die_2 })),
    );

    let chainOk = true;
    let expectedPrevHash = GENESIS_HASH;
    const chainMismatches: number[] = [];
    for (const roll of ledger) {
      const expectedHash = hashChain(
        expectedPrevHash,
        game.id,
        roll.roll_index,
        roll.player_id,
        roll.die_1,
        roll.die_2,
      );
      if (roll.prev_hash !== expectedPrevHash || roll.hash !== expectedHash) {
        chainOk = false;
        chainMismatches.push(roll.roll_index);
      }
      expectedPrevHash = roll.hash;
    }

    return NextResponse.json({
      ...gameRowToPublicJson(game),
      rolls: ledger.map((r) => ({
        rollIndex: r.roll_index,
        playerId: r.player_id,
        d1: r.die_1,
        d2: r.die_2,
        prevHash: r.prev_hash,
        hash: r.hash,
      })),
      verification: {
        diceOk: dice.ok,
        diceMismatches: dice.mismatches,
        chainOk,
        chainMismatches,
        ok: dice.ok && chainOk,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
