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
