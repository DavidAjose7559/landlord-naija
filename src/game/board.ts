// Shared, map-agnostic space-building toolkit: types, rent/mortgage
// formulas, and builder functions. The 40-space *skeleton* (which index is
// which SpaceType) is identical across every map — only names, regions,
// and prices vary — so this file has no board data of its own anymore.
// Each file under src/game/maps/ uses these builders to construct its own
// `spaces` array; src/game/maps/index.ts is the map registry.

import { dollars } from "@/lib/money";

export type SpaceType =
  | "go"
  | "property"
  | "transport"
  | "utility"
  | "tax"
  | "card"
  | "jail"
  | "free"
  | "gotojail";

export type ColorGroup =
  | "brown"
  | "lightblue"
  | "pink"
  | "orange"
  | "red"
  | "yellow"
  | "green"
  | "darkblue";

// Generic engine/UI terms (previously "owambe"/"village", which are now
// just the naija map's flavour label for these same two deck slots — see
// GameMap.deckLabels).
export type Deck = "treasure" | "surprise";

// Pre-authored line breaks for the board tile (see maps/*.ts) — never
// computed at runtime (no hyphens:auto, no measurement, no auto-fit).
// Uppercase, max 3 lines, broken only on word/comma boundaries. The font
// size per line is a pure function of its own character count (see
// LINE_TIER in BoardSpace), so authoring the break is the only manual
// step; sizing follows automatically and needs no data of its own.
export type SpaceLines = readonly string[];

export interface GoSpace {
  index: number;
  name: string;
  type: "go";
  lines: SpaceLines;
}

export interface JailSpace {
  index: number;
  name: string;
  type: "jail";
  lines: SpaceLines;
}

export interface FreeParkingSpace {
  index: number;
  name: string;
  type: "free";
  lines: SpaceLines;
}

export interface GoToJailSpace {
  index: number;
  name: string;
  type: "gotojail";
  lines: SpaceLines;
}

export interface CardSpace {
  index: number;
  name: string;
  type: "card";
  deck: Deck;
  lines: SpaceLines;
}

// (Section 2c) Both tax spaces are a flat, automatic charge — the old
// flat-vs-percentage-of-net-worth choice on space 4 was removed entirely,
// engine branch and UI both.
export interface TaxSpace {
  index: number;
  name: string;
  type: "tax";
  amount: number; // flat charge in cents
  lines: SpaceLines;
}

export interface TransportSpace {
  index: number;
  name: string;
  type: "transport";
  price: number;
  mortgageValue: number;
  unmortgageCost: number;
  lines: SpaceLines;
  // Always "Transport" — set once in makeTransport, not per-space data
  // (unlike PropertySpace.regionLabel, which genuinely varies).
  regionLabel: string;
}

export interface UtilitySpace {
  index: number;
  name: string;
  type: "utility";
  price: number;
  mortgageValue: number;
  unmortgageCost: number;
  lines: SpaceLines;
  regionLabel: string;
}

// rent tuple is indexed [0 houses, 1, 2, 3, 4, hotel]
export type RentTiers = readonly [number, number, number, number, number, number];

export interface PropertySpace {
  index: number;
  name: string;
  type: "property";
  color: ColorGroup;
  price: number;
  rent: RentTiers;
  houseCost: number;
  mortgageValue: number;
  unmortgageCost: number;
  lines: SpaceLines;
  // Populated by applyRegionLabels() (maps/types.ts) from the map's own
  // `regions` array once both `spaces` and `regions` exist — not threaded
  // through makeProperty, so it can never drift from the region it's
  // actually grouped under. Undefined only transiently, before that call.
  regionLabel?: string;
}

export type Space =
  | GoSpace
  | JailSpace
  | FreeParkingSpace
  | GoToJailSpace
  | CardSpace
  | TaxSpace
  | TransportSpace
  | UtilitySpace
  | PropertySpace;

export const GO_SALARY = dollars(200);
export const STARTING_CASH_OPTIONS = [1000, 1500, 2000, 2500].map(dollars);
export const DEFAULT_STARTING_CASH = dollars(1500);
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;

