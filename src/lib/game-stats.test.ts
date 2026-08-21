import { describe, expect, it } from "vitest";
import { computeGameStats, type StatEvent } from "./game-stats";

function ev(type: string, payload: Record<string, unknown> = {}): StatEvent {
  return { type, payload };
}

describe("computeGameStats", () => {
  it("counts turns from TURN_ENDED and passes through the given roll count", () => {
    const stats = computeGameStats([ev("TURN_ENDED"), ev("TURN_ENDED"), ev("TURN_ENDED")], 42);
    expect(stats.totalTurns).toBe(3);
    expect(stats.totalRolls).toBe(42);
  });

  it("finds the biggest single rent payment", () => {
    const stats = computeGameStats(
      [
        ev("RENT_PAID", { payerId: "p1", payeeId: "p2", amount: 500 }),
        ev("RENT_PAID", { payerId: "p2", payeeId: "p1", amount: 2000 }),
        ev("RENT_PAID", { payerId: "p1", payeeId: "p2", amount: 800 }),
      ],
      0,
    );
    expect(stats.biggestRent).toEqual({ payerId: "p2", payeeId: "p1", amount: 2000 });
  });

  it("finds the most-landed-on space", () => {
    const stats = computeGameStats(
      [ev("MOVED", { to: 5 }), ev("MOVED", { to: 12 }), ev("MOVED", { to: 5 }), ev("MOVED", { to: 5 }), ev("MOVED", { to: 12 })],
      0,
    );
    expect(stats.mostLandedSpaceIndex).toBe(5);
  });

  it("counts completed trades", () => {
    const stats = computeGameStats([ev("TRADE_ACCEPTED"), ev("TRADE_DECLINED"), ev("TRADE_ACCEPTED")], 0);
    expect(stats.totalTradesCompleted).toBe(2);
  });

  it("finds the longest jail stay by counting a player's own ROLLED events between SENT_TO_JAIL and JAIL_ESCAPED", () => {
    const stats = computeGameStats(
      [
        ev("SENT_TO_JAIL", { playerId: "p1" }),
        ev("ROLLED", { playerId: "p2" }), // someone else's roll shouldn't count
        ev("ROLLED", { playerId: "p1" }),
        ev("ROLLED", { playerId: "p1" }),
        ev("JAIL_ESCAPED", { playerId: "p1", method: "fine" }),
        ev("SENT_TO_JAIL", { playerId: "p2" }),
        ev("ROLLED", { playerId: "p2" }),
        ev("JAIL_ESCAPED", { playerId: "p2", method: "doubles" }),
      ],
      0,
    );
    expect(stats.longestJailStay).toEqual({ playerId: "p1", rollsSpentJailed: 2 });
  });

  it("sums bank-facing amounts into totalMoneyThroughBank", () => {
    const stats = computeGameStats(
      [
        ev("PASSED_GO", { amount: 20000 }),
        ev("TAX_PAID", { amount: 20000 }),
        ev("PROPERTY_PURCHASED", { price: 6000 }),
        ev("FREE_PARKING_PAID", { amount: 5000 }),
        ev("AUCTION_WON", { amount: 3000 }),
        ev("RENT_PAID", { amount: 999 }), // not bank money — shouldn't count
      ],
      0,
    );
    expect(stats.totalMoneyThroughBank).toBe(20000 + 20000 + 6000 + 5000 + 3000);
  });

  it("returns nulls for stats with no data", () => {
    const stats = computeGameStats([], 0);
    expect(stats.biggestRent).toBeNull();
    expect(stats.mostLandedSpaceIndex).toBeNull();
    expect(stats.longestJailStay).toBeNull();
    expect(stats.totalTradesCompleted).toBe(0);
  });
});
