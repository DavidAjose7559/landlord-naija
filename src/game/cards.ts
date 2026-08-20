import { dollars } from "@/lib/money";
import type { Deck } from "./board";

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

export const OWAMBE_CARDS: readonly Card[] = [
  {
    id: "owambe-1",
    deck: "owambe",
    text: "Your aunty sprayed you at the wedding.",
    effect: { type: "collect", amount: dollars(200) },
  },
  {
    id: "owambe-2",
    deck: "owambe",
    text: "Bank error in your favour — the alert landed twice.",
    effect: { type: "collect", amount: dollars(200) },
  },
  {
    id: "owambe-3",
    deck: "owambe",
    text: "Your side hustle finally paid out.",
    effect: { type: "collect", amount: dollars(50) },
  },
  {
    id: "owambe-4",
    deck: "owambe",
    text: "Ajo contribution payout day.",
    effect: { type: "collect", amount: dollars(100) },
  },
  {
    id: "owambe-5",
    deck: "owambe",
    text: "You sold your old generator on Jiji.",
    effect: { type: "collect", amount: dollars(50) },
  },
  {
    id: "owambe-6",
    deck: "owambe",
    text: "It's your birthday. Every player sprays you $10.",
    effect: { type: "collectFromEach", amount: dollars(10) },
  },
  {
    id: "owambe-7",
    deck: "owambe",
    text: "Hospital bill for that malaria.",
    effect: { type: "pay", amount: dollars(100) },
  },
  {
    id: "owambe-8",
    deck: "owambe",
    text: "School fees are due.",
    effect: { type: "pay", amount: dollars(50) },
  },
  {
    id: "owambe-9",
    deck: "owambe",
    text: "Landlord raised the rent last minute.",
    effect: { type: "pay", amount: dollars(150) },
  },
  {
    id: "owambe-10",
    deck: "owambe",
    text: "Free from Kirikiri. Keep this card until you need it.",
    effect: { type: "jailFree" },
  },
  {
    id: "owambe-11",
    deck: "owambe",
    text: "Caught driving one-way. Go to Kirikiri. Do not pass GO.",
    effect: { type: "goToJail" },
  },
  {
    id: "owambe-12",
    deck: "owambe",
    text: "Head straight to GO.",
    effect: { type: "moveTo", to: 0, passGoPays: true },
  },
  {
    id: "owambe-13",
    deck: "owambe",
    text: "NEPA refunded your estimated billing.",
    effect: { type: "collect", amount: dollars(75) },
  },
  {
    id: "owambe-14",
    deck: "owambe",
    text: "You won the estate raffle. Every player pays you $25.",
    effect: { type: "collectFromEach", amount: dollars(25) },
  },
  {
    id: "owambe-15",
    deck: "owambe",
    text: "Roof repairs across all your properties.",
    effect: { type: "repairs", perHouse: dollars(40), perHotel: dollars(115) },
  },
  {
    id: "owambe-16",
    deck: "owambe",
    text: "CRA tax refund cleared.",
    effect: { type: "collect", amount: dollars(20) },
  },
];

export const VILLAGE_CARDS: readonly Card[] = [
  {
    id: "village-1",
    deck: "village",
    text: "Village people don tie your leg. Go back three spaces.",
    effect: { type: "moveBack", spaces: 3 },
  },
  {
    id: "village-2",
    deck: "village",
    text: "Head straight to GO.",
    effect: { type: "moveTo", to: 0, passGoPays: true },
  },
  {
    id: "village-3",
    deck: "village",
    text: "Take a trip to Eko Atlantic.",
    effect: { type: "moveTo", to: 39, passGoPays: true },
  },
  {
    id: "village-4",
    deck: "village",
    text: "Your car broke down on Third Mainland Bridge.",
    effect: { type: "pay", amount: dollars(50) },
  },
  {
    id: "village-5",
    deck: "village",
    text: "Advance to the nearest transport hub. Pay double rent, or buy it if nobody owns it.",
    effect: { type: "nearestTransport", rentMultiplier: 2 },
  },
  {
    id: "village-6",
    deck: "village",
    text: "Advance to the nearest transport hub. Pay double rent, or buy it if nobody owns it.",
    effect: { type: "nearestTransport", rentMultiplier: 2 },
  },
  {
    id: "village-7",
    deck: "village",
    text: "Advance to the nearest utility. If owned, roll and pay ten times the total.",
    effect: { type: "nearestUtility", rentMultiplier: 10 },
  },
  {
    id: "village-8",
    deck: "village",
    text: "Fuel scarcity. Pay $100 at the black market.",
    effect: { type: "pay", amount: dollars(100) },
  },
  {
    id: "village-9",
    deck: "village",
    text: "Free from Kirikiri. Keep this card until you need it.",
    effect: { type: "jailFree" },
  },
  {
    id: "village-10",
    deck: "village",
    text: "Go to Kirikiri. Do not pass GO.",
    effect: { type: "goToJail" },
  },
  {
    id: "village-11",
    deck: "village",
    text: "Advance to Ikeja City Mall.",
    effect: { type: "moveTo", to: 11, passGoPays: true },
  },
  {
    id: "village-12",
    deck: "village",
    text: "Advance to Ikoyi.",
    effect: { type: "moveTo", to: 32, passGoPays: true },
  },
  {
    id: "village-13",
    deck: "village",
    text: "Your gen packed up. Repairs on every property.",
    effect: { type: "repairs", perHouse: dollars(25), perHotel: dollars(100) },
  },
  {
    id: "village-14",
    deck: "village",
    text: "Dividends from your cousin's POS business.",
    effect: { type: "collect", amount: dollars(150) },
  },
  {
    id: "village-15",
    deck: "village",
    text: "You've been elected estate chairman. Pay every player $50.",
    effect: { type: "payEach", amount: dollars(50) },
  },
  {
    id: "village-16",
    deck: "village",
    text: "Aso-ebi levy for the family owambe.",
    effect: { type: "pay", amount: dollars(75) },
  },
];

export const DECKS: Record<Deck, readonly Card[]> = {
  owambe: OWAMBE_CARDS,
  village: VILLAGE_CARDS,
};

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
