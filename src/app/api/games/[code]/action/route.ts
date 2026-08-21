import { NextResponse } from "next/server";
import { GENESIS_HASH, hashChain, rollFor } from "@/game/dice";
import { reduce, type GameAction, type GameEvent } from "@/game/engine";
import { actionRequestSchema, type ClientAction } from "@/lib/api/client-action";
import {
  callRpc,
  drawNextCardId,
  gameRowToPublicJson,
  loadDeckState,
  loadGameByRoomCode,
  loadGameServerSeed,
  loadPlayerByClientToken,
  playerStateToUpdatePayload,
  type AuthedPlayer,
  type DeckState,
  type GameRow,
} from "@/lib/api/game-state";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";
import { supabaseAdmin } from "@/lib/supabase/server";

// Trade actions are inherently between two players and aren't turn-locked
// by design (see engine.ts); neither is DECLARE_BANKRUPT — a player can
// bail out even when it isn't their turn. Auction bids/passes are gated by
// pendingAuction.turnPlayerId instead of currentPlayerIndex (engine.ts
// enforces that itself); FORCE_END_TURN can be triggered by any player
// once the clock has actually run out, not just the stuck player.
const TURN_EXEMPT_ACTIONS = new Set([
  "PROPOSE_TRADE",
  "ACCEPT_TRADE",
  "DECLINE_TRADE",
  "DECLARE_BANKRUPT",
  "PLACE_BID",
  "PASS_AUCTION",
  "FORCE_END_TURN",
]);

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10_000;

interface ResolvedAction {
  action: GameAction;
  rollPayload: Record<string, unknown> | null;
  deckStatePayload: DeckState | null;
}

