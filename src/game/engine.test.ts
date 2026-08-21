import { describe, expect, it } from "vitest";
import { BOARD } from "./board";
import { DECKS } from "./cards";
import { rollFor } from "./dice";
import { netWorth, reduce, type GameAction } from "./engine";
import type { GameState, PlayerState, PlayerToken } from "./types";

const STARTING_CASH = 150_000; // $1,500

function makePlayer(id: string, seatIndex: number, overrides: Partial<PlayerState> = {}): PlayerState {
  const tokens: PlayerToken[] = ["danfo", "keke", "jollof", "gele"];
  return {
    id,
    name: id,
    token: tokens[seatIndex % tokens.length],
    seatIndex,
    cashCents: STARTING_CASH,
    position: 0,
    inJail: false,
    jailTurns: 0,
    jailFreeCards: 0,
    bankrupt: false,
    ...overrides,
  };
}

function makeState(players: PlayerState[], overrides: Partial<GameState> = {}): GameState {
  return {
    status: "active",
    turnPhase: "awaiting_roll",
    currentPlayerIndex: 0,
    rollIndex: 0,
    doublesCount: 0,
    players,
    ownership: {},
    winnerPlayerId: null,
    lastRoll: null,
    pendingCardDeck: null,
    pendingDebt: null,
    trades: [],
    nextTradeId: 1,
    ...overrides,
  };
}

describe("passing GO", () => {
  it("pays exactly once on a card-driven move (moveTo with passGoPays)", () => {
    const state = makeState([makePlayer("p1", 0, { position: 20, cashCents: 10_000 }), makePlayer("p2", 1)], {
      turnPhase: "awaiting_card",
      pendingCardDeck: "owambe",
    });

    const card = DECKS.owambe.find((c) => c.id === "owambe-12")!; // "Head straight to GO." moveTo 0, passGoPays true
    expect(card.effect).toEqual({ type: "moveTo", to: 0, passGoPays: true });

    const { state: next, events } = reduce(state, { type: "DRAW_CARD", playerId: "p1", cardId: card.id });

    expect(next.players[0].position).toBe(0);
    expect(next.players[0].cashCents).toBe(10_000 + 20_000); // GO_SALARY paid exactly once
    expect(events.filter((e) => e.type === "PASSED_GO")).toHaveLength(1);
  });

  it("pays exactly once on a normal dice move that wraps past GO", () => {
    const state = makeState([makePlayer("p1", 0, { position: 38, cashCents: 10_000 }), makePlayer("p2", 1)]);
    const { state: next, events } = reduce(state, { type: "ROLL", playerId: "p1", d1: 2, d2: 3 }); // 38 -> 43 -> 3

    expect(next.players[0].position).toBe(3);
    expect(next.players[0].cashCents).toBe(10_000 + 20_000);
    expect(events.filter((e) => e.type === "PASSED_GO")).toHaveLength(1);
  });
});

describe("jail", () => {
  it("three doubles in one turn sends the player to jail and forfeits the move", () => {
    const state = makeState([makePlayer("p1", 0, { position: 5, cashCents: 10_000 }), makePlayer("p2", 1)], {
      doublesCount: 2,
    });

    // Space 5 + 8 = 13 (Ogba, unowned, would normally trigger awaiting_purchase).
    // The 3rd double must forfeit that entirely and jump straight to jail.
    const { state: next, events } = reduce(state, { type: "ROLL", playerId: "p1", d1: 4, d2: 4 });

    expect(next.players[0].position).toBe(10);
    expect(next.players[0].inJail).toBe(true);
    expect(next.players[0].cashCents).toBe(10_000); // no landing resolution, no purchase offer
    expect(next.doublesCount).toBe(0);
    expect(next.ownership[13]).toBeUndefined();
    expect(events.some((e) => e.type === "SENT_TO_JAIL")).toBe(true);
    expect(events.some((e) => e.type === "MOVED")).toBe(false);
  });

  it("escaping jail via doubles does not move the player", () => {
    const state = makeState([makePlayer("p1", 0, { position: 10, inJail: true, jailTurns: 1 }), makePlayer("p2", 1)]);
    const { state: next } = reduce(state, { type: "ROLL", playerId: "p1", d1: 3, d2: 3 });

    expect(next.players[0].inJail).toBe(false);
    expect(next.players[0].position).toBe(10); // still on Kirikiri, did not move around the board
  });

  it("forces payment and a move on the 3rd failed jail turn", () => {
    const state = makeState(
      [makePlayer("p1", 0, { position: 10, inJail: true, jailTurns: 2, cashCents: 10_000 }), makePlayer("p2", 1)],
    );
    const { state: next } = reduce(state, { type: "ROLL", playerId: "p1", d1: 2, d2: 5 }); // non-double

    expect(next.players[0].inJail).toBe(false);
    expect(next.players[0].cashCents).toBe(10_000 - 5_000); // $50 fine
    expect(next.players[0].position).toBe(17); // 10 + 7, moved this same turn
  });
});