export const HOUSE_COST_BY_GROUP: Record<ColorGroup, number> = {
  brown: dollars(50),
  lightblue: dollars(50),
  pink: dollars(100),
  orange: dollars(100),
  red: dollars(150),
  yellow: dollars(150),
  green: dollars(200),
  darkblue: dollars(200),
};

// multipliers applied to baseRent for [0 houses, 1, 2, 3, 4, hotel]
export const RENT_MULTIPLIERS = [1, 5, 15, 45, 62, 75] as const;

// indexed by (number owned - 1)
export const TRANSPORT_RENT: readonly number[] = [30, 60, 120, 240].map(dollars);

export const UTILITY_RENT_MULTIPLIER = {
  oneOwned: 4,
  allOwned: 10,
} as const;

// The 40-space skeleton's structural positions — identical on every map.
export const JAIL_INDEX = 10;
export const FREE_PARKING_INDEX = 20;
export const GOTOJAIL_INDEX = 30;
export const TRANSPORT_INDEXES = [5, 15, 25, 35] as const;
export const UTILITY_INDEXES = [12, 28] as const;
export const TAX_INDEXES = [4, 38] as const;
export const TREASURE_CARD_INDEXES = [2, 17, 33] as const;
export const SURPRISE_CARD_INDEXES = [7, 22, 36] as const;

// Note: if a player owns every property in a colour group (none mortgaged),
// the 0-house rent tier is doubled. That is a runtime rule applied by the
// game engine against ownership state — it is not baked into this static data.

function roundToNearest5(value: number): number {
  return Math.round(value / 5) * 5;
}

function computeRentTiers(priceDollars: number): RentTiers {
  const baseRent = roundToNearest5(priceDollars * 0.1);
  const tiers = RENT_MULTIPLIERS.map((multiplier) =>
    dollars(roundToNearest5(baseRent * multiplier)),
  );
  return tiers as unknown as RentTiers;
}

function computeMortgage(priceCents: number): {
  mortgageValue: number;
  unmortgageCost: number;
} {
  const mortgageValue = priceCents / 2;
  // Integer math avoids float error (e.g. 2750 * 1.1 !== 3025 in JS floats).
  const unmortgageCost = Math.ceil((mortgageValue * 11) / 10);
  return { mortgageValue, unmortgageCost };
}

export function makeProperty(
  index: number,
  name: string,
  color: ColorGroup,
  priceDollars: number,
  lines: SpaceLines,
): PropertySpace {
  const price = dollars(priceDollars);
  const { mortgageValue, unmortgageCost } = computeMortgage(price);
  return {
    index,
    name,
    type: "property",
    color,
    price,
    rent: computeRentTiers(priceDollars),
    houseCost: HOUSE_COST_BY_GROUP[color],
    mortgageValue,
    unmortgageCost,
    lines,
  };
}

export function makeTransport(index: number, name: string, priceDollars: number, lines: SpaceLines): TransportSpace {
  const price = dollars(priceDollars);
  const { mortgageValue, unmortgageCost } = computeMortgage(price);
  return { index, name, type: "transport", price, mortgageValue, unmortgageCost, lines, regionLabel: "Transport" };
}

export function makeUtility(index: number, name: string, priceDollars: number, lines: SpaceLines): UtilitySpace {
  const price = dollars(priceDollars);
  const { mortgageValue, unmortgageCost } = computeMortgage(price);
  return { index, name, type: "utility", price, mortgageValue, unmortgageCost, lines, regionLabel: "Utility" };
}

// Space 38 on every map: a plain flat tax.
export function makeTax(index: number, name: string, amountDollars: number, lines: SpaceLines): TaxSpace {
  return { index, name, type: "tax", amount: dollars(amountDollars), lines };
}

export function makeCard(index: number, name: string, deck: Deck, lines: SpaceLines): CardSpace {
  return { index, name, type: "card", deck, lines };
}
