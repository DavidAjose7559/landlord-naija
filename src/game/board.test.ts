import { describe, expect, it } from "vitest";
import { BOARD, type ColorGroup, type PropertySpace } from "./board";

function isProperty(space: (typeof BOARD)[number]): space is PropertySpace {
  return space.type === "property";
}

describe("BOARD", () => {
  it("has exactly 40 spaces", () => {
    expect(BOARD.length).toBe(40);
  });

  it("has indexes 0-39 in order", () => {
    BOARD.forEach((space, i) => {
      expect(space.index).toBe(i);
    });
  });

  it("has the correct colour group counts", () => {
    const expected: Record<ColorGroup, number> = {
      brown: 2,
      lightblue: 3,
      pink: 3,
      orange: 3,
      red: 3,
      yellow: 3,
      green: 3,
      darkblue: 2,
    };

    const counts: Record<string, number> = {};
    for (const space of BOARD.filter(isProperty)) {
      counts[space.color] = (counts[space.color] ?? 0) + 1;
    }

    expect(counts).toEqual(expected);
  });

  it("has exactly 4 transport spaces", () => {
    expect(BOARD.filter((s) => s.type === "transport").length).toBe(4);
  });

  it("has exactly 2 utility spaces", () => {
    expect(BOARD.filter((s) => s.type === "utility").length).toBe(2);
  });

  it("has exactly 3 owambe card spaces and 3 village card spaces", () => {
    const cardSpaces = BOARD.filter((s) => s.type === "card");
    expect(cardSpaces.filter((s) => "deck" in s && s.deck === "owambe").length).toBe(3);
    expect(cardSpaces.filter((s) => "deck" in s && s.deck === "village").length).toBe(3);
  });

  it("has exactly 2 tax spaces", () => {
    expect(BOARD.filter((s) => s.type === "tax").length).toBe(2);
  });

  it("has rent tiers that strictly increase for every property", () => {
    for (const space of BOARD.filter(isProperty)) {
      for (let i = 1; i < space.rent.length; i++) {
        expect(space.rent[i]).toBeGreaterThan(space.rent[i - 1]);
      }
    }
  });

  it("computes mortgage/unmortgage as integer cents with no float drift", () => {
    // regression check: naive `mortgageValue * 1.1` produces 3025.0000000000005
    // in JS floats for Mushin ($55), which would wrongly ceil to 3026.
    const mushin = BOARD[3] as PropertySpace;
    expect(mushin.mortgageValue).toBe(2750);
    expect(mushin.unmortgageCost).toBe(3025);

    for (const space of BOARD) {
      if ("mortgageValue" in space) {
        expect(Number.isInteger(space.mortgageValue)).toBe(true);
        expect(Number.isInteger(space.unmortgageCost)).toBe(true);
      }
    }
  });
});
