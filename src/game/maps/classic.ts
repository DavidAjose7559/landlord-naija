import { dollars } from "@/lib/money";
import { makeCard, makeProperty, makeTax, makeTransport, makeUtility } from "../board";
import type { Card } from "../cards";
import { applyRegionLabels, type GameMap, type GameMapRegion } from "./types";

// Entirely invented street names — no real Monopoly property names.
const spaces = [
  { index: 0, name: "GO", type: "go" as const, lines: ["GO"] },
  makeProperty(1, "Tannery Row", "brown", 60, ["TANNERY ROW"]),
  makeCard(2, "Treasure", "treasure", ["TREASURE"]),
  makeProperty(3, "Kiln Street", "brown", 60, ["KILN STREET"]),
  makeTax(4, "Income Tax", 200, ["INCOME TAX"]),
  makeTransport(5, "Central Station", 200, ["CENTRAL", "STATION"]),
  makeProperty(6, "Foundry Lane", "lightblue", 100, ["FOUNDRY LANE"]),
  makeCard(7, "Surprise", "surprise", ["SURPRISE"]),
  makeProperty(8, "Millwright Avenue", "lightblue", 100, ["MILLWRIGHT", "AVENUE"]),
  makeProperty(9, "Cooper's Yard", "lightblue", 120, ["COOPER'S YARD"]),
  { index: 10, name: "Jail", type: "jail" as const, lines: ["JAIL"] },
  makeProperty(11, "Weaver's Row", "pink", 140, ["WEAVER'S ROW"]),
  makeUtility(12, "Municipal Power", 150, ["MUNICIPAL", "POWER"]),
  makeProperty(13, "Ropewalk Street", "pink", 140, ["ROPEWALK", "STREET"]),
  makeProperty(14, "Cobble Court", "pink", 160, ["COBBLE COURT"]),
  makeTransport(15, "Union Depot", 200, ["UNION DEPOT"]),
  makeProperty(16, "Regent Crescent", "orange", 180, ["REGENT", "CRESCENT"]),
  makeCard(17, "Treasure", "treasure", ["TREASURE"]),
  makeProperty(18, "Sovereign Street", "orange", 180, ["SOVEREIGN", "STREET"]),
  makeProperty(19, "Monarch Row", "orange", 200, ["MONARCH ROW"]),
  { index: 20, name: "Free Parking", type: "free" as const, lines: ["FREE", "PARKING"] },
  makeProperty(21, "Harbour Walk", "red", 220, ["HARBOUR WALK"]),
  makeCard(22, "Surprise", "surprise", ["SURPRISE"]),
  makeProperty(23, "Wharfside Avenue", "red", 220, ["WHARFSIDE", "AVENUE"]),
  makeProperty(24, "Anchor Street", "red", 240, ["ANCHOR STREET"]),
  makeTransport(25, "Junction Yard", 200, ["JUNCTION YARD"]),
  makeProperty(26, "Crown Terrace", "yellow", 260, ["CROWN TERRACE"]),
  makeProperty(27, "Sceptre Street", "yellow", 260, ["SCEPTRE STREET"]),
  makeUtility(28, "Civic Waterworks", 150, ["CIVIC", "WATERWORKS"]),
  makeProperty(29, "Jubilee Court", "yellow", 280, ["JUBILEE COURT"]),
  { index: 30, name: "Go To Jail", type: "gotojail" as const, lines: ["GO TO", "JAIL"] },
  makeProperty(31, "Meridian Avenue", "green", 300, ["MERIDIAN", "AVENUE"]),
  makeProperty(32, "Compass Street", "green", 300, ["COMPASS STREET"]),
  makeCard(33, "Treasure", "treasure", ["TREASURE"]),
  makeProperty(34, "Lighthouse Row", "green", 320, ["LIGHTHOUSE ROW"]),
  makeTransport(35, "Terminal Line", 200, ["TERMINAL LINE"]),
  makeCard(36, "Surprise", "surprise", ["SURPRISE"]),
  makeProperty(37, "Grand Terrace", "darkblue", 350, ["GRAND TERRACE"]),
  makeTax(38, "Luxury Tax", 100, ["LUXURY TAX"]),
  makeProperty(39, "Summit Crescent", "darkblue", 400, ["SUMMIT", "CRESCENT"]),
];

const regions: GameMapRegion[] = [
  { id: "brown", name: "Old Town", spaceIndexes: [1, 3] },
  { id: "lightblue", name: "Millworks", spaceIndexes: [6, 8, 9] },
  { id: "pink", name: "The Row", spaceIndexes: [11, 13, 14] },
  { id: "orange", name: "Regent Quarter", spaceIndexes: [16, 18, 19] },
  { id: "red", name: "Harbourside", spaceIndexes: [21, 23, 24] },
  { id: "yellow", name: "Crown District", spaceIndexes: [26, 27, 29] },
  { id: "green", name: "Meridian Heights", spaceIndexes: [31, 32, 34] },
  { id: "darkblue", name: "Summit", spaceIndexes: [37, 39] },
];

applyRegionLabels(spaces, regions);

