import { describe, expect, it } from "vitest";
import type { PropertySpace } from "../board";
import { MAP_LIST } from "./index";

describe.each(MAP_LIST)("map: $id ($name)", (map) => {
  it("has exactly 40 spaces, indexed 0-39 in order", () => {
    expect(map.spaces).toHaveLength(40);
    map.spaces.forEach((space, i) => expect(space.index).toBe(i));
  });

  it("has the correct space-type counts (identical skeleton across every map)", () => {
    const counts: Record<string, number> = {};
    for (const space of map.spaces) {
      counts[space.type] = (counts[space.type] ?? 0) + 1;
    }
    expect(counts.go).toBe(1);
    expect(counts.jail).toBe(1);
    expect(counts.free).toBe(1);
    expect(counts.gotojail).toBe(1);
    expect(counts.transport).toBe(4);
    expect(counts.utility).toBe(2);
    expect(counts.tax).toBe(2);
    expect(counts.property).toBe(22);

    const cardSpaces = map.spaces.filter((s) => s.type === "card");
    expect(cardSpaces.filter((s) => "deck" in s && s.deck === "treasure")).toHaveLength(3);
    expect(cardSpaces.filter((s) => "deck" in s && s.deck === "surprise")).toHaveLength(3);
  });

  it("has 8 regions sized 2/3/3/3/3/3/3/2, covering every property exactly once", () => {
    expect(map.regions).toHaveLength(8);
    const sizes = map.regions.map((r) => r.spaceIndexes.length).sort((a, b) => a - b);
    expect(sizes).toEqual([2, 2, 3, 3, 3, 3, 3, 3]);

    const allIndexes = map.regions.flatMap((r) => r.spaceIndexes);
    expect(new Set(allIndexes).size).toBe(allIndexes.length); // no overlaps
    const propertyIndexes = map.spaces.filter((s) => s.type === "property").map((s) => s.index);
    expect([...allIndexes].sort((a, b) => a - b)).toEqual([...propertyIndexes].sort((a, b) => a - b));
  });

  it("has strictly increasing rent tiers for every property", () => {
    for (const space of map.spaces.filter((s): s is PropertySpace => s.type === "property")) {
      for (let i = 1; i < space.rent.length; i++) {
        expect(space.rent[i]).toBeGreaterThan(space.rent[i - 1]);
      }
    }
  });

  it("has a choice tax at index 4 and a flat tax at index 38", () => {
    const incomeTax = map.spaces[4];
    const luxuryTax = map.spaces[38];
    expect(incomeTax.type).toBe("tax");
    expect(luxuryTax.type).toBe("tax");
    if (incomeTax.type === "tax") expect(incomeTax.choice).toBeDefined();
    if (luxuryTax.type === "tax") expect(luxuryTax.choice).toBeUndefined();
  });

  it.each(["treasure", "surprise"] as const)("%s deck has exactly 16 cards with exactly one jail-free card", (deck) => {
    const cards = map.decks[deck];
    expect(cards).toHaveLength(16);
    expect(cards.filter((c) => c.effect.type === "jailFree")).toHaveLength(1);
    expect(cards.every((c) => c.deck === deck)).toBe(true);
    expect(new Set(cards.map((c) => c.id)).size).toBe(16); // unique ids
  });
});

describe("MAP_LIST", () => {
  it("has all 5 maps with unique ids", () => {
    expect(MAP_LIST.map((m) => m.id).sort()).toEqual(
      ["canada", "classic", "naija", "original", "worldTour"].sort(),
    );
  });
});
