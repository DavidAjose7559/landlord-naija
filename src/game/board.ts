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

export type Deck = "owambe" | "village";

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

export interface TaxSpace {
  index: number;
  name: string;
  type: "tax";
  amount: number;
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

function makeProperty(
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

function makeTransport(index: number, name: string, priceDollars: number): TransportSpace {
  const price = dollars(priceDollars);
  const { mortgageValue, unmortgageCost } = computeMortgage(price);
  return { index, name, type: "transport", price, mortgageValue, unmortgageCost };
}

function makeUtility(index: number, name: string, priceDollars: number): UtilitySpace {
  const price = dollars(priceDollars);
  const { mortgageValue, unmortgageCost } = computeMortgage(price);
  return { index, name, type: "utility", price, mortgageValue, unmortgageCost };
}

function makeTax(index: number, name: string, amountDollars: number): TaxSpace {
  return { index, name, type: "tax", amount: dollars(amountDollars) };
}

function makeCard(index: number, name: string, deck: Deck): CardSpace {
  return { index, name, type: "card", deck };
}

export const BOARD: readonly Space[] = [
  { index: 0, name: "GO", type: "go" },
  makeProperty(1, "Agege", "brown", 50),
  makeCard(2, "Owambe", "owambe"),
  makeProperty(3, "Mushin", "brown", 55),
  makeTax(4, "Agbero Levy", 180),
  makeTransport(5, "Oshodi Bus Terminal", 190),
  makeProperty(6, "Ojuelegba", "lightblue", 90),
  makeCard(7, "Village People", "village"),
  makeProperty(8, "Yaba", "lightblue", 90),
  makeProperty(9, "Surulere", "lightblue", 110),
  { index: 10, name: "Kirikiri", type: "jail" },
  makeProperty(11, "Ikeja City Mall", "pink", 130),
  makeUtility(12, "NEPA", 140),
  makeProperty(13, "Ogba", "pink", 130),
  makeProperty(14, "Berger", "pink", 150),
  makeTransport(15, "Ojota Motor Park", 190),
  makeProperty(16, "Bodija, Ibadan", "orange", 170),
  makeCard(17, "Owambe", "owambe"),
  makeProperty(18, "Ring Road, Benin", "orange", 170),
  makeProperty(19, "Independence Layout, Enugu", "orange", 190),
  { index: 20, name: "Detty December", type: "free" },
  makeProperty(21, "Nassarawa GRA, Kano", "red", 210),
  makeCard(22, "Village People", "village"),
  makeProperty(23, "Old GRA, Port Harcourt", "red", 210),
  makeProperty(24, "Ikeja GRA", "red", 230),
  makeTransport(25, "Murtala Muhammed Airport", 190),
  makeProperty(26, "Lekki Phase 1", "yellow", 250),
  makeProperty(27, "Oniru", "yellow", 250),
  makeUtility(28, "Lagos Water Corporation", 140),
  makeProperty(29, "Wuse II, Abuja", "yellow", 270),
  { index: 30, name: "Go To Kirikiri", type: "gotojail" },
  makeProperty(31, "Victoria Island", "green", 290),
  makeProperty(32, "Ikoyi", "green", 290),
  makeCard(33, "Owambe", "owambe"),
  makeProperty(34, "Maitama, Abuja", "green", 310),
  makeTransport(35, "Blue Line Rail, Lagos", 190),
  makeCard(36, "Village People", "village"),
  makeProperty(37, "Banana Island", "darkblue", 340),
  makeTax(38, "Customs Duty", 100),
  makeProperty(39, "Eko Atlantic", "darkblue", 380),
];
