import { NextResponse } from "next/server";
import { GENESIS_HASH, hashChain, rollFor } from "@/game/dice";
import { AUCTION_DURATION_MS, reduce, type GameAction, type GameEvent } from "@/game/engine";
import { actionRequestSchema, type ClientAction } from "@/lib/api/client-action";
import {
  callRpc,
  cancelOpenTradesInvolvingPlayer,
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

// DECLARE_BANKRUPT is exempt — a player can bail out even when it isn't
// their turn. PLACE_BID is exempt because an auction (Section 3) is
// simultaneous, not turn-by-turn — engine.ts gates it by
// pendingAuction.eligiblePlayerIds instead of currentPlayerIndex.
// RESOLVE_AUCTION_TIMEOUT and FORCE_END_TURN can be triggered by any
// player once the clock has actually run out server-side, not just the
// stuck one. Trade proposing/countering/accepting/declining doesn't go
// through this route at all anymore — see src/app/api/games/[code]/trades/**.
const TURN_EXEMPT_ACTIONS = new Set(["DECLARE_BANKRUPT", "PLACE_BID", "RESOLVE_AUCTION_TIMEOUT", "FORCE_END_TURN"]);

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10_000;

// (Section 3 turn watchdog) "3 minutes if none set" — the hard backstop
// against a stuck turn when the host never configured turnTimeLimitSeconds.
const WATCHDOG_FALLBACK_SECONDS = 180;

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

    case "BUILD_HOUSE":
    case "SELL_HOUSE":
    case "MORTGAGE":
    case "UNMORTGAGE":
      return {
        action: { type: action.type, playerId: player.id, spaceIndex: action.spaceIndex },
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
      // (Section 3 turn watchdog) settings.turnTimeLimitSeconds is a
      // player-facing, host-configured convenience (skip a slow roller);
      // WATCHDOG_FALLBACK_SECONDS is the hard "the game must never
      // deadlock" backstop that applies even when the host left the limit
      // off — the host's setting only ever shortens the wait, never
      // removes the guarantee.
      const limitSeconds =
        game.state.settings.turnTimeLimitSeconds > 0
          ? game.state.settings.turnTimeLimitSeconds
          : WATCHDOG_FALLBACK_SECONDS;
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

    case "RESOLVE_AUCTION_TIMEOUT": {
      if (!game.state.pendingAuction) throw new ApiError(409, "no auction is open");
      const deadline = game.state.auctionDeadline;
      if (!deadline || Date.now() < deadline) {
        throw new ApiError(409, "the auction hasn't timed out yet");
      }
      return { action: { type: "RESOLVE_AUCTION_TIMEOUT" }, rollPayload: null, deckStatePayload: null };
    }

    case "BUY":
    case "DECLINE_BUY":
    case "START_AUCTION":
    case "PAY_RENT":
    case "RAISE_DEBT_HELP":
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

    // Namespaced — checkRateLimit's in-memory store is a single shared map
    // keyed purely by whatever string is passed, so an unprefixed
    // clientToken here would share a bucket with any other route rate
    // limiting the same player (chat, bug reports), letting a burst of
    // game actions incorrectly throttle those too.
    if (!checkRateLimit(`action:${body.clientToken}`, RATE_LIMIT, RATE_WINDOW_MS)) {
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
    let newState =
      reducedState.currentPlayerIndex !== game.state.currentPlayerIndex
        ? { ...reducedState, turnStartedAt: Date.now() }
        : reducedState;

    // (Section 3) Same reasoning for the auction clock: a fresh auction or
    // a new high bid resets it to now + AUCTION_DURATION_MS; the auction
    // ending clears it. Checked by event type, not by diffing pendingAuction,
    // so it can't be fooled by a bid that happens to leave the object shape
    // superficially similar.
    if (events.some((e) => e.type === "AUCTION_STARTED" || e.type === "BID_PLACED")) {
      newState = { ...newState, auctionDeadline: Date.now() + AUCTION_DURATION_MS };
    } else if (events.some((e) => e.type === "AUCTION_WON" || e.type === "AUCTION_ENDED_NO_WINNER")) {
      newState = { ...newState, auctionDeadline: null };
    }

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

    // (Section 3) "Immediately removed from all pending flows" — auctions
    // and debt resolution are handled inside reduce() itself (see
    // resolveBankruptcy in engine.ts); trades live outside the pure engine
    // entirely, so this is the one place left to close that gap.
    for (const event of events) {
      if (event.type === "PLAYER_BANKRUPT") {
        await cancelOpenTradesInvolvingPlayer(game.id, event.playerId);
      }
    }

    const updated = await loadGameByRoomCode(roomCode);
    return NextResponse.json({ ok: true, ...gameRowToPublicJson(updated) });
  } catch (error) {
    return errorResponse(error);
  }
}
