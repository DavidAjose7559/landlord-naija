import { describe, expect, it } from "vitest";
import { MAPS } from "./maps";
import type { PropertySpace } from "./board";
import { rollFor } from "./dice";
import { computeDebtReliefPlan, netWorth, netWorthBreakdown, reduce, type GameAction } from "./engine";
import { DEFAULT_SETTINGS, type GameState, type PlayerState, type PlayerToken } from "./types";

const BOARD = MAPS.naija.spaces;
const DECKS = MAPS.naija.decks;
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
    settings: DEFAULT_SETTINGS,
    hostPlayerId: null,
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
    pendingTaxChoice: null,
    pendingDebt: null,
    pendingAuction: null,
    freeParkingPot: 0,
    turnStartedAt: null,
    ...overrides,
  };
}

describe("passing GO", () => {
  it("pays exactly once on a card-driven move (moveTo with passGoPays)", () => {
    const state = makeState([makePlayer("p1", 0, { position: 20, cashCents: 10_000 }), makePlayer("p2", 1)], {
      turnPhase: "awaiting_card",
      pendingCardDeck: "treasure",
    });

    const card = DECKS.treasure.find((c) => c.id === "owambe-12")!; // "Head straight to GO." moveTo 0, passGoPays true
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

// One test per settings.* field wired into the engine, proving ON and OFF
// produce genuinely different behaviour (a setting that renders but does
// nothing is a bug). mapId/maxPlayers/privateRoom/startingCashCents/
// randomizePlayerOrder/turnTimeLimitSeconds live outside the pure engine
// (map lookup, lobby caps, the public listing, join-time cash, shuffling,
// and wall-clock timing respectively) — covered in test/api-games.test.ts.
describe("settings", () => {
  it("doubleRentOnFullSet: unimproved rent doubles on a full set when ON, stays flat when OFF", () => {
    function rentCollected(doubleRentOnFullSet: boolean): number {
      const state = makeState(
        [makePlayer("p1", 0, { cashCents: 0 }), makePlayer("p2", 1, { position: 0, cashCents: 100_000 })],
        {
          currentPlayerIndex: 1,
          settings: { ...DEFAULT_SETTINGS, doubleRentOnFullSet },
          ownership: {
            1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
            3: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
          },
        },
      );
      const { state: next } = reduce(state, { type: "ROLL", playerId: "p2", d1: 1, d2: 0 });
      return next.players[0].cashCents;
    }
    const on = rentCollected(true);
    const off = rentCollected(false);
    expect(off).toBeGreaterThan(0);
    expect(on).toBe(off * 2);
  });

  it("freeParkingCash: tax payments pool and pay out at Free Parking when ON, never accumulate when OFF", () => {
    function potAfterTax(freeParkingCash: boolean): number {
      const state = makeState([makePlayer("p1", 0, { position: 4, cashCents: 100_000 })], {
        settings: { ...DEFAULT_SETTINGS, freeParkingCash },
        turnPhase: "awaiting_tax_choice",
        pendingTaxChoice: { spaceIndex: 4 },
      });
      const { state: next } = reduce(state, { type: "CHOOSE_TAX", playerId: "p1", option: "flat" });
      return next.freeParkingPot;
    }
    expect(potAfterTax(true)).toBeGreaterThan(0);
    expect(potAfterTax(false)).toBe(0);
  });

  it("freeParkingCash: landing on Free Parking with a pot collects it when ON", () => {
    const state = makeState([makePlayer("p1", 0, { position: 20, cashCents: 1_000 })], {
      settings: { ...DEFAULT_SETTINGS, freeParkingCash: true },
      freeParkingPot: 5_000,
    });
    const { state: next, events } = reduce(state, { type: "ROLL", playerId: "p1", d1: 0, d2: 0 });
    expect(next.players[0].cashCents).toBe(6_000);
    expect(next.freeParkingPot).toBe(0);
    expect(events.some((e) => e.type === "FREE_PARKING_PAID")).toBe(true);
  });

  it("auctionOnDecline: declining a purchase starts an auction when ON, leaves it with the bank when OFF", () => {
    function declineOutcome(auctionOnDecline: boolean) {
      const state = makeState([makePlayer("p1", 0, { position: 1 }), makePlayer("p2", 1)], {
        settings: { ...DEFAULT_SETTINGS, auctionOnDecline },
        turnPhase: "awaiting_purchase",
      });
      return reduce(state, { type: "DECLINE_BUY", playerId: "p1" }).state;
    }
    const on = declineOutcome(true);
    expect(on.turnPhase).toBe("awaiting_auction");
    expect(on.pendingAuction?.spaceIndex).toBe(1);

    const off = declineOutcome(false);
    expect(off.turnPhase).not.toBe("awaiting_auction");
    expect(off.pendingAuction).toBeNull();
  });

  it("auction: the highest bidder wins the property and pays their bid", () => {
    const state = makeState(
      [makePlayer("p1", 0, { position: 1, cashCents: 100_000 }), makePlayer("p2", 1, { cashCents: 100_000 })],
      { settings: { ...DEFAULT_SETTINGS, auctionOnDecline: true }, turnPhase: "awaiting_purchase" },
    );
    const { state: afterDecline } = reduce(state, { type: "DECLINE_BUY", playerId: "p1" });
    expect(afterDecline.pendingAuction?.turnPlayerId).toBe("p2");

    const { state: afterBid } = reduce(afterDecline, { type: "PLACE_BID", playerId: "p2", amount: 1_000 });
    expect(afterBid.pendingAuction?.highestBidderId).toBe("p2");
    expect(afterBid.pendingAuction?.turnPlayerId).toBe("p1");

    const { state: afterPass, events } = reduce(afterBid, { type: "PASS_AUCTION", playerId: "p1" });
    expect(afterPass.pendingAuction).toBeNull();
    expect(afterPass.ownership[1]).toEqual({ ownerId: "p2", houses: 0, hotel: false, mortgaged: false });
    expect(afterPass.players[1].cashCents).toBe(100_000 - 1_000);
    expect(events.some((e) => e.type === "AUCTION_WON")).toBe(true);
  });

  it("collectRentWhileJailed: rent is skipped when the owner is jailed and the setting is OFF", () => {
    function rentCollected(collectRentWhileJailed: boolean): number {
      const state = makeState(
        [makePlayer("p1", 0, { inJail: true, cashCents: 0 }), makePlayer("p2", 1, { position: 0, cashCents: 100_000 })],
        {
          currentPlayerIndex: 1,
          settings: { ...DEFAULT_SETTINGS, collectRentWhileJailed },
          ownership: { 1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false } },
        },
      );
      const { state: next } = reduce(state, { type: "ROLL", playerId: "p2", d1: 1, d2: 0 });
      return next.players[0].cashCents;
    }
    expect(rentCollected(true)).toBeGreaterThan(0);
    expect(rentCollected(false)).toBe(0);
  });

  it("mortgageEnabled: MORTGAGE works when ON, is a no-op when OFF", () => {
    function tryMortgage(mortgageEnabled: boolean): boolean {
      const state = makeState([makePlayer("p1", 0, { cashCents: 0 })], {
        settings: { ...DEFAULT_SETTINGS, mortgageEnabled },
        ownership: { 1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false } },
      });
      const { state: next } = reduce(state, { type: "MORTGAGE", playerId: "p1", spaceIndex: 1 });
      return next.ownership[1].mortgaged;
    }
    expect(tryMortgage(true)).toBe(true);
    expect(tryMortgage(false)).toBe(false);
  });

  it("evenBuild: building unevenly across a set is rejected when ON, allowed when OFF", () => {
    function houseCountAfterUnevenBuild(evenBuild: boolean): number {
      const state = makeState([makePlayer("p1", 0, { cashCents: 100_000 })], {
        settings: { ...DEFAULT_SETTINGS, evenBuild },
        ownership: {
          1: { ownerId: "p1", houses: 1, hotel: false, mortgaged: false },
          3: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
        },
      });
      const { state: next } = reduce(state, { type: "BUILD_HOUSE", playerId: "p1", spaceIndex: 1 });
      return next.ownership[1].houses;
    }
    expect(houseCountAfterUnevenBuild(true)).toBe(1); // rejected
    expect(houseCountAfterUnevenBuild(false)).toBe(2); // allowed
  });

  it("allowManualBankruptcy: voluntary DECLARE_BANKRUPT with no debt works when ON, is a no-op when OFF", () => {
    function tryVoluntaryBankruptcy(allowManualBankruptcy: boolean): boolean {
      const state = makeState([makePlayer("p1", 0, { cashCents: 10_000 }), makePlayer("p2", 1)], {
        settings: { ...DEFAULT_SETTINGS, allowManualBankruptcy },
      });
      const { state: next } = reduce(state, { type: "DECLARE_BANKRUPT", playerId: "p1" });
      return next.players[0].bankrupt;
    }
    expect(tryVoluntaryBankruptcy(true)).toBe(true);
    expect(tryVoluntaryBankruptcy(false)).toBe(false);
  });

  it("bankruptcyTransfersAssets: properties transfer to the creditor when ON, return to the market when OFF", () => {
    function ownerAfterBankruptcy(bankruptcyTransfersAssets: boolean) {
      const state = makeState([makePlayer("p1", 0, { cashCents: 0 }), makePlayer("p2", 1, { cashCents: 0 })], {
        settings: { ...DEFAULT_SETTINGS, bankruptcyTransfersAssets },
        turnPhase: "awaiting_payment",
        pendingDebt: { amount: 10_000, creditorId: "p2", reason: "rent" },
        ownership: { 1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false } },
      });
      const { state: next, events } = reduce(state, { type: "DECLARE_BANKRUPT", playerId: "p1" });
      return { ownership: next.ownership[1], events };
    }
    const on = ownerAfterBankruptcy(true);
    expect(on.ownership?.ownerId).toBe("p2");

    const off = ownerAfterBankruptcy(false);
    expect(off.ownership).toBeUndefined();
    expect(off.events.some((e) => e.type === "PROPERTIES_RETURNED_TO_MARKET")).toBe(true);
  });

  it("tradingEnabled: EXECUTE_ACCEPTED_TRADE moves cash when ON, is a no-op when OFF", () => {
    function receiverCashAfterTrade(tradingEnabled: boolean): number {
      const state = makeState([makePlayer("p1", 0, { cashCents: 10_000 }), makePlayer("p2", 1, { cashCents: 10_000 })], {
        settings: { ...DEFAULT_SETTINGS, tradingEnabled },
      });
      const { state: next } = reduce(state, {
        type: "EXECUTE_ACCEPTED_TRADE",
        playerId: "p2",
        fromPlayerId: "p1",
        toPlayerId: "p2",
        give: { cashCents: 1_000, spaceIndexes: [], jailFreeCards: 0 },
        receive: { cashCents: 0, spaceIndexes: [], jailFreeCards: 0 },
      });
      return next.players[1].cashCents;
    }
    expect(receiverCashAfterTrade(true)).toBe(11_000);
    expect(receiverCashAfterTrade(false)).toBe(10_000);
  });

  describe("UPDATE_SETTINGS", () => {
    it("only the host can change settings", () => {
      const state = makeState([makePlayer("p1", 0), makePlayer("p2", 1)], { status: "lobby", hostPlayerId: "p1" });
      const { events } = reduce(state, { type: "UPDATE_SETTINGS", playerId: "p2", settings: { freeParkingCash: true } });
      expect(events).toHaveLength(0);
    });

    it("the host can change settings while still in the lobby", () => {
      const state = makeState([makePlayer("p1", 0), makePlayer("p2", 1)], { status: "lobby", hostPlayerId: "p1" });
      const { state: next, events } = reduce(state, {
        type: "UPDATE_SETTINGS",
        playerId: "p1",
        settings: { freeParkingCash: true },
      });
      expect(next.settings.freeParkingCash).toBe(true);
      expect(events).toHaveLength(1);
    });

    it("settings are frozen once the game is active", () => {
      const state = makeState([makePlayer("p1", 0), makePlayer("p2", 1)], { status: "active", hostPlayerId: "p1" });
      const { events } = reduce(state, { type: "UPDATE_SETTINGS", playerId: "p1", settings: { freeParkingCash: true } });
      expect(events).toHaveLength(0);
    });

    it("rejects lowering maxPlayers below the current seat count", () => {
      const state = makeState([makePlayer("p1", 0), makePlayer("p2", 1), makePlayer("p3", 2)], {
        status: "lobby",
        hostPlayerId: "p1",
      });
      const { state: next, events } = reduce(state, {
        type: "UPDATE_SETTINGS",
        playerId: "p1",
        settings: { maxPlayers: 2 },
      });
      expect(events).toHaveLength(0);
      expect(next.settings.maxPlayers).toBe(DEFAULT_SETTINGS.maxPlayers);
    });
  });
});

// Section C: debt never auto-liquidates anything. The engine only freezes
// the turn (awaiting_payment) and, on request, previews/executes a
// specific minimum-pain liquidation order — it never silently sells or
// mortgages anything on its own.
describe("debt relief", () => {
  it("computeDebtReliefPlan: mortgages the cheapest bare property first when that alone covers the debt", () => {
    const state = makeState([makePlayer("p1", 0, { cashCents: 0 })], {
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: BOARD[1].type === "property" ? BOARD[1].mortgageValue : 0, creditorId: "bank", reason: "tax" },
      ownership: {
        1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false }, // Agege $50 — cheaper
        3: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false }, // Mushin $55
      },
    });
    const plan = computeDebtReliefPlan(state, "p1");
    expect(plan.sufficient).toBe(true);
    expect(plan.operations).toEqual([{ type: "mortgage", spaceIndex: 1 }]);
  });

  it("computeDebtReliefPlan: never sells a house while an unmortgaged bare property still exists", () => {
    const state = makeState([makePlayer("p1", 0, { cashCents: 0 })], {
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: 1_000_000, creditorId: "bank", reason: "tax" }, // deliberately unreachable
      ownership: {
        37: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false }, // bare — Banana Island
        6: { ownerId: "p1", houses: 3, hotel: false, mortgaged: false },
        8: { ownerId: "p1", houses: 3, hotel: false, mortgaged: false },
        9: { ownerId: "p1", houses: 3, hotel: false, mortgaged: false },
      },
    });
    const plan = computeDebtReliefPlan(state, "p1");
    const bareMortgageIndex = plan.operations.findIndex((op) => op.type === "mortgage" && op.spaceIndex === 37);
    const firstSellIndex = plan.operations.findIndex((op) => op.type === "sellHouse");
    expect(bareMortgageIndex).toBeGreaterThanOrEqual(0);
    expect(firstSellIndex).toBeGreaterThan(bareMortgageIndex);
  });

  it("computeDebtReliefPlan: sells houses before ever touching a hotel-holding group", () => {
    const state = makeState([makePlayer("p1", 0, { cashCents: 0 })], {
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: 100_000, creditorId: "bank", reason: "tax" },
      ownership: {
        11: { ownerId: "p1", houses: 2, hotel: false, mortgaged: false },
        13: { ownerId: "p1", houses: 2, hotel: false, mortgaged: false },
        14: { ownerId: "p1", houses: 2, hotel: false, mortgaged: false },
        1: { ownerId: "p1", houses: 0, hotel: true, mortgaged: false },
        3: { ownerId: "p1", houses: 0, hotel: true, mortgaged: false },
      },
    });
    const plan = computeDebtReliefPlan(state, "p1");
    const firstHotelTouch = plan.operations.findIndex(
      (op) => op.type === "sellHouse" && (op.spaceIndex === 1 || op.spaceIndex === 3),
    );
    const lastPinkTouch = plan.operations.reduce(
      (last, op, i) => (op.type === "sellHouse" && [11, 13, 14].includes(op.spaceIndex) ? i : last),
      -1,
    );
    expect(firstHotelTouch).toBeGreaterThan(lastPinkTouch);
  });

  it("computeDebtReliefPlan: reports insufficient when even full liquidation can't cover the debt", () => {
    const state = makeState([makePlayer("p1", 0, { cashCents: 0 })], {
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: 999_999_999, creditorId: "bank", reason: "tax" },
      ownership: { 1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false } },
    });
    const plan = computeDebtReliefPlan(state, "p1");
    expect(plan.sufficient).toBe(false);
  });

  it("RAISE_DEBT_HELP: applies the plan for real, raising cash without auto-paying the debt", () => {
    const debtAmount = BOARD[1].type === "property" ? BOARD[1].mortgageValue : 0;
    const state = makeState([makePlayer("p1", 0, { cashCents: 0 })], {
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: debtAmount, creditorId: "bank", reason: "tax" },
      ownership: { 1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false } },
    });
    const { state: next, events } = reduce(state, { type: "RAISE_DEBT_HELP", playerId: "p1" });
    expect(next.ownership[1].mortgaged).toBe(true);
    expect(next.players[0].cashCents).toBeGreaterThanOrEqual(debtAmount);
    expect(next.turnPhase).toBe("awaiting_payment"); // still needs an explicit PAY_RENT
    expect(next.pendingDebt).not.toBeNull();
    expect(events.some((e) => e.type === "DEBT_RELIEF_APPLIED")).toBe(true);

    const { state: afterPay } = reduce(next, { type: "PAY_RENT", playerId: "p1" });
    expect(afterPay.pendingDebt).toBeNull();
  });

  it("RAISE_DEBT_HELP: no-op when even full liquidation can't cover the debt", () => {
    const state = makeState([makePlayer("p1", 0, { cashCents: 0 })], {
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: 999_999_999, creditorId: "bank", reason: "tax" },
      ownership: { 1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false } },
    });
    const { state: next, events } = reduce(state, { type: "RAISE_DEBT_HELP", playerId: "p1" });
    expect(next.ownership[1].mortgaged).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("SELL_HOUSE works during awaiting_payment so a debtor can raise cash manually", () => {
    const state = makeState([makePlayer("p1", 0, { cashCents: 0 })], {
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: 1, creditorId: "bank", reason: "tax" },
      ownership: {
        1: { ownerId: "p1", houses: 1, hotel: false, mortgaged: false },
        3: { ownerId: "p1", houses: 1, hotel: false, mortgaged: false },
      },
    });
    const { state: next, events } = reduce(state, { type: "SELL_HOUSE", playerId: "p1", spaceIndex: 1 });
    expect(next.ownership[1].houses).toBe(0);
    expect(events.some((e) => e.type === "HOUSE_SOLD")).toBe(true);
  });

  it("manual bankruptcy stays available mid-debt regardless of allowManualBankruptcy", () => {
    const state = makeState([makePlayer("p1", 0, { cashCents: 0 }), makePlayer("p2", 1)], {
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: 999_999_999, creditorId: "p2", reason: "rent" },
      settings: { ...DEFAULT_SETTINGS, allowManualBankruptcy: false },
    });
    const { state: next } = reduce(state, { type: "DECLARE_BANKRUPT", playerId: "p1" });
    expect(next.players[0].bankrupt).toBe(true);
  });
});

