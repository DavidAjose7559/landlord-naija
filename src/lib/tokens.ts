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
