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

export interface GoSpace {
  index: number;
  name: string;
  type: "go";
}

export interface JailSpace {
  index: number;
  name: string;
  type: "jail";
}

export interface FreeParkingSpace {
  index: number;
  name: string;
  type: "free";
}

export interface GoToJailSpace {
  index: number;
  name: string;
  type: "gotojail";
}

export interface CardSpace {
  index: number;
  name: string;
  type: "card";
  deck: Deck;
}

// A tax space is either a flat charge, or (space 4 on every map) a choice
// between a flat amount and a percentage of the payer's net worth — the
// player picks at landing time (TurnPhase "awaiting_tax_choice").
export interface TaxSpace {
  index: number;
  name: string;
  type: "tax";
  amount: number; // flat charge in cents; for a choice space, this is the flat option
  choice?: {
    flatAmountCents: number;
    percentOfNetWorth: number; // e.g. 10 for 10%
  };
}

export interface TransportSpace {
  index: number;
  name: string;
  type: "transport";
  price: number;
  mortgageValue: number;
  unmortgageCost: number;
}

export interface UtilitySpace {
  index: number;
  name: string;
  type: "utility";
  price: number;
  mortgageValue: number;
  unmortgageCost: number;
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
  };
}

export function makeTransport(index: number, name: string, priceDollars: number): TransportSpace {
  const price = dollars(priceDollars);
  const { mortgageValue, unmortgageCost } = computeMortgage(price);
  return { index, name, type: "transport", price, mortgageValue, unmortgageCost };
}

export function makeUtility(index: number, name: string, priceDollars: number): UtilitySpace {
  const price = dollars(priceDollars);
  const { mortgageValue, unmortgageCost } = computeMortgage(price);
  return { index, name, type: "utility", price, mortgageValue, unmortgageCost };
}

// Space 38 on every map: a plain flat tax.
export function makeTax(index: number, name: string, amountDollars: number): TaxSpace {
  return { index, name, type: "tax", amount: dollars(amountDollars) };
}

// Space 4 on every map: Income Tax, a flat-or-percent-of-net-worth choice.
export function makeChoiceTax(
  index: number,
  name: string,
  flatAmountDollars: number,
  percentOfNetWorth: number,
): TaxSpace {
  const flatAmountCents = dollars(flatAmountDollars);
  return {
    index,
    name,
    type: "tax",
    amount: flatAmountCents,
    choice: { flatAmountCents, percentOfNetWorth },
  };
}

export function makeCard(index: number, name: string, deck: Deck): CardSpace {
  return { index, name, type: "card", deck };
}
