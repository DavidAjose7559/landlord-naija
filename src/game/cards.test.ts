import { describe, expect, it } from "vitest";
import { OWAMBE_CARDS, VILLAGE_CARDS } from "./cards";

describe("card decks", () => {
  it("OWAMBE deck has exactly 16 cards", () => {
    expect(OWAMBE_CARDS.length).toBe(16);
  });

  it("VILLAGE deck has exactly 16 cards", () => {
    expect(VILLAGE_CARDS.length).toBe(16);
  });

  it("OWAMBE deck has exactly one jailFree card", () => {
    expect(OWAMBE_CARDS.filter((c) => c.effect.type === "jailFree").length).toBe(1);
  });

  it("VILLAGE deck has exactly one jailFree card", () => {
    expect(VILLAGE_CARDS.filter((c) => c.effect.type === "jailFree").length).toBe(1);
  });

  it("all card ids are unique within each deck", () => {
    expect(new Set(OWAMBE_CARDS.map((c) => c.id)).size).toBe(OWAMBE_CARDS.length);
    expect(new Set(VILLAGE_CARDS.map((c) => c.id)).size).toBe(VILLAGE_CARDS.length);
  });

  it("every card is tagged with its own deck", () => {
    expect(OWAMBE_CARDS.every((c) => c.deck === "owambe")).toBe(true);
    expect(VILLAGE_CARDS.every((c) => c.deck === "village")).toBe(true);
  });
});
