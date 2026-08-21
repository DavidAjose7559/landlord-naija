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

// One entry in the client-side interaction ring buffer
// (src/lib/breadcrumbs.ts) — the last 30 clicks/focuses leading up to the
// report, never raw DOM paths and never a typed value.
export interface Breadcrumb {
  timestamp: number;
  label: string;
  route: string;
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

// Everything that only exists when the report was filed from inside an
// actual game — absent entirely (not zeroed/faked) when filed from a
// game-less page (home, /rules). See BugReportSnapshot.game below.
export interface BugReportGameSnapshot {
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

  settings: GameSettings;
  players: SnapshotPlayer[];
  state: GameState;
  lastEvents: SnapshotEvent[];
  lastRolls: SnapshotRoll[];
  openTrades: SnapshotTradeThread[];
}

// The full jsonb blob stored in bug_reports.snapshot.
export interface BugReportSnapshot {
  timestamp: string;
  commitSha: string | null;

  // The route the reporter was actually on (e.g. "/game/ABCDEF",
  // "/rules", "/") — always present, game or not.
  path: string;

  // null when filed from a page with no active game (home, /rules, the
  // /bugs review page itself). Every game-state field lives under here as
  // one unit so "the snapshot simply omits game fields" is structural,
  // not a bag of independently-nullable fields callers could forget to
  // check.
  game: BugReportGameSnapshot | null;

  reporter: {
    playerId: string | null;
    name: string;
    position: number | null;
  };

  client: ClientEnvSnapshot;
  diagnostics: DiagnosticEntry[];
  breadcrumbs: Breadcrumb[];
}

// One row as read back from bug_reports (see 0008/0010_bug_reports*.sql).
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
  // Object path in the private bug-screenshots bucket, or null. Never
  // fetch this directly client-side — the /bugs page reads a
  // server-generated signed URL instead (screenshotUrl below), since the
  // bucket is private.
  screenshotPath: string | null;
}

// Populated only by the /bugs page's server component (loadBugReports),
// never stored — a short-lived signed URL generated fresh on each page
// load. null when the report has no screenshot, or the signed-URL call
// itself failed.
export interface BugReportRowWithScreenshot extends BugReportRow {
  screenshotUrl: string | null;
}
