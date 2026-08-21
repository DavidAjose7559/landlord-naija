import { describe, expect, it } from "vitest";
import { drawCard, returnCardToBottom, shuffleDeck, type Card } from "./cards";

const sampleCards: Card[] = [
  { id: "a", deck: "treasure", text: "A", effect: { type: "collect", amount: 100 } },
  { id: "b", deck: "treasure", text: "B", effect: { type: "collect", amount: 200 } },
  { id: "c", deck: "treasure", text: "C", effect: { type: "collect", amount: 300 } },
];

describe("shuffleDeck", () => {
  it("is deterministic for a given rng", () => {
    let calls = 0;
    const rng = () => {
      calls += 1;
      return (calls * 37) % 100 / 100;
    };
    const a = shuffleDeck(sampleCards, rng);
    calls = 0;
    const b = shuffleDeck(sampleCards, rng);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it("never mutates the input array", () => {
    const original = [...sampleCards];
    shuffleDeck(sampleCards, () => 0.5);
    expect(sampleCards).toEqual(original);
  });

  it("preserves every card, just reordered", () => {
    const shuffled = shuffleDeck(sampleCards, () => 0.9);
    expect(shuffled).toHaveLength(sampleCards.length);
    expect(new Set(shuffled.map((c) => c.id))).toEqual(new Set(sampleCards.map((c) => c.id)));
  });
});

describe("drawCard / returnCardToBottom", () => {
  it("draws the first card and returns the rest, without mutating the input", () => {
    const original = [...sampleCards];
    const { card, remaining } = drawCard(sampleCards);
    expect(card.id).toBe("a");
    expect(remaining.map((c) => c.id)).toEqual(["b", "c"]);
    expect(sampleCards).toEqual(original);
  });

  it("throws on an empty deck", () => {
    expect(() => drawCard([])).toThrow();
  });

  it("returnCardToBottom appends without mutating the input", () => {
    const original = [...sampleCards];
    const { card, remaining } = drawCard(sampleCards);
    const restored = returnCardToBottom(remaining, card);
    expect(restored.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(sampleCards).toEqual(original);
  });
});
