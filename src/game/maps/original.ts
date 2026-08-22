import { dollars } from "@/lib/money";
import { makeCard, makeProperty, makeTax, makeTransport, makeUtility } from "../board";
import type { Card } from "../cards";
import { applyRegionLabels, type GameMap, type GameMapRegion } from "./types";

// Period place names, invented — nothing here reads as a near-copy of any
// trademarked property. Same 40-space skeleton, same eight colour groups,
// same price ladder ($60 -> $400) as every other map.
const spaces = [
  { index: 0, name: "GO", type: "go" as const, lines: ["GO"] },
  makeProperty(1, "Tannery Row", "brown", 60, ["TANNERY ROW"]),
  makeCard(2, "Treasure", "treasure", ["TREASURE"]),
  makeProperty(3, "Foundry Lane", "brown", 60, ["FOUNDRY LANE"]),
  makeTax(4, "Property Assessment", 200, ["PROPERTY", "ASSESSMENT"]),
  makeTransport(5, "Northern Line Depot", 200, ["NORTHERN LINE", "DEPOT"]),
  makeProperty(6, "Kiln Street", "lightblue", 100, ["KILN STREET"]),
  makeCard(7, "Surprise", "surprise", ["SURPRISE"]),
  makeProperty(8, "Cooper's Yard", "lightblue", 100, ["COOPER'S YARD"]),
  makeProperty(9, "Millrace Way", "lightblue", 120, ["MILLRACE WAY"]),
  { index: 10, name: "Jail", type: "jail" as const, lines: ["JAIL"] },
  makeProperty(11, "Bellweather Avenue", "pink", 140, ["BELLWEATHER", "AVENUE"]),
  makeUtility(12, "Municipal Power", 150, ["MUNICIPAL", "POWER"]),
  makeProperty(13, "Quarry Road", "pink", 140, ["QUARRY ROAD"]),
  makeProperty(14, "Saltmarket", "pink", 160, ["SALTMARKET"]),
  makeTransport(15, "Eastgate Station", 200, ["EASTGATE", "STATION"]),
  makeProperty(16, "Candlewick Street", "orange", 180, ["CANDLEWICK", "STREET"]),
  makeCard(17, "Treasure", "treasure", ["TREASURE"]),
  makeProperty(18, "Drapers Gate", "orange", 180, ["DRAPERS GATE"]),
  makeProperty(19, "Ironmonger Row", "orange", 200, ["IRONMONGER ROW"]),
  { index: 20, name: "Free Parking", type: "free" as const, lines: ["FREE", "PARKING"] },
  makeProperty(21, "Harbour Walk", "red", 220, ["HARBOUR WALK"]),
  makeCard(22, "Surprise", "surprise", ["SURPRISE"]),
  makeProperty(23, "Custom House Quay", "red", 220, ["CUSTOM HOUSE", "QUAY"]),
  makeProperty(24, "Exchange Place", "red", 240, ["EXCHANGE PLACE"]),
  makeTransport(25, "Harbour Terminus", 200, ["HARBOUR", "TERMINUS"]),
  makeProperty(26, "Bishopsgate Rise", "yellow", 260, ["BISHOPSGATE", "RISE"]),
  makeProperty(27, "Corn Exchange", "yellow", 260, ["CORN EXCHANGE"]),
  makeUtility(28, "Municipal Waterworks", 150, ["MUNICIPAL", "WATERWORKS"]),
  makeProperty(29, "Regent Crescent", "yellow", 280, ["REGENT", "CRESCENT"]),
  { index: 30, name: "Go To Jail", type: "gotojail" as const, lines: ["GO TO", "JAIL"] },
  makeProperty(31, "Amberley Square", "green", 300, ["AMBERLEY", "SQUARE"]),
  makeProperty(32, "Wexford Terrace", "green", 300, ["WEXFORD", "TERRACE"]),
  makeCard(33, "Treasure", "treasure", ["TREASURE"]),
  makeProperty(34, "Kingsmere Row", "green", 320, ["KINGSMERE ROW"]),
  makeTransport(35, "Central Junction", 200, ["CENTRAL", "JUNCTION"]),
  makeCard(36, "Surprise", "surprise", ["SURPRISE"]),
  makeProperty(37, "Crown Terrace", "darkblue", 350, ["CROWN TERRACE"]),
  makeTax(38, "Excise Duty", 100, ["EXCISE DUTY"]),
  makeProperty(39, "Aldwych Park", "darkblue", 400, ["ALDWYCH PARK"]),
];

const regions: GameMapRegion[] = [
  { id: "brown", name: "Old Quarter", spaceIndexes: [1, 3] },
  { id: "lightblue", name: "Kiln District", spaceIndexes: [6, 8, 9] },
  { id: "pink", name: "Bellweather Row", spaceIndexes: [11, 13, 14] },
  { id: "orange", name: "Candlewick District", spaceIndexes: [16, 18, 19] },
  { id: "red", name: "Harbourside", spaceIndexes: [21, 23, 24] },
  { id: "yellow", name: "Bishopsgate", spaceIndexes: [26, 27, 29] },
  { id: "green", name: "Amberley Heights", spaceIndexes: [31, 32, 34] },
  { id: "darkblue", name: "Crown Estate", spaceIndexes: [37, 39] },
];

applyRegionLabels(spaces, regions);

