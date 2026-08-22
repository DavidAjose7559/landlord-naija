// (Task 10b) Player colours are load-bearing now, not decorative — the
// ownership ring on a tile and every player-identity dot in the panel,
// chat and auction feed all key off this, not the token. Eight values,
// deliberately picked with a weighted-RGB distance check (see the
// commit that introduced this file) to stay maximally distinct from:
//   - each other,
//   - all eight fixed region colours (board-colors.ts) — an ownership
//     ring must never be mistaken for a region plate,
//   - all five maps' tile colours (near-white/cream on every map, so
//     any reasonably saturated colour clears this on its own).
// Worst-case pairwise/region distance in that check was ~75 (out of a
// scale where >100 reads as "clearly different" and <30 as "the same
// colour"), which is why these are deliberately vivid rather than
// matched in tone to the muted region palette.
export const PLAYER_COLORS = [
  "crimson",
  "tangerine",
  "gold",
  "lime",
  "emerald",
  "turquoise",
  "cobalt",
  "violet",
] as const;

export type PlayerColor = (typeof PLAYER_COLORS)[number];

export const PLAYER_COLOR_HEX: Record<PlayerColor, string> = {
  crimson: "#ff453a",
  tangerine: "#ff8a00",
  gold: "#ffd426",
  lime: "#8bc53f",
  emerald: "#00a876",
  turquoise: "#1fb6a8",
  cobalt: "#3a6ff0",
  violet: "#b455f0",
};

export const PLAYER_COLOR_LABEL: Record<PlayerColor, string> = {
  crimson: "Crimson",
  tangerine: "Tangerine",
  gold: "Gold",
  lime: "Lime",
  emerald: "Emerald",
  turquoise: "Turquoise",
  cobalt: "Cobalt",
  violet: "Violet",
};

// Every player colour is vivid/saturated enough that a dark glyph reads
// clearly on top of all eight (checked: worst-case contrast ratio ~4.7,
// against a 3:1 floor for non-text graphical content) — simpler and more
// consistent than picking light-vs-dark ink per colour the way the (much
// more varied, some genuinely light) region palette needs to.
export const PLAYER_COLOR_INK = "text-black/80";

function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

// A cheap perceptual-ish distance (weighted Euclidean RGB, the same
// "low-cost redmean" formula used to pick this palette in the first
// place) — good enough to rank "which remaining colour is most distinct
// from what's already taken" without pulling in a colour-science library
// for eight fixed hex constants.
function colorDistance(hexA: string, hexB: string): number {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const rmean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
}

// (Task 10b) "Auto-assign the most distinct remaining colour so it works
// if nobody picks." Greedy max-min: among colours nobody's taken yet,
// pick whichever has the largest distance to its closest already-taken
// neighbour. With only 8 colours and at most 8 seats this is cheap
// enough to just brute-force on every join.
export function autoAssignColor(taken: readonly PlayerColor[]): PlayerColor {
  const available = PLAYER_COLORS.filter((c) => !taken.includes(c));
  if (available.length === 0) return PLAYER_COLORS[0]; // unreachable: max 8 seats, 8 colours
  if (taken.length === 0) return available[0];

  let best = available[0];
  let bestScore = -Infinity;
  for (const candidate of available) {
    const minDist = Math.min(...taken.map((t) => colorDistance(PLAYER_COLOR_HEX[candidate], PLAYER_COLOR_HEX[t])));
    if (minDist > bestScore) {
      bestScore = minDist;
      best = candidate;
    }
  }
  return best;
}
