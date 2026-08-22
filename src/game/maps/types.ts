import type { Card } from "../cards";
import type { ColorGroup, Space } from "../board";

export type MapId = "naija" | "worldTour" | "canada" | "classic" | "original";

// Which design system a map's board/panel render with (src/app/globals.css
// "Theme layer" — every --color-*/--board-*/--font-* token a component
// consumes is redefined per scope, never branched on in JS). A property
// of the map, never a user setting: picking the map picks the look.
// 'modern' is the existing parchment-on-felt look every map but
// 'original' uses; 'heritage' is the new vintage property-trading-board
// look, used only by 'original'.
export type MapTheme = "modern" | "heritage";

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

// Populates PropertySpace.regionLabel from the map's own `regions` array
// — called once per map, after both `spaces` and `regions` exist, so the
// label can never drift out of sync with which region a space is
// actually grouped under. Transport/utility spaces get their
// (constant) regionLabel directly from makeTransport/makeUtility instead,
// since "Transport"/"Utility" never varies per-map.
export function applyRegionLabels(spaces: Space[], regions: readonly GameMapRegion[]): void {
  for (const region of regions) {
    for (const idx of region.spaceIndexes) {
      const space = spaces[idx];
      if (space.type === "property") space.regionLabel = region.name;
    }
  }
}

export interface GameMap {
  id: MapId;
  name: string;
  tagline: string;
  flagEmoji: string;
  theme: MapTheme;
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
