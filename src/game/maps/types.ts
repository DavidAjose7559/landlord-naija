import type { Card } from "../cards";
import type { ColorGroup, Space } from "../board";

export type MapId = "naija" | "worldTour" | "canada" | "classic";

// A region is the named, flagged successor to a bare "colour group" — but
// it's still anchored to one of the 8 fixed colour slots (every map has
// the identical 2/3/3/3/3/3/3/2 shape at the identical indices), so
// rendering/rent code keyed off ColorGroup keeps working unmodified.
export interface GameMapRegion {
  id: ColorGroup;
  name: string;
  flagEmoji?: string;
  spaceIndexes: readonly number[];
}

export interface GameMap {
  id: MapId;
  name: string;
  tagline: string;
  flagEmoji: string;
  currency: "CAD";
  // Per-map flavour labels for the two universally-generic spaces/decks.
  // The engine and UI fall back to the generic term when a map has none
  // (only naija actually overrides these).
  jailLabel: string;
  freeParkingLabel: string;
  deckLabels: { treasure: string; surprise: string };
  spaces: readonly Space[];
  decks: { treasure: readonly Card[]; surprise: readonly Card[] };
  regions: readonly GameMapRegion[];
}
