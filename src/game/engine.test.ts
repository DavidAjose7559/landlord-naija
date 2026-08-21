import { describe, expect, it } from "vitest";
import { MAPS } from "./maps";
import { GO_SALARY, type PropertySpace } from "./board";
import { rollFor } from "./dice";
import {
  computeDebtReliefPlan,
  computePropertyRent,
  computeTransportRent,
  computeUtilityRent,
  netWorth,
  netWorthBreakdown,
  reduce,
  type GameAction,
} from "./engine";
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
    skipNextTurn: false,
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
    pendingDebt: null,
    pendingAuction: null,
    freeParkingPot: 0,
    turnStartedAt: null,
    auctionDeadline: null,
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
    const { state: next, events } = reduce(state, { type: "ROLL", playerId: "p1", d1: 2, d2: 5 }); // non-double

    expect(next.players[0].inJail).toBe(false);
    expect(next.players[0].cashCents).toBe(10_000 - 5_000); // $50 fine
    expect(next.players[0].position).toBe(17); // 10 + 7, moved this same turn
    // Real bug: this forced fine moved the cash but never logged it.
    expect(
      events.some((e) => e.type === "JAIL_ESCAPED" && e.method === "forcedFine" && e.amount === 5_000),
    ).toBe(true);
  });

  it("defers the forced fine as a jailFine debt when the player can't afford it", () => {
    const state = makeState(
      [makePlayer("p1", 0, { position: 10, inJail: true, jailTurns: 2, cashCents: 1_000 }), makePlayer("p2", 1)],
    );
    const { state: next, events } = reduce(state, { type: "ROLL", playerId: "p1", d1: 2, d2: 5 });

    expect(next.turnPhase).toBe("awaiting_payment");
    expect(next.pendingDebt).toEqual({ amount: 5_000, creditorId: "bank", reason: "jailFine" });
    expect(events.some((e) => e.type === "JAIL_ESCAPED")).toBe(false); // not out yet — still owes the fine
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

// The property inspector (src/components/PropertyInspector.tsx) imports
// computePropertyRent/computeTransportRent/computeUtilityRent directly and
// calls them with the exact same arguments resolveLanding does, rather than
// re-deriving rent itself — these tests exist to prove that channel is
// trustworthy: whatever the exported function returns is provably what
// reduce() actually charges a player who lands there, for every tier these
// three space types can be in. If the inspector and the engine ever drifted
// apart, it could only be because one of these assertions started failing.
describe("computeXRent (as imported by the property inspector) matches what reduce() actually charges", () => {
  it("property: full monopoly, 0 houses — doubled", () => {
    const owner = makePlayer("owner", 1, { cashCents: 0 });
    const payer = makePlayer("payer", 0, { position: 1, cashCents: 50_000 });
    const state = makeState([payer, owner], {
      ownership: {
        6: { ownerId: "owner", houses: 0, hotel: false, mortgaged: false },
        8: { ownerId: "owner", houses: 0, hotel: false, mortgaged: false },
        9: { ownerId: "owner", houses: 0, hotel: false, mortgaged: false },
      },
    });
    const space = BOARD[6] as PropertySpace;
    const displayedRent = computePropertyRent(state, space, state.ownership[6]);

    const { state: next } = reduce(state, { type: "ROLL", playerId: "payer", d1: 2, d2: 3 }); // 1 -> 6

    expect(displayedRent).toBe(space.rent[0] * 2);
    expect(next.players[1].cashCents).toBe(displayedRent); // owner started at 0, gained exactly this
    expect(50_000 - next.players[0].cashCents).toBe(displayedRent); // payer paid exactly this
  });

  it("property: 2 houses, no monopoly — not doubled", () => {
    const owner = makePlayer("owner", 1, { cashCents: 0 });
    const payer = makePlayer("payer", 0, { position: 1, cashCents: 50_000 });
    const state = makeState([payer, owner], {
      ownership: {
        6: { ownerId: "owner", houses: 2, hotel: false, mortgaged: false },
        // group not complete — 8/9 unowned, so no full-set doubling applies
      },
    });
    const space = BOARD[6] as PropertySpace;
    const displayedRent = computePropertyRent(state, space, state.ownership[6]);

    const { state: next } = reduce(state, { type: "ROLL", playerId: "payer", d1: 2, d2: 3 }); // 1 -> 6

    expect(displayedRent).toBe(space.rent[2]);
    expect(50_000 - next.players[0].cashCents).toBe(displayedRent);
  });

  it("property: hotel", () => {
    const owner = makePlayer("owner", 1, { cashCents: 0 });
    // Hotel-tier rent on even a cheap property comfortably exceeds $500 —
    // give the payer enough cash that this charges immediately rather than
    // deferring to a pending debt (a real, different code path, not what
    // this test is about).
    const payer = makePlayer("payer", 0, { position: 1, cashCents: 100_000 });
    const state = makeState([payer, owner], {
      ownership: { 6: { ownerId: "owner", houses: 0, hotel: true, mortgaged: false } },
    });
    const space = BOARD[6] as PropertySpace;
    const displayedRent = computePropertyRent(state, space, state.ownership[6]);

    const { state: next } = reduce(state, { type: "ROLL", playerId: "payer", d1: 2, d2: 3 }); // 1 -> 6

    expect(displayedRent).toBe(space.rent[5]);
    expect(100_000 - next.players[0].cashCents).toBe(displayedRent);
  });

  it("transport: 3 owned", () => {
    const owner = makePlayer("owner", 1, { cashCents: 0 });
    const payer = makePlayer("payer", 0, { position: 20, cashCents: 50_000 }); // Detty December (free)
    const state = makeState([payer, owner], {
      ownership: {
        5: { ownerId: "owner", houses: 0, hotel: false, mortgaged: false },
        15: { ownerId: "owner", houses: 0, hotel: false, mortgaged: false },
        25: { ownerId: "owner", houses: 0, hotel: false, mortgaged: false }, // landing here, 3rd hub owned
      },
    });
    const displayedRent = computeTransportRent(state, "owner");

    const { state: next } = reduce(state, { type: "ROLL", playerId: "payer", d1: 3, d2: 2 }); // 20 -> 25 (Murtala Muhammed Airport)

    expect(displayedRent).toBe(12_000); // TRANSPORT_RENT[2] — $120, the 3-owned tier
    expect(50_000 - next.players[0].cashCents).toBe(displayedRent);
  });

  it("utility: 2 owned — 10x the dice", () => {
    const owner = makePlayer("owner", 1, { cashCents: 0 });
    const payer = makePlayer("payer", 0, { position: 21, cashCents: 50_000 });
    const state = makeState([payer, owner], {
      ownership: {
        12: { ownerId: "owner", houses: 0, hotel: false, mortgaged: false },
        28: { ownerId: "owner", houses: 0, hotel: false, mortgaged: false }, // landing here, both utilities owned
      },
    });

    const { state: next } = reduce(state, { type: "ROLL", playerId: "payer", d1: 3, d2: 4 }); // 21 -> 28
    const displayedRent = computeUtilityRent(next, "owner"); // computed against post-roll state, same as the inspector would read it live

    expect(displayedRent).toBe(7 * 10 * 100);
    expect(50_000 - next.players[0].cashCents).toBe(displayedRent);
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

describe("voluntary mortgaging", () => {
  it("mortgaging a bare property mid-turn adds exactly the mortgage value, and the property then collects no rent", () => {
    const space1 = BOARD[1] as PropertySpace;
    let state = makeState(
      [makePlayer("p1", 0, { cashCents: 100_000 }), makePlayer("p2", 1, { position: 39, cashCents: 100_000 })],
      {
        turnPhase: "awaiting_end_turn",
        ownership: { 1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false } },
      },
    );

    const mortgageResult = reduce(state, { type: "MORTGAGE", playerId: "p1", spaceIndex: 1 });
    state = mortgageResult.state;

    expect(state.ownership[1].mortgaged).toBe(true);
    expect(state.players[0].cashCents).toBe(100_000 + space1.mortgageValue);
    expect(mortgageResult.events.some((e) => e.type === "MORTGAGED")).toBe(true);

    // Land p2 exactly on the now-mortgaged property (39 -> 1, wrapping past GO) and confirm
    // the only cash change is the GO salary — no rent is charged on a mortgaged property.
    state = { ...state, currentPlayerIndex: 1, turnPhase: "awaiting_roll" };
    const { state: afterLanding, events } = reduce(state, { type: "ROLL", playerId: "p2", d1: 1, d2: 1 });

    expect(afterLanding.players[1].position).toBe(1);
    expect(afterLanding.players[1].cashCents).toBe(100_000 + 20_000); // GO salary only
    expect(events.some((e) => e.type === "RENT_PAID")).toBe(false);
  });

  it("rejects mortgaging a property that has a house on it", () => {
    const state = makeState([makePlayer("p1", 0, { cashCents: 100_000 }), makePlayer("p2", 1)], {
      turnPhase: "awaiting_end_turn",
      ownership: {
        1: { ownerId: "p1", houses: 1, hotel: false, mortgaged: false },
        3: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
      },
    });

    const { state: next, events } = reduce(state, { type: "MORTGAGE", playerId: "p1", spaceIndex: 1 });

    expect(next.ownership[1].mortgaged).toBe(false);
    expect(next.players[0].cashCents).toBe(100_000);
    expect(events).toHaveLength(0);
  });

  it("rejects building on a region where any member property is mortgaged", () => {
    const state = makeState([makePlayer("p1", 0, { cashCents: 100_000 }), makePlayer("p2", 1)], {
      turnPhase: "awaiting_end_turn",
      ownership: {
        6: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
        8: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
        9: { ownerId: "p1", houses: 0, hotel: false, mortgaged: true }, // one mortgaged member of the group
      },
    });

    const { state: next, events } = reduce(state, { type: "BUILD_HOUSE", playerId: "p1", spaceIndex: 6 });

    expect(next.ownership[6].houses).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("mortgaging region A does not block building in region B in the same turn", () => {
    let state = makeState([makePlayer("p1", 0, { cashCents: 100_000 }), makePlayer("p2", 1)], {
      turnPhase: "awaiting_end_turn",
      ownership: {
        1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false }, // brown region A
        3: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
        6: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false }, // lightblue region B
        8: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
        9: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
      },
    });

    state = reduce(state, { type: "MORTGAGE", playerId: "p1", spaceIndex: 1 }).state;
    state = reduce(state, { type: "MORTGAGE", playerId: "p1", spaceIndex: 3 }).state;
    expect(state.ownership[1].mortgaged).toBe(true);
    expect(state.ownership[3].mortgaged).toBe(true);

    const { state: next } = reduce(state, { type: "BUILD_HOUSE", playerId: "p1", spaceIndex: 6 });
    expect(next.ownership[6].houses).toBe(1);
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
      const state = makeState([makePlayer("p1", 0, { position: 0, cashCents: 100_000 }), makePlayer("p2", 1)], {
        settings: { ...DEFAULT_SETTINGS, freeParkingCash },
      });
      const { state: next } = reduce(state, { type: "ROLL", playerId: "p1", d1: 3, d2: 1 }); // 0+4=4, flat tax
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

  it("freeParkingSkipsTurn: landing there arms a skip when ON, does nothing when OFF", () => {
    function skipArmedAfterLanding(freeParkingSkipsTurn: boolean): boolean {
      const state = makeState([makePlayer("p1", 0, { position: 16, cashCents: 1_000 }), makePlayer("p2", 1)], {
        settings: { ...DEFAULT_SETTINGS, freeParkingSkipsTurn },
      });
      const { state: next } = reduce(state, { type: "ROLL", playerId: "p1", d1: 2, d2: 2 }); // 16+4=20, Free Parking
      return next.players[0].skipNextTurn;
    }
    expect(skipArmedAfterLanding(true)).toBe(true);
    expect(skipArmedAfterLanding(false)).toBe(false);
  });

  it("freeParkingSkipsTurn: the armed player's next turn is skipped, logged, and the flag is consumed", () => {
    const p1 = makePlayer("p1", 0, { skipNextTurn: true });
    const p2 = makePlayer("p2", 1);
    const p3 = makePlayer("p3", 2);
    const state = makeState([p1, p2, p3], {
      settings: { ...DEFAULT_SETTINGS, freeParkingSkipsTurn: true },
      currentPlayerIndex: 2, // p3's turn is ending; p1 (index 0) is next and should be skipped
      turnPhase: "awaiting_end_turn",
    });
    const { state: next, events } = reduce(state, { type: "END_TURN", playerId: "p3" });

    expect(next.currentPlayerIndex).toBe(1); // skipped straight past p1 to p2
    expect(next.players[0].skipNextTurn).toBe(false); // consumed, won't skip again next lap
    expect(events.some((e) => e.type === "TURN_SKIPPED" && e.playerId === "p1")).toBe(true);
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

  it("auction: any eligible player can bid any time (no turn order); the deadline resolution awards the high bidder", () => {
    const state = makeState(
      [
        makePlayer("p1", 0, { position: 1, cashCents: 100_000 }),
        makePlayer("p2", 1, { cashCents: 100_000 }),
        makePlayer("p3", 2, { cashCents: 100_000 }),
      ],
      { settings: { ...DEFAULT_SETTINGS, auctionOnDecline: true }, turnPhase: "awaiting_purchase" },
    );
    const { state: afterDecline } = reduce(state, { type: "DECLINE_BUY", playerId: "p1" });
    expect(afterDecline.pendingAuction?.eligiblePlayerIds).toEqual(["p1", "p2", "p3"]);

    // p3 bids first, then p1 (the decliner) outbids them — no turn gate.
    const { state: afterP3 } = reduce(afterDecline, { type: "PLACE_BID", playerId: "p3", amount: 500 });
    const { state: afterP1 } = reduce(afterP3, { type: "PLACE_BID", playerId: "p1", amount: 1_000 });
    expect(afterP1.pendingAuction?.bids).toEqual([
      { playerId: "p3", amount: 500 },
      { playerId: "p1", amount: 1_000 },
    ]);

    const { state: resolved, events } = reduce(afterP1, { type: "RESOLVE_AUCTION_TIMEOUT" });
    expect(resolved.pendingAuction).toBeNull();
    expect(resolved.ownership[1]).toEqual({ ownerId: "p1", houses: 0, hotel: false, mortgaged: false });
    expect(resolved.players[0].cashCents).toBe(100_000 - 1_000);
    expect(events.some((e) => e.type === "AUCTION_WON" && e.playerId === "p1" && e.amount === 1_000)).toBe(true);
  });

  it("auction: a stale/low bid is rejected, and bidding above your own cash is rejected", () => {
    const state = makeState(
      [makePlayer("p1", 0, { position: 1, cashCents: 100_000 }), makePlayer("p2", 1, { cashCents: 300 })],
      { settings: { ...DEFAULT_SETTINGS, auctionOnDecline: true }, turnPhase: "awaiting_purchase" },
    );
    const { state: afterDecline } = reduce(state, { type: "DECLINE_BUY", playerId: "p1" });
    const { state: afterBid } = reduce(afterDecline, { type: "PLACE_BID", playerId: "p1", amount: 500 });

    const stale = reduce(afterBid, { type: "PLACE_BID", playerId: "p2", amount: 500 }); // not strictly higher
    expect(stale.events).toHaveLength(0);
    expect(stale.state.pendingAuction?.bids).toHaveLength(1);

    const tooRich = reduce(afterBid, { type: "PLACE_BID", playerId: "p2", amount: 1_000 }); // exceeds p2's cash
    expect(tooRich.events).toHaveLength(0);
  });

  it("auction: a manual 'put up for auction' works even with auctionOnDecline OFF", () => {
    const state = makeState([makePlayer("p1", 0, { position: 1 }), makePlayer("p2", 1)], {
      settings: { ...DEFAULT_SETTINGS, auctionOnDecline: false },
      turnPhase: "awaiting_purchase",
    });
    const { state: next, events } = reduce(state, { type: "START_AUCTION", playerId: "p1" });
    expect(next.turnPhase).toBe("awaiting_auction");
    expect(next.pendingAuction?.spaceIndex).toBe(1);
    expect(events.some((e) => e.type === "AUCTION_STARTED" && e.manual === true)).toBe(true);
  });

  it("auction: no bids at all leaves the property with the bank", () => {
    const state = makeState([makePlayer("p1", 0, { position: 1 }), makePlayer("p2", 1)], {
      settings: { ...DEFAULT_SETTINGS, auctionOnDecline: true },
      turnPhase: "awaiting_purchase",
    });
    const { state: afterDecline } = reduce(state, { type: "DECLINE_BUY", playerId: "p1" });
    const { state: resolved, events } = reduce(afterDecline, { type: "RESOLVE_AUCTION_TIMEOUT" });
    expect(resolved.pendingAuction).toBeNull();
    expect(resolved.ownership[1]).toBeUndefined();
    expect(events.some((e) => e.type === "AUCTION_ENDED_NO_WINNER")).toBe(true);
  });

  it("CRITICAL: a player going bankrupt mid-auction never hangs the game — the auction reverts or ends", () => {
    // p2 is the high bidder, then goes bankrupt (voluntary quit) mid-auction;
    // the auction must revert to p3's lower bid, not freeze.
    const p1 = makePlayer("p1", 0, { position: 1, cashCents: 100_000 });
    const p2 = makePlayer("p2", 1, { cashCents: 100_000 });
    const p3 = makePlayer("p3", 2, { cashCents: 100_000 });
    const state = makeState([p1, p2, p3], {
      settings: { ...DEFAULT_SETTINGS, auctionOnDecline: true, allowManualBankruptcy: true },
      turnPhase: "awaiting_purchase",
    });
    const { state: afterDecline } = reduce(state, { type: "DECLINE_BUY", playerId: "p1" });
    const { state: afterP3 } = reduce(afterDecline, { type: "PLACE_BID", playerId: "p3", amount: 500 });
    const { state: afterP2 } = reduce(afterP3, { type: "PLACE_BID", playerId: "p2", amount: 1_000 });
    expect(afterP2.pendingAuction?.eligiblePlayerIds).toContain("p2");

    const { state: afterBankrupt, events } = reduce(afterP2, { type: "DECLARE_BANKRUPT", playerId: "p2" });
    expect(afterBankrupt.pendingAuction).not.toBeNull(); // still open — p3's bid can still win it
    expect(afterBankrupt.pendingAuction?.eligiblePlayerIds).toEqual(["p1", "p3"]);
    expect(events.some((e) => e.type === "AUCTION_BIDDER_DISQUALIFIED" && e.playerId === "p2")).toBe(true);

    const { state: resolved, events: resolveEvents } = reduce(afterBankrupt, { type: "RESOLVE_AUCTION_TIMEOUT" });
    expect(resolved.pendingAuction).toBeNull(); // never stuck
    expect(resolved.ownership[1]).toEqual({ ownerId: "p3", houses: 0, hotel: false, mortgaged: false });
    expect(resolveEvents.some((e) => e.type === "AUCTION_WON" && e.playerId === "p3" && e.amount === 500)).toBe(true);
  });

  it("CRITICAL: the auction ends outright once every eligible bidder has gone bankrupt", () => {
    // 3 players so the auction can be fully exhausted (all 3 bankrupt)
    // without the game itself ending early on a 2-player table.
    const p1 = makePlayer("p1", 0, { position: 1 });
    const p2 = makePlayer("p2", 1);
    const p3 = makePlayer("p3", 2);
    const state = makeState([p1, p2, p3], {
      settings: { ...DEFAULT_SETTINGS, auctionOnDecline: true, allowManualBankruptcy: true },
      turnPhase: "awaiting_purchase",
    });
    const { state: afterDecline } = reduce(state, { type: "DECLINE_BUY", playerId: "p1" });
    const { state: afterP1Bankrupt } = reduce(afterDecline, { type: "DECLARE_BANKRUPT", playerId: "p1" });
    expect(afterP1Bankrupt.pendingAuction).not.toBeNull();
    const { state: afterP2Bankrupt } = reduce(afterP1Bankrupt, { type: "DECLARE_BANKRUPT", playerId: "p2" });
    expect(afterP2Bankrupt.pendingAuction).not.toBeNull();
    const { state: afterP3Bankrupt, events } = reduce(afterP2Bankrupt, { type: "DECLARE_BANKRUPT", playerId: "p3" });
    // All three bankrupt -> the auction can never receive another bid, so
    // it must resolve itself rather than sit open forever.
    expect(afterP3Bankrupt.pendingAuction).toBeNull();
    expect(events.some((e) => e.type === "AUCTION_ENDED_NO_WINNER")).toBe(true);
  });

  it("a bankrupt player who wasn't part of any auction doesn't wipe out an unrelated player's pending debt", () => {
    // Real bug: resolveBankruptcy used to null out state.pendingDebt
    // unconditionally, even when the debt belonged to someone else
    // entirely — soft-locking the actual debtor in awaiting_payment.
    const debtor = makePlayer("p1", 0, { cashCents: 0 });
    const creditor = makePlayer("p2", 1, { cashCents: 0 });
    const bystander = makePlayer("p3", 2);
    const state = makeState([debtor, creditor, bystander], {
      settings: { ...DEFAULT_SETTINGS, allowManualBankruptcy: true },
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: 5_000, creditorId: "p2", reason: "rent" },
    });
    const { state: next } = reduce(state, { type: "DECLARE_BANKRUPT", playerId: "p3" });
    expect(next.pendingDebt).toEqual({ amount: 5_000, creditorId: "p2", reason: "rent" });
    expect(next.turnPhase).toBe("awaiting_payment");
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

// CRITICAL BUG audit (Section 1): every card whose effect pays or collects
// cash must actually move that cash AND log the exact amount. This was
// silently broken for the immediate (non-deferred) path on every
// cash-moving effect type — the money moved but no event was ever pushed to
// say so. One test per card, asserting the real cash delta against the
// card's own stated effect, not a re-derived expectation.
describe("card effects move exactly the cash they claim to (all 32 naija cards)", () => {
  const allCards = [...DECKS.treasure, ...DECKS.surprise];

  it("covers all 32 naija cards (16 treasure + 16 surprise)", () => {
    expect(DECKS.treasure).toHaveLength(16);
    expect(DECKS.surprise).toHaveLength(16);
    expect(allCards).toHaveLength(32);
  });

  for (const card of allCards) {
    it(`${card.id} (${card.deck}): "${card.text}"`, () => {
      const effect = card.effect;
      const startPosition = effect.type === "nearestTransport" || effect.type === "nearestUtility" ? 0 : 3;
      const you = makePlayer("a", 0, { position: startPosition });
      const b = makePlayer("b", 1);
      const c = makePlayer("c", 2);
      let state = makeState([you, b, c], {
        turnPhase: "awaiting_card",
        pendingCardDeck: card.deck,
      });

      // Repairs cards need owned, improved property to produce a nonzero
      // cost — Agege (index 1, brown) with 2 houses.
      if (effect.type === "repairs") {
        state = { ...state, ownership: { 1: { ownerId: "a", houses: 2, hotel: false, mortgaged: false } } };
      }

      const beforeCash = new Map(state.players.map((p) => [p.id, p.cashCents]));
      const { state: after, events } = reduce(state, { type: "DRAW_CARD", playerId: "a", cardId: card.id });
      const you2 = after.players.find((p) => p.id === "a")!;
      const delta = (id: string) => after.players.find((p) => p.id === id)!.cashCents - beforeCash.get(id)!;

      expect(events.some((e) => e.type === "CARD_DRAWN" && e.cardId === card.id)).toBe(true);

      switch (effect.type) {
        case "collect":
          expect(delta("a")).toBe(effect.amount);
          expect(
            events.some((e) => e.type === "CARD_CASH_COLLECTED" && e.playerId === "a" && e.amount === effect.amount),
          ).toBe(true);
          break;

        case "pay":
          expect(delta("a")).toBe(-effect.amount);
          expect(
            events.some((e) => e.type === "CARD_CASH_PAID" && e.playerId === "a" && e.amount === effect.amount),
          ).toBe(true);
          break;

        case "collectFromEach": {
          const total = effect.amount * 2;
          expect(delta("a")).toBe(total);
          expect(delta("b")).toBe(-effect.amount);
          expect(delta("c")).toBe(-effect.amount);
          expect(
            events.some(
              (e) =>
                e.type === "CARD_CASH_COLLECTED_FROM_EACH" &&
                e.playerId === "a" &&
                e.amountPerPlayer === effect.amount &&
                e.totalAmount === total,
            ),
          ).toBe(true);
          break;
        }

        case "payEach": {
          const total = effect.amount * 2;
          expect(delta("a")).toBe(-total);
          expect(delta("b")).toBe(effect.amount);
          expect(delta("c")).toBe(effect.amount);
          expect(
            events.some(
              (e) =>
                e.type === "CARD_CASH_PAID_TO_EACH" &&
                e.playerId === "a" &&
                e.amountPerPlayer === effect.amount &&
                e.totalAmount === total,
            ),
          ).toBe(true);
          break;
        }

        case "repairs": {
          const expectedCost = 2 * effect.perHouse;
          expect(delta("a")).toBe(-expectedCost);
          expect(
            events.some((e) => e.type === "CARD_CASH_PAID" && e.playerId === "a" && e.amount === expectedCost),
          ).toBe(true);
          break;
        }

        case "jailFree":
          expect(delta("a")).toBe(0);
          expect(you2.jailFreeCards).toBe(1);
          expect(events.some((e) => e.type === "CARD_JAIL_FREE_RECEIVED" && e.playerId === "a")).toBe(true);
          break;

        case "goToJail":
          expect(delta("a")).toBe(0);
          expect(you2.inJail).toBe(true);
          expect(events.some((e) => e.type === "SENT_TO_JAIL" && e.playerId === "a")).toBe(true);
          break;

        case "moveTo":
          expect(you2.position).toBe(effect.to);
          expect(delta("a")).toBe(effect.passGoPays ? GO_SALARY : 0);
          break;

        case "moveBack":
          expect(you2.position).toBe(((startPosition - effect.spaces) % 40 + 40) % 40);
          expect(delta("a")).toBe(0);
          break;

        case "nearestTransport":
        case "nearestUtility":
          // Target is unowned in this setup (awaiting_purchase), and
          // starting at position 0 never wraps past GO — no cash moves.
          expect(delta("a")).toBe(0);
          break;
      }
    });
  }
});

describe("Section 1 event-vocabulary regressions", () => {
  it("nearestTransport rent on an OWNED target is actually charged AND logged", () => {
    const owner = makePlayer("owner", 1, { cashCents: 0 });
    const player = makePlayer("a", 0, { position: 0 });
    const state = makeState([player, owner], {
      turnPhase: "awaiting_card",
      pendingCardDeck: "surprise",
      ownership: { 5: { ownerId: "owner", houses: 0, hotel: false, mortgaged: false } },
    });
    const card = DECKS.surprise.find((c) => c.effect.type === "nearestTransport")!;
    const { state: next, events } = reduce(state, { type: "DRAW_CARD", playerId: "a", cardId: card.id });

    const expectedRent = 3_000 * 2; // TRANSPORT_RENT[0] ($30) * rentMultiplier(2)
    expect(next.players[0].cashCents).toBe(150_000 - expectedRent);
    expect(next.players[1].cashCents).toBe(expectedRent);
    expect(
      events.some(
        (e) => e.type === "RENT_PAID" && e.payerId === "a" && e.payeeId === "owner" && e.amount === expectedRent && e.spaceIndex === 5,
      ),
    ).toBe(true);
  });

  it("a deferred card debt, once paid off, logs CARD_CASH_PAID (not silently)", () => {
    const player = makePlayer("a", 0, { position: 3, cashCents: 0 });
    const other = makePlayer("b", 1);
    const state = makeState([player, other], {
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: 5_000, creditorId: "bank", reason: "card" },
    });
    const funded = { ...state, players: [{ ...player, cashCents: 5_000 }, other] };
    const { state: next, events } = reduce(funded, { type: "PAY_RENT", playerId: "a" });

    expect(next.pendingDebt).toBeNull();
    expect(next.players[0].cashCents).toBe(0);
    expect(events.some((e) => e.type === "CARD_CASH_PAID" && e.playerId === "a" && e.amount === 5_000)).toBe(true);
  });

  it("TAX_PAID names the space landed on", () => {
    // Customs Duty is space 38, flat $100 — land there via a roll from 30+8.
    const state = makeState([makePlayer("a", 0, { position: 30, cashCents: 100_000 }), makePlayer("b", 1)]);
    const { events } = reduce(state, { type: "ROLL", playerId: "a", d1: 3, d2: 5 }); // 30 + 8 = 38
    expect(events.some((e) => e.type === "TAX_PAID" && e.spaceIndex === 38 && e.amount === 10_000)).toBe(true);
  });

  it("MORTGAGED/UNMORTGAGED log the actual cash amount", () => {
    const state = makeState([makePlayer("p1", 0, { cashCents: 100_000 }), makePlayer("p2", 1)], {
      turnPhase: "awaiting_end_turn",
      ownership: { 1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false } }, // Agege, price $50 -> mortgageValue 2_500
    });
    const mortgaged = reduce(state, { type: "MORTGAGE", playerId: "p1", spaceIndex: 1 });
    expect(mortgaged.events.some((e) => e.type === "MORTGAGED" && e.amount === 2_500)).toBe(true);

    const unmortgaged = reduce(mortgaged.state, { type: "UNMORTGAGE", playerId: "p1", spaceIndex: 1 });
    expect(unmortgaged.events.some((e) => e.type === "UNMORTGAGED" && e.amount === 2_750)).toBe(true); // 2_500 * 1.1
  });

  it("HOUSE_BUILT/HOUSE_SOLD log the price paid/received", () => {
    const state = makeState([makePlayer("p1", 0, { cashCents: 100_000 }), makePlayer("p2", 1)], {
      turnPhase: "awaiting_end_turn",
      ownership: {
        1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
        3: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
      },
    });
    const built = reduce(state, { type: "BUILD_HOUSE", playerId: "p1", spaceIndex: 1 });
    expect(built.events.some((e) => e.type === "HOUSE_BUILT" && e.price === 5_000)).toBe(true); // brown houseCost $50

    const sold = reduce(built.state, { type: "SELL_HOUSE", playerId: "p1", spaceIndex: 1 });
    expect(sold.events.some((e) => e.type === "HOUSE_SOLD" && e.amount === 2_500)).toBe(true); // half of $50
  });

  it("TRADE_ACCEPTED carries the full give/receive offer, not just player ids", () => {
    const p1 = makePlayer("p1", 0, { cashCents: 50_000 });
    const p2 = makePlayer("p2", 1, { cashCents: 50_000 });
    const state = makeState([p1, p2], {
      turnPhase: "awaiting_end_turn",
      ownership: {
        1: { ownerId: "p1", houses: 0, hotel: false, mortgaged: false },
        6: { ownerId: "p2", houses: 0, hotel: false, mortgaged: false },
      },
    });
    const give = { cashCents: 0, spaceIndexes: [1], jailFreeCards: 0 };
    const receive = { cashCents: 5_000, spaceIndexes: [6], jailFreeCards: 0 };
    const { events } = reduce(state, {
      type: "EXECUTE_ACCEPTED_TRADE",
      playerId: "p2",
      fromPlayerId: "p1",
      toPlayerId: "p2",
      give,
      receive,
    });
    expect(events.some((e) => e.type === "TRADE_ACCEPTED" && e.give === give && e.receive === receive)).toBe(true);
  });
});

describe("FORCE_END_TURN — Section 3 turn watchdog (the game must never deadlock)", () => {
  it("awaiting_roll / awaiting_end_turn: skips the stuck player's turn, as before", () => {
    const state = makeState([makePlayer("p1", 0), makePlayer("p2", 1)], { turnPhase: "awaiting_roll" });
    const { state: next, events } = reduce(state, { type: "FORCE_END_TURN", playerId: "p1" });
    expect(next.currentPlayerIndex).toBe(1);
    expect(events.some((e) => e.type === "TURN_TIMED_OUT" && e.playerId === "p1")).toBe(true);
  });

  it("awaiting_purchase: auto-declines the stuck purchase decision (respecting auctionOnDecline)", () => {
    const state = makeState([makePlayer("p1", 0, { position: 1 }), makePlayer("p2", 1)], {
      turnPhase: "awaiting_purchase",
      settings: { ...DEFAULT_SETTINGS, auctionOnDecline: true },
    });
    const { state: next, events } = reduce(state, { type: "FORCE_END_TURN", playerId: "p1" });
    expect(next.turnPhase).toBe("awaiting_auction"); // declined straight into the auction
    expect(next.ownership[1]).toBeUndefined();
    expect(events.some((e) => e.type === "TURN_TIMED_OUT")).toBe(true);
    expect(events.some((e) => e.type === "PROPERTY_DECLINED")).toBe(true);
  });

  it("awaiting_payment: forces the stuck debtor bankrupt rather than freezing the game forever", () => {
    const debtor = makePlayer("p1", 0, { cashCents: 0 });
    const creditor = makePlayer("p2", 1);
    const state = makeState([debtor, creditor], {
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: 5_000, creditorId: "p2", reason: "rent" },
    });
    const { state: next, events } = reduce(state, { type: "FORCE_END_TURN", playerId: "p1" });
    expect(next.players[0].bankrupt).toBe(true);
    expect(next.pendingDebt).toBeNull();
    expect(events.some((e) => e.type === "TURN_TIMED_OUT")).toBe(true);
    expect(events.some((e) => e.type === "PLAYER_BANKRUPT" && e.playerId === "p1")).toBe(true);
  });

  it("awaiting_card / awaiting_auction: deliberately left alone (no safe forced move)", () => {
    const cardState = makeState([makePlayer("p1", 0), makePlayer("p2", 1)], {
      turnPhase: "awaiting_card",
      pendingCardDeck: "treasure",
    });
    expect(reduce(cardState, { type: "FORCE_END_TURN", playerId: "p1" }).events).toHaveLength(0);

    const auctionState = makeState([makePlayer("p1", 0), makePlayer("p2", 1)], {
      turnPhase: "awaiting_auction",
      pendingAuction: { spaceIndex: 1, eligiblePlayerIds: ["p1", "p2"], bids: [] },
    });
    expect(reduce(auctionState, { type: "FORCE_END_TURN", playerId: "p1" }).events).toHaveLength(0);
  });
});
