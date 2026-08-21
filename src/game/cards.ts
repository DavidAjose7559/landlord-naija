import type { Deck } from "./board";

// Shared card types + deck utilities. Card *content* is per-map — see
// src/game/maps/*.ts — since every map has its own 16-card Treasure and
// 16-card Surprise decks (naija's "Owambe"/"Village People" flavour names
// are just that map's deckLabels; the engine only ever deals in the
// generic "treasure"/"surprise" deck ids).

export type CardEffect =
  | { type: "collect"; amount: number }
  | { type: "pay"; amount: number }
  | { type: "collectFromEach"; amount: number }
  | { type: "payEach"; amount: number }
  | { type: "moveTo"; to: number; passGoPays: boolean }
  | { type: "moveBack"; spaces: number }
  | { type: "goToJail" }
  | { type: "jailFree" }
  | { type: "nearestTransport"; rentMultiplier: 2 }
  | { type: "nearestUtility"; rentMultiplier: 10 }
  | { type: "repairs"; perHouse: number; perHotel: number };

export interface Card {
  id: string;
  deck: Deck;
  text: string;
  effect: CardEffect;
}

export function shuffleDeck<T>(deck: readonly T[], rng: () => number): T[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Pure, immutable draw/return pair: draw takes the top card off the pile,
// returnCardToBottom appends a card (e.g. a used "jail free" card) to the
// bottom. Neither mutates its input.
export function drawCard(deck: readonly Card[]): { card: Card; remaining: Card[] } {
  const [card, ...remaining] = deck;
  if (!card) {
    throw new Error("Cannot draw from an empty deck");
  }
  return { card, remaining };
}

export function returnCardToBottom(deck: readonly Card[], card: Card): Card[] {
  return [...deck, card];
}