// Fills in everything the client isn't allowed to supply: dice (from
// rollFor, using the server-side seed), the drawn card id (popped off the
// server-held deck order), and playerId (always the authenticated caller).
async function resolveConcreteAction(
  game: GameRow,
  player: AuthedPlayer,
  action: ClientAction,
): Promise<ResolvedAction> {
  switch (action.type) {
    case "ROLL": {
      const serverSeed = await loadGameServerSeed(game.id);
      const { d1, d2 } = rollFor(serverSeed, game.id, game.state.rollIndex);

      const { data: lastRoll, error } = await supabaseAdmin
        .from("rolls")
        .select("hash")
        .eq("game_id", game.id)
        .order("roll_index", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new ApiError(500, "failed to read roll ledger");

      const prevHash = (lastRoll?.hash as string | undefined) ?? GENESIS_HASH;
      const hash = hashChain(prevHash, game.id, game.state.rollIndex, player.id, d1, d2);

      return {
        action: { type: "ROLL", playerId: player.id, d1, d2 },
        rollPayload: {
          roll_index: game.state.rollIndex,
          player_id: player.id,
          die_1: d1,
          die_2: d2,
          prev_hash: prevHash,
          hash,
        },
        deckStatePayload: null,
      };
    }

    case "DRAW_CARD": {
      if (game.state.turnPhase !== "awaiting_card" || !game.state.pendingCardDeck) {
        throw new ApiError(409, "not awaiting a card draw");
      }
      const deckState = await loadDeckState(game.id);
      if (!deckState) throw new ApiError(500, "deck state missing");
      const { cardId, newDeckState } = drawNextCardId(deckState, game.state.pendingCardDeck, game.state.settings.mapId);
      return {
        action: { type: "DRAW_CARD", playerId: player.id, cardId },
        rollPayload: null,
        deckStatePayload: newDeckState,
      };
    }

    case "PROPOSE_TRADE":
      return {
        action: {
          type: "PROPOSE_TRADE",
          fromPlayerId: player.id,
          toPlayerId: action.toPlayerId,
          give: action.give,
          receive: action.receive,
        },
        rollPayload: null,
        deckStatePayload: null,
      };

    case "ACCEPT_TRADE":
    case "DECLINE_TRADE":
      return {
        action: { type: action.type, playerId: player.id, tradeId: action.tradeId },
        rollPayload: null,
        deckStatePayload: null,
      };

    case "BUILD_HOUSE":
    case "SELL_HOUSE":
    case "MORTGAGE":
    case "UNMORTGAGE":
      return {
        action: { type: action.type, playerId: player.id, spaceIndex: action.spaceIndex },
        rollPayload: null,
        deckStatePayload: null,
      };

    case "CHOOSE_TAX":
      return {
        action: { type: "CHOOSE_TAX", playerId: player.id, option: action.option },
        rollPayload: null,
        deckStatePayload: null,
      };

    case "PLACE_BID":
      return {
        action: { type: "PLACE_BID", playerId: player.id, amount: action.amount },
        rollPayload: null,
        deckStatePayload: null,
      };

    case "FORCE_END_TURN": {
      const limitSeconds = game.state.settings.turnTimeLimitSeconds;
      if (limitSeconds <= 0) throw new ApiError(409, "no turn time limit is set");
      const startedAt = game.state.turnStartedAt;
      if (!startedAt || Date.now() - startedAt < limitSeconds * 1000) {
        throw new ApiError(409, "the current turn hasn't timed out yet");
      }
      const currentPlayerId = game.state.players[game.state.currentPlayerIndex]?.id;
      if (!currentPlayerId) throw new ApiError(409, "no current player");
      return {
        action: { type: "FORCE_END_TURN", playerId: currentPlayerId },
        rollPayload: null,
        deckStatePayload: null,
      };
    }

    case "BUY":
    case "DECLINE_BUY":
    case "PASS_AUCTION":
    case "PAY_RENT":
    case "PAY_JAIL_FINE":
    case "USE_JAIL_FREE":
    case "END_TURN":
    case "DECLARE_BANKRUPT":
      return {
        action: { type: action.type, playerId: player.id },
        rollPayload: null,
        deckStatePayload: null,
      };
  }
}

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const roomCode = parseRoomCode(code);
    const body = await parseJsonBody(request, actionRequestSchema);

    if (!checkRateLimit(body.clientToken, RATE_LIMIT, RATE_WINDOW_MS)) {
      throw new ApiError(429, "too many requests");
    }

    const game = await loadGameByRoomCode(roomCode);
    if (game.status !== "active") {
      throw new ApiError(409, "game is not active");
    }

    const player = await loadPlayerByClientToken(game.id, body.clientToken);

    const isCurrentPlayer = game.state.players[game.state.currentPlayerIndex]?.id === player.id;
    if (!TURN_EXEMPT_ACTIONS.has(body.action.type) && !isCurrentPlayer) {
      throw new ApiError(403, "it is not your turn");
    }

    const { action: concreteAction, rollPayload, deckStatePayload } = await resolveConcreteAction(
      game,
      player,
      body.action,
    );

    const { state: reducedState, events } = reduce(game.state, concreteAction);
    // (settings.turnTimeLimitSeconds) reduce() can't call Date.now() and
    // stay pure, so the turn clock is stamped here whenever the active
    // player actually changes.
    const newState =
      reducedState.currentPlayerIndex !== game.state.currentPlayerIndex
        ? { ...reducedState, turnStartedAt: Date.now() }
        : reducedState;

    if (events.length === 0) {
      // Well-formed request, but the engine rejected it (illegal move,
      // insufficient funds, wrong phase, ...) — not a client error, so 200
      // with an explicit ok:false rather than a 4xx.
      return NextResponse.json({ ok: false, reason: "action had no effect", ...gameRowToPublicJson(game) });
    }

    await callRpc("apply_game_action", {
      p_game_id: game.id,
      p_expected_roll_index: game.state.rollIndex,
      p_new_state: newState,
      p_new_status: newState.status,
      p_new_roll_index: newState.rollIndex,
      p_new_current_player_index: newState.currentPlayerIndex,
      p_new_turn_phase: newState.turnPhase,
      p_new_doubles_count: newState.doublesCount,
      p_player_updates: newState.players.map(playerStateToUpdatePayload),
      p_events: events.map((e: GameEvent) => ({ type: e.type, payload: e })),
      p_roll: rollPayload,
      p_deck_state: deckStatePayload,
    });

    const updated = await loadGameByRoomCode(roomCode);
    return NextResponse.json({ ok: true, ...gameRowToPublicJson(updated) });
  } catch (error) {
    return errorResponse(error);
  }
}
