import type { ColorGroup } from "@/game/board";

// CSS custom-property REFERENCES, not raw hex — the actual colour values
// live entirely in globals.css, redefined per [data-theme] scope (see
// "Theme layer" there). A component reading this never knows or cares
// which theme is active; the browser resolves whichever value is
// currently in scope for wherever this string ends up (inline
// `style={{ backgroundColor: ... }}` in every call site today).
export const COLOR_GROUP_VAR: Record<ColorGroup, string> = {
  brown: "var(--color-group-brown)",
  lightblue: "var(--color-group-lightblue)",
  pink: "var(--color-group-pink)",
  orange: "var(--color-group-orange)",
  red: "var(--color-group-red)",
  yellow: "var(--color-group-yellow)",
  green: "var(--color-group-green)",
  darkblue: "var(--color-group-darkblue)",
};

// Only "yellow" (Amber) is light enough to need dark ink on top of it —
// every other fixed region colour (including the borderline "Lagoon"
// cyan) reads fine with white. Shared by every surface that draws a
// region plate/badge (board tiles, property popover, auction header) so
// they can't drift out of sync with each other.
const DARK_INK_GROUPS = new Set<ColorGroup>(["yellow"]);

// A literal dark/white choice, not a theme token: region colours are
// fixed across all five maps (task 4) and this needs to read correctly
// both inside the board's own [data-map-id] scope (tiles) and outside it
// on the fixed dark panel (auction header, property popover isn't scoped
// either once portaled) — --color-board-ink only resolves inside the
// former.
export function regionInkClass(color: ColorGroup): string {
  return DARK_INK_GROUPS.has(color) ? "text-black/85" : "text-white";
}

// Transport/utility spaces don't belong to any of the 8 property regions
// (see maps.test.ts — regions cover exactly the 22 property spaces), so
// they can't inherit a region colour for their plate — fixed, muted, and
// visually distinct from all 8 saturated region colours instead. Never
// themed. Shared by the board tile, the property popover, and the
// auction header.
export const TRANSPORT_PLATE_COLOR = "var(--color-plate-transport)";
export const UTILITY_PLATE_COLOR = "var(--color-plate-utility)";