describe("rent", () => {
  it("doubles the unimproved rent when the owner has a full colour-group monopoly", () => {
    const owner = makePlayer("owner", 1, {
      cashCents: 0,
    });
    const payer = makePlayer("payer", 0, { position: 1, cashCents: 50_000 });
    const state = makeState([payer, owner], {
      ownership: {
        6: { ownerId: "owner", houses: 0, hotel: false, mortgaged: false },
        8: { ownerId: "owner", houses: 0, hotel: false, mortgaged: false },
        9: { ownerId: "owner", houses: 0, hotel: false, mortgaged: false },
      },
    });

    const expectedRent = BOARD[6].type === "property" ? BOARD[6].rent[0] * 2 : 0;
    expect(expectedRent).toBeGreaterThan(0);

    const { state: next } = reduce(state, { type: "ROLL", playerId: "payer", d1: 2, d2: 3 }); // 1 -> 6

    expect(next.players[1].cashCents).toBe(expectedRent); // owner
    expect(next.players[0].cashCents).toBe(50_000 - expectedRent); // payer
  });

  it("is zero on a mortgaged property", () => {
    const state = makeState(
      [makePlayer("payer", 0, { position: 1, cashCents: 50_000 }), makePlayer("owner", 1)],
      {
        ownership: {
          6: { ownerId: "owner", houses: 0, hotel: false, mortgaged: true },
        },
      },
    );

    const { state: next } = reduce(state, { type: "ROLL", playerId: "payer", d1: 2, d2: 3 }); // 1 -> 6

    expect(next.players[0].cashCents).toBe(50_000);
    expect(next.players[1].cashCents).toBe(STARTING_CASH);
  });

  it("utility rent uses the actual dice that landed the player there", () => {
    const state = makeState(
      [makePlayer("payer", 0, { position: 5, cashCents: 50_000 }), makePlayer("owner", 1)],
      {
        ownership: {
          12: { ownerId: "owner", houses: 0, hotel: false, mortgaged: false }, // NEPA, one utility owned
        },
      },
    );

    const { state: next } = reduce(state, { type: "ROLL", playerId: "payer", d1: 3, d2: 4 }); // 5 -> 12, total 7

    const expectedRent = 7 * 4 * 100; // dice total * 4x multiplier, in cents
    expect(next.players[0].cashCents).toBe(50_000 - expectedRent);
    expect(next.players[1].cashCents).toBe(STARTING_CASH + expectedRent);
  });
});

describe("building houses", () => {
  function stateWithFullBrownGroup(cashCents = 100_000) {
    return makeState([makePlayer("p1", 0, { cashCents }), makePlayer("p2", 1)], {
      turnPhase: "awaiting_end_turn",
      ownership: {
        1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
        3: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
      },
    });
  }

  it("allows the first house once the full unmortgaged group is owned", () => {
    const state = stateWithFullBrownGroup();
    const { state: next } = reduce(state, { type: "BUILD_HOUSE", playerId: "p1", spaceIndex: 1 });
    expect(next.ownership[1].houses).toBe(1);
  });

  it("the even-build rule rejects a 2nd house on one property before the group has 1 each", () => {
    const state = stateWithFullBrownGroup();
    const afterFirst = reduce(state, { type: "BUILD_HOUSE", playerId: "p1", spaceIndex: 1 }).state;
    expect(afterFirst.ownership[1].houses).toBe(1);

    const afterSecond = reduce(afterFirst, { type: "BUILD_HOUSE", playerId: "p1", spaceIndex: 1 });
    expect(afterSecond.state.ownership[1].houses).toBe(1); // rejected, unchanged
    expect(afterSecond.state.players[0].cashCents).toBe(afterFirst.players[0].cashCents); // no charge
    expect(afterSecond.events).toHaveLength(0);
  });

  it("allows the 2nd house once every property in the group is even", () => {
    const state = stateWithFullBrownGroup();
    let s = reduce(state, { type: "BUILD_HOUSE", playerId: "p1", spaceIndex: 1 }).state;
    s = reduce(s, { type: "BUILD_HOUSE", playerId: "p1", spaceIndex: 3 }).state; // even it up
    s = reduce(s, { type: "BUILD_HOUSE", playerId: "p1", spaceIndex: 1 }).state; // now legal

    expect(s.ownership[1].houses).toBe(2);
    expect(s.ownership[3].houses).toBe(1);
  });
});