// Section F: the winner screen's net worth breakdown.
describe("netWorthBreakdown", () => {
  it("itemizes cash, property, houses, and mortgage debt, summing to its own total", () => {
    const state = makeState([makePlayer("p1", 0, { cashCents: 5_000 })], {
      ownership: {
        1: { ownerId: "p1", houses: 2, hotel: false, mortgaged: false }, // Agege, unmortgaged, 2 houses
        3: { ownerId: "p1", houses: 0, hotel: false, mortgaged: true }, // Mushin, mortgaged, bare
      },
    });
    const breakdown = netWorthBreakdown(state, "p1");
    const agege = BOARD[1] as PropertySpace;
    const mushin = BOARD[3] as PropertySpace;

    expect(breakdown.cashCents).toBe(5_000);
    expect(breakdown.propertyValueCents).toBe(agege.price + mushin.price);
    expect(breakdown.houseValueCents).toBe(2 * agege.houseCost);
    expect(breakdown.mortgageDebtCents).toBe(mushin.mortgageValue);
    expect(breakdown.totalCents).toBe(
      breakdown.cashCents + breakdown.propertyValueCents + breakdown.houseValueCents - breakdown.mortgageDebtCents,
    );
    // Deliberately not the same figure as netWorth(): that function treats
    // a mortgaged property as worth 0 (a crude shortcut used for in-game
    // mechanics like percent-of-net-worth tax); this breakdown instead
    // shows it at full value with the mortgage as its own negative line,
    // which is the more informative picture the winner screen wants.
  });

  it("returns all zeros for an unknown player", () => {
    const state = makeState([makePlayer("p1", 0)]);
    expect(netWorthBreakdown(state, "nobody")).toEqual({
      cashCents: 0,
      propertyValueCents: 0,
      houseValueCents: 0,
      mortgageDebtCents: 0,
      totalCents: 0,
    });
  });
});