const treasure: Card[] = [
  { id: "original-treasure-1", deck: "treasure", text: "Dividend from your railway shares.", effect: { type: "collect", amount: dollars(200) } },
  { id: "original-treasure-2", deck: "treasure", text: "The bank made an error in your favour.", effect: { type: "collect", amount: dollars(200) } },
  { id: "original-treasure-3", deck: "treasure", text: "You won first prize at the county fair.", effect: { type: "collect", amount: dollars(100) } },
  { id: "original-treasure-4", deck: "treasure", text: "Sale of an old writing desk.", effect: { type: "collect", amount: dollars(50) } },
  { id: "original-treasure-5", deck: "treasure", text: "A distant aunt's estate is settled in your favour.", effect: { type: "collect", amount: dollars(100) } },
  { id: "original-treasure-6", deck: "treasure", text: "It is your birthday — every player gives you $10.", effect: { type: "collectFromEach", amount: dollars(10) } },
  { id: "original-treasure-7", deck: "treasure", text: "The doctor's fee is due.", effect: { type: "pay", amount: dollars(100) } },
  { id: "original-treasure-8", deck: "treasure", text: "School fees are due this term.", effect: { type: "pay", amount: dollars(50) } },
  { id: "original-treasure-9", deck: "treasure", text: "Your landlord has raised the rent.", effect: { type: "pay", amount: dollars(150) } },
  { id: "original-treasure-10", deck: "treasure", text: "Get Out of Jail Free. Keep this card until needed.", effect: { type: "jailFree" } },
  { id: "original-treasure-11", deck: "treasure", text: "Caught poaching on the estate. Go directly to Jail.", effect: { type: "goToJail" } },
  { id: "original-treasure-12", deck: "treasure", text: "Advance to GO.", effect: { type: "moveTo", to: 0, passGoPays: true } },
  { id: "original-treasure-13", deck: "treasure", text: "The waterworks overbilled you — refunded.", effect: { type: "collect", amount: dollars(75) } },
  { id: "original-treasure-14", deck: "treasure", text: "You win the raffle. Every player pays you $25.", effect: { type: "collectFromEach", amount: dollars(25) } },
  { id: "original-treasure-15", deck: "treasure", text: "Street repairs assessment on all your holdings.", effect: { type: "repairs", perHouse: dollars(40), perHotel: dollars(115) } },
  { id: "original-treasure-16", deck: "treasure", text: "A small tax rebate arrives by post.", effect: { type: "collect", amount: dollars(20) } },
];

const surprise: Card[] = [
  { id: "original-surprise-1", deck: "surprise", text: "Lost your way — go back three spaces.", effect: { type: "moveBack", spaces: 3 } },
  { id: "original-surprise-2", deck: "surprise", text: "Advance to GO.", effect: { type: "moveTo", to: 0, passGoPays: true } },
  { id: "original-surprise-3", deck: "surprise", text: "Take a trip to Aldwych Park.", effect: { type: "moveTo", to: 39, passGoPays: true } },
  { id: "original-surprise-4", deck: "surprise", text: "Your carriage has thrown a wheel.", effect: { type: "pay", amount: dollars(50) } },
  { id: "original-surprise-5", deck: "surprise", text: "Advance to the nearest depot. Pay double rent, or buy it if unowned.", effect: { type: "nearestTransport", rentMultiplier: 2 } },
  { id: "original-surprise-6", deck: "surprise", text: "Advance to the nearest depot. Pay double rent, or buy it if unowned.", effect: { type: "nearestTransport", rentMultiplier: 2 } },
  { id: "original-surprise-7", deck: "surprise", text: "Advance to the nearest municipal works. If owned, roll and pay ten times the total.", effect: { type: "nearestUtility", rentMultiplier: 10 } },
  { id: "original-surprise-8", deck: "surprise", text: "A toll levy is due.", effect: { type: "pay", amount: dollars(100) } },
  { id: "original-surprise-9", deck: "surprise", text: "Get Out of Jail Free. Keep this card until needed.", effect: { type: "jailFree" } },
  { id: "original-surprise-10", deck: "surprise", text: "The magistrate is unimpressed. Go directly to Jail.", effect: { type: "goToJail" } },
  { id: "original-surprise-11", deck: "surprise", text: "Advance to Bellweather Avenue.", effect: { type: "moveTo", to: 11, passGoPays: true } },
  { id: "original-surprise-12", deck: "surprise", text: "Advance to Wexford Terrace.", effect: { type: "moveTo", to: 32, passGoPays: true } },
  { id: "original-surprise-13", deck: "surprise", text: "A storm caused damage — repairs across your holdings.", effect: { type: "repairs", perHouse: dollars(25), perHotel: dollars(100) } },
  { id: "original-surprise-14", deck: "surprise", text: "Dividends from a shrewd investment.", effect: { type: "collect", amount: dollars(150) } },
  { id: "original-surprise-15", deck: "surprise", text: "You are hosting the assembly. Pay every player $50.", effect: { type: "payEach", amount: dollars(50) } },
  { id: "original-surprise-16", deck: "surprise", text: "A special levy has been assessed.", effect: { type: "pay", amount: dollars(75) } },
];

export const originalMap: GameMap = {
  id: "original",
  name: "Original",
  tagline: "The vintage board, our streets.",
  theme: "heritage",
  currency: "CAD",
  jailLabel: "Jail",
  freeParkingLabel: "Free Parking",
  deckLabels: { treasure: "Treasure", surprise: "Surprise" },
  spaces,
  decks: { treasure, surprise },
  regions,
};
