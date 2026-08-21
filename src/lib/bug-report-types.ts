// Shared between the client (BugReportButton, which fills in the `client`
// half) and the server (POST /api/bugs, which fills in everything else
// from the authoritative game/events/rolls/trades tables) — deliberately no
// "server-only" import. This is the exact shape stored in
// bug_reports.snapshot.

import type { GameSettings, GameState, TradeOffer, TurnPhase } from "@/game/types";

export type BugSeverity = "ruins_game" | "annoying" | "cosmetic";

export const SEVERITY_LABEL: Record<BugSeverity, string> = {
  ruins_game: "Ruins the game",
  annoying: "Annoying",
  cosmetic: "Cosmetic",
};

// One entry in the client-side console/network ring buffer
// (src/lib/diagnostics.ts) at the moment a report was filed.
export interface DiagnosticEntry {
  type: "console.error" | "window.onerror" | "unhandledrejection" | "network";
  message: string;
  detail?: string;
  timestamp: number;
}

export interface ClientEnvSnapshot {
  userAgent: string;
  viewportWidth: number;
  viewportHeight: number;
  online: boolean;
  devicePixelRatio: number;
}

export interface SnapshotPlayer {
  id: string;
  name: string;
  cashCents: number;
  position: number;
  inJail: boolean;
  bankrupt: boolean;
  properties: Array<{ spaceIndex: number; houses: number; hotel: boolean; mortgaged: boolean }>;
}

export interface SnapshotEvent {
  seq: number;
  type: string;
  payload: unknown;
}

export interface SnapshotRoll {
  rollIndex: number;
  playerId: string;
  d1: number;
  d2: number;
}

export interface SnapshotTradeRound {
  id: string;
  round: number;
  status: string;
  fromPlayerId: string;
  toPlayerId: string;
  offer: TradeOffer;
  request: TradeOffer;
  createdAt: string;
}

export interface SnapshotTradeThread {
  threadId: string;
  rounds: SnapshotTradeRound[];
}

// The full jsonb blob stored in bug_reports.snapshot.
export interface BugReportSnapshot {
  timestamp: string;
  commitSha: string | null;

  room: {
    roomCode: string;
    gameId: string;
    mapId: string;
    status: string;
  };

  turn: {
    turnPhase: TurnPhase;
    currentPlayerIndex: number;
    currentPlayerId: string | null;
    currentPlayerName: string | null;
    reporterIsCurrentPlayer: boolean;
  };

  reporter: {
    playerId: string | null;
    name: string;
    position: number | null;
  };

  settings: GameSettings;
  players: SnapshotPlayer[];
  state: GameState;
  lastEvents: SnapshotEvent[];
  lastRolls: SnapshotRoll[];
  openTrades: SnapshotTradeThread[];
  client: ClientEnvSnapshot;
  diagnostics: DiagnosticEntry[];
}

// One row as read back from bug_reports (see 0008_bug_reports.sql).
export interface BugReportRow {
  id: string;
  gameId: string | null;
  reporterPlayerId: string | null;
  roomCode: string | null;
  severity: BugSeverity;
  description: string;
  commitSha: string | null;
  snapshot: BugReportSnapshot;
  resolved: boolean;
  createdAt: string;
}
