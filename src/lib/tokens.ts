import type { PlayerToken } from "@/game/types";

export const PLAYER_TOKENS: readonly PlayerToken[] = [
  "danfo",
  "keke",
  "jollof",
  "gele",
  "okada",
  "agbada",
  "suya",
  "bottle",
];

export const PLAYER_TOKEN_LABEL: Record<PlayerToken, string> = {
  danfo: "Danfo",
  keke: "Keke",
  jollof: "Jollof",
  gele: "Gele",
  okada: "Okada",
  agbada: "Agbada",
  suya: "Suya",
  bottle: "Bottle",
};

export const PLAYER_TOKEN_EMOJI: Record<PlayerToken, string> = {
  danfo: "🚌",
  keke: "🛺",
  jollof: "🍚",
  gele: "🧕",
  okada: "🏍️",
  agbada: "🥻",
  suya: "🍢",
  bottle: "🍾",
};

// Distinct per-token colour used for ownership dots on the board and
// token accents — not the same palette as property colour groups, so the
// two never get confused at a glance.
export const PLAYER_TOKEN_COLOR: Record<PlayerToken, string> = {
  danfo: "#FFC107",
  keke: "#FF7043",
  jollof: "#EF5350",
  gele: "#AB47BC",
  okada: "#42A5F5",
  agbada: "#26A69A",
  suya: "#A1887F",
  bottle: "#26C6DA",
};
