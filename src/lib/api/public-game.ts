// The JSON shape returned by GET /api/games/[code] and by a successful
// POST /api/games/[code]/action — deliberately no "server-only" import
// here, since this type is shared with client components/hooks.

import type { GameState, GameStatus, TurnPhase } from "@/game/types";

export interface PublicGame {
  id: string;
  roomCode: string;
  status: GameStatus;
  serverSeedHash: string;
  serverSeed: string | null; // only non-null once status === "finished"
  rollIndex: number;
  currentPlayerIndex: number;
  turnPhase: TurnPhase;
  doublesCount: number;
  state: GameState;
  createdAt: string;
  updatedAt: string;
}