// Section D: trade negotiation (propose/counter/decline/cancel) lives in
// the `trades` table now, outside the pure engine — see
// src/app/api/games/[code]/trades/** and test/api-games.test.ts for that.
// Only EXECUTE_ACCEPTED_TRADE remains here, since accepting is the one
// moment that actually has to mutate cash/ownership.
describe("EXECUTE_ACCEPTED_TRADE", () => {
  function tradeState(overrides: Partial<GameState> = {}) {
    return makeState(
      [
        makePlayer("p1", 0, { cashCents: 10_000 }),
        makePlayer("p2", 1, { cashCents: 10_000 }),
      ],
      {
        ownership: { 1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false } },
        ...overrides,
      },
    );
  }

  it("moves cash, properties, and jail-free cards both ways", () => {
    const state = tradeState({
      players: [
        makePlayer("p1", 0, { cashCents: 10_000, jailFreeCards: 1 }),
        makePlayer("p2", 1, { cashCents: 10_000 }),
      ],
    });
    const { state: next } = reduce(state, {
      type: "EXECUTE_ACCEPTED_TRADE",
      playerId: "p2",
      fromPlayerId: "p1",
      toPlayerId: "p2",
      give: { cashCents: 0, spaceIndexes: [1], jailFreeCards: 1 },
      receive: { cashCents: 5_000, spaceIndexes: [], jailFreeCards: 0 },
    });
    expect(next.ownership[1].ownerId).toBe("p2");
    expect(next.players[0].cashCents).toBe(15_000); // p1 received the 5,000
    expect(next.players[1].cashCents).toBe(5_000); // p2 paid the 5,000
    expect(next.players[0].jailFreeCards).toBe(0);
    expect(next.players[1].jailFreeCards).toBe(1);
  });

  it("only the recipient (toPlayerId) can execute the trade", () => {
    const state = tradeState();
    const { events } = reduce(state, {
      type: "EXECUTE_ACCEPTED_TRADE",
      playerId: "p1", // the proposer, not the recipient
      fromPlayerId: "p1",
      toPlayerId: "p2",
      give: { cashCents: 0, spaceIndexes: [1], jailFreeCards: 0 },
      receive: { cashCents: 0, spaceIndexes: [], jailFreeCards: 0 },
    });
    expect(events).toHaveLength(0);
  });

  it("rejects a stale offer — the property isn't owned by fromPlayerId anymore", () => {
    const state = tradeState({ ownership: {} }); // space 1 no longer owned by p1
    const { events } = reduce(state, {
      type: "EXECUTE_ACCEPTED_TRADE",
      playerId: "p2",
      fromPlayerId: "p1",
      toPlayerId: "p2",
      give: { cashCents: 0, spaceIndexes: [1], jailFreeCards: 0 },
      receive: { cashCents: 0, spaceIndexes: [], jailFreeCards: 0 },
    });
    expect(events).toHaveLength(0);
  });

  it("rejects a trade involving a player who's mid-debt-resolution", () => {
    const state = tradeState({
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: 1_000, creditorId: "bank", reason: "tax" },
      currentPlayerIndex: 0, // p1 is the debtor
    });
    const { events } = reduce(state, {
      type: "EXECUTE_ACCEPTED_TRADE",
      playerId: "p2",
      fromPlayerId: "p1",
      toPlayerId: "p2",
      give: { cashCents: 1_000, spaceIndexes: [], jailFreeCards: 0 },
      receive: { cashCents: 0, spaceIndexes: [], jailFreeCards: 0 },
    });
    expect(events).toHaveLength(0);
  });
});