describe("bankruptcy", () => {
  it("transfers every asset (cash, properties, jail-free cards) to the creditor", () => {
    const debtor = makePlayer("debtor", 0, { cashCents: 300, jailFreeCards: 1 });
    const creditor = makePlayer("creditor", 1, { cashCents: 20_000 });
    const bystander = makePlayer("bystander", 2);

    const state = makeState([debtor, creditor, bystander], {
      turnPhase: "awaiting_payment",
      currentPlayerIndex: 0,
      pendingDebt: { amount: 999_999, creditorId: "creditor", reason: "rent" },
      ownership: {
        1: { ownerId: "debtor", houses: 2, hotel: false, mortgaged: false }, // Agege, houseCost $50
        6: { ownerId: "debtor", houses: 0, hotel: false, mortgaged: true }, // Ojuelegba, mortgaged
      },
    });

    const { state: next, events } = reduce(state, { type: "DECLARE_BANKRUPT", playerId: "debtor" });

    const houseSaleProceeds = 2 * (5_000 / 2); // 2 houses at half of Agege's $50 house cost
    const expectedCreditorCash = 20_000 + 300 + houseSaleProceeds;

    const debtorAfter = next.players.find((p) => p.id === "debtor")!;
    const creditorAfter = next.players.find((p) => p.id === "creditor")!;

    expect(debtorAfter.bankrupt).toBe(true);
    expect(debtorAfter.cashCents).toBe(0);
    expect(debtorAfter.jailFreeCards).toBe(0);

    expect(creditorAfter.cashCents).toBe(expectedCreditorCash);
    expect(creditorAfter.jailFreeCards).toBe(1);

    expect(next.ownership[1]).toEqual({ ownerId: "creditor", houses: 0, hotel: false, mortgaged: false });
    expect(next.ownership[6]).toEqual({ ownerId: "creditor", houses: 0, hotel: false, mortgaged: true }); // carried over

    expect(next.status).toBe("active"); // bystander still solvent
    expect(next.winnerPlayerId).toBeNull();
    expect(events.some((e) => e.type === "PLAYER_BANKRUPT")).toBe(true);
  });

  it("ends the game once only one player remains solvent", () => {
    const debtor = makePlayer("debtor", 0, { cashCents: 0 });
    const creditor = makePlayer("creditor", 1, { cashCents: 20_000 });
    const state = makeState([debtor, creditor], {
      turnPhase: "awaiting_payment",
      currentPlayerIndex: 0,
      pendingDebt: { amount: 5_000, creditorId: "creditor", reason: "rent" },
    });

    const { state: next, events } = reduce(state, { type: "DECLARE_BANKRUPT", playerId: "debtor" });

    expect(next.status).toBe("finished");
    expect(next.winnerPlayerId).toBe("creditor");
    expect(events.some((e) => e.type === "GAME_OVER")).toBe(true);
  });

  it("returns to the bank (properties become unowned) when the debt was owed to the bank", () => {
    const debtor = makePlayer("debtor", 0, { cashCents: 0 });
    const bystander = makePlayer("bystander", 1);
    const other = makePlayer("other", 2);
    const state = makeState([debtor, bystander, other], {
      turnPhase: "awaiting_payment",
      currentPlayerIndex: 0,
      pendingDebt: { amount: 10_000, creditorId: "bank", reason: "tax" },
      ownership: { 1: { ownerId: "debtor", houses: 0, hotel: false, mortgaged: false } },
    });

    const { state: next } = reduce(state, { type: "DECLARE_BANKRUPT", playerId: "debtor" });
    expect(next.ownership[1]).toBeUndefined();
  });
});

describe("net worth", () => {
  it("sums cash, unmortgaged property price, and house value", () => {
    const state = makeState([makePlayer("p1", 0, { cashCents: 1_000 })], {
      ownership: {
        1: { ownerId: "p1", houses: 2, hotel: false, mortgaged: false }, // Agege $50 price, $50/house
      },
    });
    const price = BOARD[1].type === "property" ? BOARD[1].price : 0;
    expect(netWorth(state, "p1")).toBe(1_000 + price + 2 * 5_000);
  });
});