const treasure: Card[] = [
  { id: "classic-treasure-1", deck: "treasure", text: "A distant relative left you an inheritance.", effect: { type: "collect", amount: dollars(200) } },
  { id: "classic-treasure-2", deck: "treasure", text: "Bank error in your favour.", effect: { type: "collect", amount: dollars(200) } },
  { id: "classic-treasure-3", deck: "treasure", text: "You sold some old furniture at the market.", effect: { type: "collect", amount: dollars(50) } },
  { id: "classic-treasure-4", deck: "treasure", text: "Tax refund cleared.", effect: { type: "collect", amount: dollars(100) } },
  { id: "classic-treasure-5", deck: "treasure", text: "You found some loose change in an old coat.", effect: { type: "collect", amount: dollars(50) } },
  { id: "classic-treasure-6", deck: "treasure", text: "It's your birthday. Every player gives you $10.", effect: { type: "collectFromEach", amount: dollars(10) } },
  { id: "classic-treasure-7", deck: "treasure", text: "Doctor's bill.", effect: { type: "pay", amount: dollars(100) } },
  { id: "classic-treasure-8", deck: "treasure", text: "School fees are due.", effect: { type: "pay", amount: dollars(50) } },
  { id: "classic-treasure-9", deck: "treasure", text: "Your landlord raised the rent last minute.", effect: { type: "pay", amount: dollars(150) } },
  { id: "classic-treasure-10", deck: "treasure", text: "Get Out of Jail Free. Keep this card until you need it.", effect: { type: "jailFree" } },
  { id: "classic-treasure-11", deck: "treasure", text: "Caught speeding. Go directly to Jail.", effect: { type: "goToJail" } },
  { id: "classic-treasure-12", deck: "treasure", text: "Head straight to GO.", effect: { type: "moveTo", to: 0, passGoPays: true } },
  { id: "classic-treasure-13", deck: "treasure", text: "The utility company overbilled you — refunded.", effect: { type: "collect", amount: dollars(75) } },
  { id: "classic-treasure-14", deck: "treasure", text: "You won a raffle. Every player pays you $25.", effect: { type: "collectFromEach", amount: dollars(25) } },
  { id: "classic-treasure-15", deck: "treasure", text: "Roof repairs across all your properties.", effect: { type: "repairs", perHouse: dollars(40), perHotel: dollars(115) } },
  { id: "classic-treasure-16", deck: "treasure", text: "A small tax refund cleared.", effect: { type: "collect", amount: dollars(20) } },
];

const surprise: Card[] = [
  { id: "classic-surprise-1", deck: "surprise", text: "Take a wrong turn — go back three spaces.", effect: { type: "moveBack", spaces: 3 } },
  { id: "classic-surprise-2", deck: "surprise", text: "Head straight to GO.", effect: { type: "moveTo", to: 0, passGoPays: true } },
  { id: "classic-surprise-3", deck: "surprise", text: "Take a trip to Summit Crescent.", effect: { type: "moveTo", to: 39, passGoPays: true } },
  { id: "classic-surprise-4", deck: "surprise", text: "Your car broke down.", effect: { type: "pay", amount: dollars(50) } },
  { id: "classic-surprise-5", deck: "surprise", text: "Advance to the nearest transport hub. Pay double rent, or buy it if nobody owns it.", effect: { type: "nearestTransport", rentMultiplier: 2 } },
  { id: "classic-surprise-6", deck: "surprise", text: "Advance to the nearest transport hub. Pay double rent, or buy it if nobody owns it.", effect: { type: "nearestTransport", rentMultiplier: 2 } },
  { id: "classic-surprise-7", deck: "surprise", text: "Advance to the nearest utility. If owned, roll and pay ten times the total.", effect: { type: "nearestUtility", rentMultiplier: 10 } },
  { id: "classic-surprise-8", deck: "surprise", text: "Fuel surcharge.", effect: { type: "pay", amount: dollars(100) } },
  { id: "classic-surprise-9", deck: "surprise", text: "Get Out of Jail Free. Keep this card until you need it.", effect: { type: "jailFree" } },
  { id: "classic-surprise-10", deck: "surprise", text: "Go directly to Jail. Do not pass GO.", effect: { type: "goToJail" } },
  { id: "classic-surprise-11", deck: "surprise", text: "Advance to Weaver's Row.", effect: { type: "moveTo", to: 11, passGoPays: true } },
  { id: "classic-surprise-12", deck: "surprise", text: "Advance to Compass Street.", effect: { type: "moveTo", to: 32, passGoPays: true } },
  { id: "classic-surprise-13", deck: "surprise", text: "A storm caused damage — repairs on every property.", effect: { type: "repairs", perHouse: dollars(25), perHotel: dollars(100) } },
  { id: "classic-surprise-14", deck: "surprise", text: "Dividends from a side venture.", effect: { type: "collect", amount: dollars(150) } },
  { id: "classic-surprise-15", deck: "surprise", text: "You're throwing the party. Pay every player $50.", effect: { type: "payEach", amount: dollars(50) } },
  { id: "classic-surprise-16", deck: "surprise", text: "Special assessment levy.", effect: { type: "pay", amount: dollars(75) } },
];

export const classicMap: GameMap = {
  id: "classic",
  name: "Classic",
  tagline: "The plain classic experience.",
  theme: "modern",
  currency: "CAD",
  jailLabel: "Jail",
  freeParkingLabel: "Free Parking",
  deckLabels: { treasure: "Treasure", surprise: "Surprise" },
  spaces,
  decks: { treasure, surprise },
  regions,
};
