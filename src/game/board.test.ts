import { describe, expect, it } from "vitest";
import { makeProperty, makeTax } from "./board";

// Per-map structural assertions (40 spaces, region shape, rent monotonicity,
// deck sizes, ...) live in src/game/maps/maps.test.ts, run against every
// map. This file tests the shared, map-agnostic builder functions
// themselves.

describe("makeProperty", () => {
  it("computes mortgage/unmortgage as integer cents with no float drift", () => {
    // regression check: naive `mortgageValue * 1.1` produces 3025.0000000000005
    // in JS floats for a $55 property, which would wrongly ceil to 3026.
    const space = makeProperty(3, "Test St", "brown", 55, ["TEST ST"]);
    expect(space.mortgageValue).toBe(2750);
    expect(space.unmortgageCost).toBe(3025);
  });

  it("always produces integer mortgage/unmortgage values", () => {
    for (const price of [50, 60, 90, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 350, 380, 400]) {
      const space = makeProperty(1, "Test St", "brown", price, ["TEST ST"]);
      expect(Number.isInteger(space.mortgageValue)).toBe(true);
      expect(Number.isInteger(space.unmortgageCost)).toBe(true);
    }
  });

  it("produces strictly increasing rent tiers", () => {
    for (const price of [50, 60, 90, 120, 200, 400]) {
      const space = makeProperty(1, "Test St", "brown", price, ["TEST ST"]);
      for (let i = 1; i < space.rent.length; i++) {
        expect(space.rent[i]).toBeGreaterThan(space.rent[i - 1]);
      }
    }
  });
});

describe("makeTax", () => {
  it("produces a flat, integer-cents charge", () => {
    const space = makeTax(38, "Luxury Tax", 100, ["LUXURY TAX"]);
    expect(space.amount).toBe(10_000);
  });
});