describe("200-turn simulation", () => {
  it("never produces a negative or fractional cash value with scripted (deterministic) dice", () => {
    const SIM_SEED = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd";
    const players = [
      makePlayer("p1", 0),
      makePlayer("p2", 1),
      makePlayer("p3", 2),
      makePlayer("p4", 3),
    ];
    let state: GameState = makeState(players);

    let turnsCompleted = 0;
    let prevPlayerIndex = state.currentPlayerIndex;
    let rollCounter = 0;
    let cardCounter = 0;
    let safety = 0;
    const MAX_TURNS = 200;
    const SAFETY_CAP = 20_000;

    function assertAllCashValid(s: GameState) {
      for (const p of s.players) {
        expect(Number.isInteger(p.cashCents)).toBe(true);
        expect(p.cashCents).toBeGreaterThanOrEqual(0);
      }
    }

    function raiseCash(s: GameState, playerId: string): GameState {
      let changed = true;
      let iterations = 0;
      while (changed && iterations < 200) {
        changed = false;
        iterations++;
        const owned = Object.entries(s.ownership)
          .filter(([, own]) => own.ownerId === playerId)
          .map(([idxStr]) => Number(idxStr));

        const withHouses = owned
          .filter((idx) => s.ownership[idx].houses > 0 || s.ownership[idx].hotel)
          .sort((a, b) => {
            const la = s.ownership[a].hotel ? 5 : s.ownership[a].houses;
            const lb = s.ownership[b].hotel ? 5 : s.ownership[b].houses;
            return lb - la;
          });

        if (withHouses.length > 0) {
          const before = s.players.find((p) => p.id === playerId)!.cashCents;
          s = reduce(s, { type: "SELL_HOUSE", playerId, spaceIndex: withHouses[0] }).state;
          if (s.players.find((p) => p.id === playerId)!.cashCents !== before) changed = true;
          continue;
        }

        const mortgageable = owned.find(
          (idx) => !s.ownership[idx].mortgaged && s.ownership[idx].houses === 0 && !s.ownership[idx].hotel,
        );
        if (mortgageable !== undefined) {
          const before = s.players.find((p) => p.id === playerId)!.cashCents;
          s = reduce(s, { type: "MORTGAGE", playerId, spaceIndex: mortgageable }).state;
          if (s.players.find((p) => p.id === playerId)!.cashCents !== before) changed = true;
        }
      }
      return s;
    }

    while (turnsCompleted < MAX_TURNS && state.status !== "finished" && safety < SAFETY_CAP) {
      safety++;
      const player = state.players[state.currentPlayerIndex];
      let action: GameAction;

      if (state.turnPhase === "awaiting_roll") {
        const { d1, d2 } = rollFor(SIM_SEED, "sim-game", rollCounter++);
        action = { type: "ROLL", playerId: player.id, d1, d2 };
      } else if (state.turnPhase === "awaiting_purchase") {
        const space = BOARD[player.position];
        const price =
          space.type === "property" || space.type === "transport" || space.type === "utility" ? space.price : 0;
        action =
          player.cashCents >= price
            ? { type: "BUY", playerId: player.id }
            : { type: "DECLINE_BUY", playerId: player.id };
      } else if (state.turnPhase === "awaiting_payment") {
        if (player.cashCents < (state.pendingDebt?.amount ?? 0)) {
          state = raiseCash(state, player.id);
          assertAllCashValid(state);
        }
        const fresh = state.players[state.currentPlayerIndex];
        action =
          state.pendingDebt && fresh.cashCents >= state.pendingDebt.amount
            ? { type: "PAY_RENT", playerId: fresh.id }
            : { type: "DECLARE_BANKRUPT", playerId: fresh.id };
      } else if (state.turnPhase === "awaiting_card") {
        const deck = DECKS[state.pendingCardDeck!];
        const card = deck[cardCounter % deck.length];
        cardCounter++;
        action = { type: "DRAW_CARD", playerId: player.id, cardId: card.id };
      } else if (state.turnPhase === "awaiting_end_turn") {
        action = { type: "END_TURN", playerId: player.id };
      } else {
        break; // game_over
      }

      state = reduce(state, action).state;
      assertAllCashValid(state);

      if (state.currentPlayerIndex !== prevPlayerIndex) {
        turnsCompleted++;
        prevPlayerIndex = state.currentPlayerIndex;
      }
    }

    console.log(`turns completed: ${turnsCompleted}, actions dispatched: ${safety}, rolls: ${rollCounter}`);
    console.log(
      `final status: ${state.status}, winner: ${state.winnerPlayerId ?? "none"}, cash: ${state.players
        .map((p) => `${p.id}=${p.cashCents}${p.bankrupt ? "(bankrupt)" : ""}`)
        .join(", ")}`,
    );

    expect(safety).toBeLessThan(SAFETY_CAP); // the loop made real progress, not stuck
    expect(turnsCompleted).toBeGreaterThan(0);
    assertAllCashValid(state);
  });
});
