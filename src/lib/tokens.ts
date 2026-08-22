import type { ClassicToken, NaijaToken, PlayerToken } from "@/game/types";

export const NAIJA_TOKENS: readonly NaijaToken[] = [
  "danfo",
  "keke",
  "jollof",
  "gele",
  "okada",
  "agbada",
  "suya",
  "bottle",
];

export const CLASSIC_TOKENS: readonly ClassicToken[] = [
  "tophat",
  "racecar",
  "dog",
  "boot",
  "ship",
  "thimble",
  "wheelbarrow",
  "iron",
];

// The tabbed lobby picker's two sets, in display order.
export const TOKEN_SETS: readonly { id: "naija" | "classic"; label: string; tokens: readonly PlayerToken[] }[] = [
  { id: "naija", label: "Naija", tokens: NAIJA_TOKENS },
  { id: "classic", label: "Classic", tokens: CLASSIC_TOKENS },
];

export const PLAYER_TOKENS: readonly PlayerToken[] = [...NAIJA_TOKENS, ...CLASSIC_TOKENS];

export function isClassicToken(token: PlayerToken): token is ClassicToken {
  return (CLASSIC_TOKENS as readonly PlayerToken[]).includes(token);
}

export const PLAYER_TOKEN_LABEL: Record<PlayerToken, string> = {
  danfo: "Danfo",
  keke: "Keke",
  jollof: "Jollof",
  gele: "Gele",
  okada: "Okada",
  agbada: "Agbada",
  suya: "Suya",
  bottle: "Bottle",
  tophat: "Top Hat",
  racecar: "Race Car",
  dog: "Dog",
  boot: "Boot",
  ship: "Ship",
  thimble: "Thimble",
  wheelbarrow: "Wheelbarrow",
  iron: "Iron",
};

