// Drives buildLines with REAL reduce()/GameEvent output (never hand-built
// payloads) so this test proves the actual engine+renderer pipeline
// produces the exact sentences Section 1 asked for — not just that some
// isolated formatter function does.

import { describe, expect, it } from "vitest";
import { reduce, type GameAction, type GameEvent } from "@/game/engine";
import { MAPS } from "@/game/maps";
import { DEFAULT_SETTINGS, type GameState, type PlayerState, type PlayerToken } from "@/game/types";
import { formatCAD } from "@/lib/money";
import { PLAYER_COLORS } from "@/lib/player-colors";
import { buildLines, type EventRow } from "./event-log-format";

const BOARD = MAPS.naija.spaces;
const DECKS = MAPS.naija.decks;
const JAIL_LABEL = MAPS.naija.jailLabel; // "Kirikiri"
const DECK_LABELS = MAPS.naija.deckLabels; // { treasure: "Owambe", surprise: "Village People" }

function makePlayer(id: string, name: string, seatIndex: number, overrides: Partial<PlayerState> = {}): PlayerState {
  const tokens: PlayerToken[] = ["danfo", "keke", "jollof", "gele"];
  return {
    id,
    name,
    token: tokens[seatIndex % tokens.length],
    color: PLAYER_COLORS[seatIndex % PLAYER_COLORS.length],
    seatIndex,
    cashCents: 150_000,
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

function toRows(events: GameEvent[], startSeq = 1): EventRow[] {
  return events.map((e, i) => ({ seq: startSeq + i, type: e.type, payload: e as unknown as Record<string, unknown> }));
}

function run(state: GameState, action: GameAction) {
  const { state: next, events } = reduce(state, action);
  const lines = buildLines(toRows(events), next.players, BOARD, JAIL_LABEL, DECK_LABELS);
  return { next, events, lines, texts: lines.map((l) => l.text) };
}

describe("event log vocabulary — WHO, WHAT, HOW MUCH", () => {
  it("rolls and lands on an unowned property, then buys it", () => {
    const davido = makePlayer("d", "Davido", 0, { position: 8 }); // Yaba
    const state = makeState([davido, makePlayer("y", "Yinka", 1)]);

    const rolled = run(state, { type: "ROLL", playerId: "d", d1: 2, d2: 3 }); // 8+5=13 Ogba
    expect(rolled.texts).toEqual(["Davido rolled 5 and landed on Ogba."]);

    const bought = run(rolled.next, { type: "BUY", playerId: "d" });
    expect(bought.texts).toEqual(["Davido bought Ogba for $130."]);
  });

  it("declines an unowned property (bank keeps it)", () => {
    const davido = makePlayer("d", "Davido", 0, { position: 13 });
    const state = makeState([davido, makePlayer("y", "Yinka", 1)], { turnPhase: "awaiting_purchase" });

    const declined = run(state, { type: "DECLINE_BUY", playerId: "d" });
    expect(declined.texts).toEqual(["Davido declined Ogba. It stays with the bank."]);
  });

  it("puts an unowned property up for auction, which Yinka wins", () => {
    const davido = makePlayer("d", "Davido", 0, { position: 13 });
    const yinka = makePlayer("y", "Yinka", 1, { cashCents: 10_000 });
    const state = makeState([davido, yinka], {
      turnPhase: "awaiting_purchase",
      settings: { ...DEFAULT_SETTINGS, auctionsEnabled: true },
    });

    const declined = run(state, { type: "START_AUCTION", playerId: "d" });
    expect(declined.texts).toEqual(["Davido declined Ogba. It's up for auction.", "Ogba is up for auction."]);

    const bid = run(declined.next, { type: "PLACE_BID", playerId: "y", amount: 8_500 });
    expect(bid.texts).toEqual(["Yinka bid $85."]);

    const resolved = run(bid.next, { type: "RESOLVE_AUCTION_TIMEOUT" });
    expect(resolved.texts).toEqual(["Yinka won the auction for Ogba at $85."]);
  });

  it("a doubles roll calls out the reroll", () => {
    const yinka = makePlayer("y", "Yinka", 0, { position: 0 });
    const state = makeState([yinka, makePlayer("d", "Davido", 1)]);

    const rolled = run(state, { type: "ROLL", playerId: "y", d1: 5, d2: 5 }); // 0+10=10, jail (just visiting)
    expect(rolled.texts).toEqual(["Yinka rolled 10 (5 and 5) and landed on Kirikiri. Doubles — rolling again."]);
  });

  it("a card that collects cash reads as one line with the amount", () => {
    const davido = makePlayer("d", "Davido", 0);
    const card = DECKS.treasure.find((c) => c.id === "owambe-1")!; // collect $200
    const state = makeState([davido, makePlayer("y", "Yinka", 1)], {
      turnPhase: "awaiting_card",
      pendingCardDeck: "treasure",
    });

    const drawn = run(state, { type: "DRAW_CARD", playerId: "d", cardId: card.id });
    expect(drawn.texts).toEqual([`Davido drew a Owambe card: ${card.text} Collected $200.`]);
  });

  it("a card that charges cash reads as one line with the amount", () => {
    const davido = makePlayer("d", "Davido", 0);
    const card = DECKS.surprise.find((c) => c.id === "village-4")!; // pay $50
    const state = makeState([davido, makePlayer("y", "Yinka", 1)], {
      turnPhase: "awaiting_card",
      pendingCardDeck: "surprise",
    });

    const drawn = run(state, { type: "DRAW_CARD", playerId: "d", cardId: card.id });
    expect(drawn.texts).toEqual([`Davido drew a Village People card: ${card.text} Paid $50.`]);
  });

  it("a collectFromEach card states the per-player amount and the total", () => {
    const davido = makePlayer("d", "Davido", 0);
    const card = DECKS.treasure.find((c) => c.id === "owambe-6")!; // collectFromEach $10
    const state = makeState(
      [davido, makePlayer("y", "Yinka", 1), makePlayer("s", "Sonofdavid", 2), makePlayer("b", "Bob", 3)],
      { turnPhase: "awaiting_card", pendingCardDeck: "treasure" },
    );

    const drawn = run(state, { type: "DRAW_CARD", playerId: "d", cardId: card.id });
    expect(drawn.texts).toEqual([
      `Davido drew a Owambe card: ${card.text} Collected $10 from each player — $30 total.`,
    ]);
  });

  it("a payEach card states the per-player amount and the total", () => {
    const davido = makePlayer("d", "Davido", 0);
    const card = DECKS.surprise.find((c) => c.id === "village-15")!; // payEach $50
    const state = makeState(
      [davido, makePlayer("y", "Yinka", 1), makePlayer("s", "Sonofdavid", 2), makePlayer("b", "Bob", 3)],
      { turnPhase: "awaiting_card", pendingCardDeck: "surprise" },
    );

    const drawn = run(state, { type: "DRAW_CARD", playerId: "d", cardId: card.id });
    expect(drawn.texts).toEqual([
      `Davido drew a Village People card: ${card.text} Paid each player $50 — $150 total.`,
    ]);
  });

  it("a moveTo card that pays GO folds the GO salary into the same line", () => {
    const davido = makePlayer("d", "Davido", 0, { position: 20 });
    const card = DECKS.treasure.find((c) => c.id === "owambe-12")!; // moveTo GO, passGoPays: true
    const state = makeState([davido, makePlayer("y", "Yinka", 1)], {
      turnPhase: "awaiting_card",
      pendingCardDeck: "treasure",
    });
    const drawn = run(state, { type: "DRAW_CARD", playerId: "d", cardId: card.id });
    expect(drawn.texts).toEqual([`Davido drew a Owambe card: ${card.text} Passed GO and collected $200. Landed on GO.`]);
  });

  it("rent is paid and named with the exact space and amount", () => {
    const owner = makePlayer("y", "Yinka", 1, { cashCents: 0 });
    const davido = makePlayer("d", "Davido", 0, { position: 18 }); // 18 + 3 = 21 (Nassarawa GRA, Kano)
    const state = makeState([davido, owner], {
      ownership: { 21: { ownerId: "y", houses: 0, hotel: false, mortgaged: false } },
    });
    const rolled = run(state, { type: "ROLL", playerId: "d", d1: 1, d2: 2 });
    expect(rolled.texts).toEqual([
      "Davido rolled 3 and landed on Nassarawa GRA, Kano.",
      `Davido paid Yinka ${expectRent(state, 21)} rent on Nassarawa GRA, Kano.`,
    ]);
  });

  it("tax is paid and names the tax space", () => {
    const davido = makePlayer("d", "Davido", 0, { position: 30 }); // 30 + 8 = 38, Customs Duty ($100 flat)
    const state = makeState([davido, makePlayer("y", "Yinka", 1)]);
    const rolled = run(state, { type: "ROLL", playerId: "d", d1: 3, d2: 5 });
    expect(rolled.texts).toEqual(["Davido rolled 8 and landed on Customs Duty.", "Davido paid $100 Customs Duty to the bank."]);
  });

  it("building a house states the price and the running count", () => {
    const state = makeState([makePlayer("d", "Davido", 0), makePlayer("y", "Yinka", 1)], {
      turnPhase: "awaiting_end_turn",
      ownership: {
        26: { ownerId: "d", houses: 0, hotel: false, mortgaged: false }, // Lekki Phase 1
        27: { ownerId: "d", houses: 0, hotel: false, mortgaged: false }, // Oniru
        29: { ownerId: "d", houses: 0, hotel: false, mortgaged: false }, // Wuse II, Abuja
      },
    });
    let s = state;
    for (const idx of [26, 27, 29]) {
      s = reduce(s, { type: "BUILD_HOUSE", playerId: "d", spaceIndex: idx }).state;
    }
    const built = run(s, { type: "BUILD_HOUSE", playerId: "d", spaceIndex: 26 });
    expect(built.texts).toEqual(["Davido built a house on Lekki Phase 1 for $150. Now 2 houses."]);
  });

  it("mortgaging and unmortgaging state the cash amount with sign", () => {
    const state = makeState([makePlayer("d", "Davido", 0), makePlayer("y", "Yinka", 1)], {
      turnPhase: "awaiting_end_turn",
      ownership: { 13: { ownerId: "d", houses: 0, hotel: false, mortgaged: false } }, // Ogba, $130
    });
    const mortgaged = run(state, { type: "MORTGAGE", playerId: "d", spaceIndex: 13 });
    expect(mortgaged.texts).toEqual(["Davido mortgaged Ogba for +$65."]);

    const unmortgaged = run(mortgaged.next, { type: "UNMORTGAGE", playerId: "d", spaceIndex: 13 });
    expect(unmortgaged.texts).toEqual(["Davido unmortgaged Ogba for -$71.50."]);
  });

  it("landing on Go To Jail reads as one sentence, roll through sent-to-jail", () => {
    const davido = makePlayer("d", "Davido", 0, { position: 24 });
    const state = makeState([davido, makePlayer("y", "Yinka", 1)]);
    const rolled = run(state, { type: "ROLL", playerId: "d", d1: 2, d2: 4 }); // 24+6=30 (Go To Jail)
    expect(rolled.texts).toEqual([`Davido rolled 6 and landed on Go To Jail — sent to ${JAIL_LABEL}.`]);
  });

  it("three doubles in a row sends the player to jail", () => {
    const davido = makePlayer("d", "Davido", 0, { position: 5 });
    const state = makeState([davido, makePlayer("y", "Yinka", 1)], { doublesCount: 2 });
    const rolled = run(state, { type: "ROLL", playerId: "d", d1: 6, d2: 6 });
    expect(rolled.texts).toEqual([`Davido rolled 12 (6 and 6) — three doubles in a row, sent to ${JAIL_LABEL}.`]);
  });

  it("escaping jail via doubles is its own sentence", () => {
    const davido = makePlayer("d", "Davido", 0, { position: 10, inJail: true, jailTurns: 1 });
    const state = makeState([davido, makePlayer("y", "Yinka", 1)]);
    const rolled = run(state, { type: "ROLL", playerId: "d", d1: 4, d2: 4 });
    expect(rolled.texts).toEqual([`Davido rolled doubles and left ${JAIL_LABEL}.`]);
  });

  it("paying the jail fine voluntarily is named with the amount", () => {
    const davido = makePlayer("d", "Davido", 0, { position: 10, inJail: true, jailTurns: 1, cashCents: 10_000 });
    const state = makeState([davido, makePlayer("y", "Yinka", 1)]);
    const paid = run(state, { type: "PAY_JAIL_FINE", playerId: "d" });
    expect(paid.texts).toEqual([`Davido paid the $50 fine and left ${JAIL_LABEL}.`]);
  });

  it("using a jail-free card is named clearly", () => {
    const davido = makePlayer("d", "Davido", 0, { position: 10, inJail: true, jailTurns: 1, jailFreeCards: 1 });
    const state = makeState([davido, makePlayer("y", "Yinka", 1)]);
    const used = run(state, { type: "USE_JAIL_FREE", playerId: "d" });
    expect(used.texts).toEqual([`Davido used a Get Out card and left ${JAIL_LABEL}.`]);
  });

  it("the forced 3rd-turn fine is named with the amount, merged into the roll", () => {
    const davido = makePlayer("d", "Davido", 0, { position: 10, inJail: true, jailTurns: 2, cashCents: 10_000 });
    const state = makeState([davido, makePlayer("y", "Yinka", 1)]);
    const rolled = run(state, { type: "ROLL", playerId: "d", d1: 2, d2: 5 });
    expect(rolled.texts[0]).toBe(`Davido paid the $50 fine and left ${JAIL_LABEL}.`);
  });

  it("an accepted trade states exactly what each side gave up", () => {
    const davido = makePlayer("d", "Davido", 0, { cashCents: 50_000 });
    const yinka = makePlayer("y", "Yinka", 1, { cashCents: 50_000 });
    const state = makeState([davido, yinka], {
      turnPhase: "awaiting_end_turn",
      ownership: {
        13: { ownerId: "d", houses: 0, hotel: false, mortgaged: false }, // Ogba
        32: { ownerId: "y", houses: 0, hotel: false, mortgaged: false }, // Ikoyi
      },
    });
    const traded = run(state, {
      type: "EXECUTE_ACCEPTED_TRADE",
      playerId: "y",
      fromPlayerId: "d",
      toPlayerId: "y",
      give: { cashCents: 20_000, spaceIndexes: [13], jailFreeCards: 0 },
      receive: { cashCents: 0, spaceIndexes: [32], jailFreeCards: 0 },
    });
    expect(traded.texts).toEqual(["Davido and Yinka agreed a trade: Ogba + $200 for Ikoyi."]);
  });

  it("bankruptcy names who the assets transferred to", () => {
    const davido = makePlayer("d", "Davido", 0, { cashCents: 0 });
    const yinka = makePlayer("y", "Yinka", 1);
    const state = makeState([davido, yinka], {
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: 5_000, creditorId: "y", reason: "rent" },
    });
    const bankrupt = run(state, { type: "DECLARE_BANKRUPT", playerId: "d" });
    expect(bankrupt.texts).toContain("Davido is bankrupt. All assets transferred to Yinka.");
  });

  it("bankruptcy to the bank (transfers off) says so", () => {
    const davido = makePlayer("d", "Davido", 0, { cashCents: 0 });
    const yinka = makePlayer("y", "Yinka", 1);
    const state = makeState([davido, yinka], {
      turnPhase: "awaiting_payment",
      pendingDebt: { amount: 5_000, creditorId: "y", reason: "rent" },
      settings: { ...DEFAULT_SETTINGS, bankruptcyTransfersAssets: false },
      ownership: { 13: { ownerId: "d", houses: 0, hotel: false, mortgaged: false } },
    });
    const bankrupt = run(state, { type: "DECLARE_BANKRUPT", playerId: "d" });
    expect(bankrupt.texts).toContain("Davido is bankrupt. Assets returned to the bank.");
  });

  it("a Free Parking skip names who missed their turn", () => {
    const davido = makePlayer("d", "Davido", 0, { skipNextTurn: true });
    const yinka = makePlayer("y", "Yinka", 1);
    const state = makeState([davido, yinka], {
      currentPlayerIndex: 1,
      turnPhase: "awaiting_end_turn",
      settings: { ...DEFAULT_SETTINGS, freeParkingSkipsTurn: true },
    });
    const ended = run(state, { type: "END_TURN", playerId: "y" });
    expect(ended.texts).toContain(`Davido misses this turn — landed on ${MAPS.naija.freeParkingLabel} last time.`);
  });
});

function expectRent(_state: GameState, spaceIndex: number): string {
  const space = BOARD[spaceIndex];
  if (space.type !== "property") throw new Error("not a property");
  return formatCAD(space.rent[0]);
}
