import "server-only";

import { z } from "zod";
import type { GameRow } from "./game-state";
import { supabaseAdmin } from "@/lib/supabase/server";
import type {
  BugReportGameSnapshot,
  BugReportRow,
  BugReportRowWithScreenshot,
  BugReportSnapshot,
  SnapshotEvent,
  SnapshotRoll,
  SnapshotTradeThread,
} from "@/lib/bug-report-types";
import { ApiError } from "./errors";

const SCREENSHOT_BUCKET = "bug-screenshots";
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
// Signed URLs are generated fresh on every /bugs page load — this only
// needs to outlive the time someone actually has the page open.
const SCREENSHOT_URL_TTL_SECONDS = 60 * 10;

export const bugSeveritySchema = z.enum(["ruins_game", "annoying", "cosmetic"]);

export const bugReportRequestSchema = z
  .object({
    // Absent entirely when filed from a game-less page (home, /rules) —
    // see route.ts's game-or-null branch.
    roomCode: z.string().optional(),
    // Optional: present when the reporter has a seat (see loadSession).
    // Absent for a spectator, who can still report — see route.ts.
    clientToken: z.string().min(1).optional(),
    // The route the reporter was actually on when they clicked the
    // button — always sent, game or not.
    path: z.string().min(1).max(300),
    description: z.string().trim().min(1).max(4000),
    severity: bugSeveritySchema,
    commitSha: z.string().max(64).nullable().optional(),
    client: z
      .object({
        userAgent: z.string().max(500),
        viewportWidth: z.number().int().nonnegative(),
        viewportHeight: z.number().int().nonnegative(),
        online: z.boolean(),
        devicePixelRatio: z.number().nonnegative(),
      })
      .strict(),
    diagnostics: z
      .array(
        z
          .object({
            type: z.enum(["console.error", "window.onerror", "unhandledrejection", "network"]),
            message: z.string().max(1000),
            detail: z.string().max(2000).optional(),
            timestamp: z.number(),
          })
          .strict(),
      )
      .max(20),
    breadcrumbs: z
      .array(
        z
          .object({
            timestamp: z.number(),
            label: z.string().max(200),
            route: z.string().max(300),
          })
          .strict(),
      )
      .max(30),
    // A data-URL-free base64 JPEG string (the client strips the
    // "data:image/jpeg;base64," prefix before sending) — either
    // html2canvas's auto-capture or a manually uploaded file, already
    // compressed/size-checked client-side. This cap is deliberately loose
    // (~11MB decoded) — it exists only to bound worst-case request size
    // against a hostile payload, not to enforce the real 2MB limit. The
    // real limit is uploadBugScreenshot's post-decode byte check, which
    // drops an oversized screenshot (screenshot_path stays null) rather
    // than failing the request — "never block a report on its
    // attachment" means this field must never be why the whole submit
    // 400s over a client-side compression bug.
    screenshotBase64: z.string().max(15_000_000).optional(),
  })
  .strict();

export type BugReportRequest = z.infer<typeof bugReportRequestSchema>;

interface EventRow {
  seq: number;
  type: string;
  payload: unknown;
}

interface RollRow {
  roll_index: number;
  player_id: string;
  die_1: number;
  die_2: number;
}

interface TradeRow {
  id: string;
  status: string;
  from_player_id: string;
  to_player_id: string;
  offer: unknown;
  request: unknown;
  parent_trade_id: string | null;
  round: number;
  created_at: string;
}

async function loadLastEvents(gameId: string): Promise<SnapshotEvent[]> {
  const { data, error } = await supabaseAdmin
    .from("events")
    .select("seq, type, payload")
    .eq("game_id", gameId)
    .order("seq", { ascending: false })
    .limit(20);
  if (error) throw new ApiError(500, "failed to load events for snapshot");
  return ((data ?? []) as EventRow[])
    .map((e) => ({ seq: e.seq, type: e.type, payload: e.payload }))
    .sort((a, b) => a.seq - b.seq);
}

async function loadLastRolls(gameId: string): Promise<SnapshotRoll[]> {
  const { data, error } = await supabaseAdmin
    .from("rolls")
    .select("roll_index, player_id, die_1, die_2")
    .eq("game_id", gameId)
    .order("roll_index", { ascending: false })
    .limit(5);
  if (error) throw new ApiError(500, "failed to load rolls for snapshot");
  return ((data ?? []) as RollRow[])
    .map((r) => ({ rollIndex: r.roll_index, playerId: r.player_id, d1: r.die_1, d2: r.die_2 }))
    .sort((a, b) => a.rollIndex - b.rollIndex);
}

// Every trade row for this game, grouped into threads (a thread is a
// counter-offer chain sharing the same root proposal), keeping only
// threads whose latest round is still open — mirrors TradePanel.tsx's
// buildThreads, reimplemented here against snake_case DB rows since this
// runs server-side, not against the client's camelCase shape.
async function loadOpenTradeThreads(gameId: string): Promise<SnapshotTradeThread[]> {
  const { data, error } = await supabaseAdmin.from("trades").select("*").eq("game_id", gameId);
  if (error) throw new ApiError(500, "failed to load trades for snapshot");
  const rows = (data ?? []) as TradeRow[];

  const byId = new Map(rows.map((r) => [r.id, r]));
  function rootOf(row: TradeRow): string {
    let current = row;
    while (current.parent_trade_id) {
      const parent = byId.get(current.parent_trade_id);
      if (!parent) break;
      current = parent;
    }
    return current.id;
  }

  const threads = new Map<string, TradeRow[]>();
  for (const row of rows) {
    const key = rootOf(row);
    const list = threads.get(key) ?? [];
    list.push(row);
    threads.set(key, list);
  }

  const result: SnapshotTradeThread[] = [];
  for (const [threadId, list] of threads) {
    list.sort((a, b) => a.round - b.round);
    const latest = list[list.length - 1];
    if (latest.status !== "open") continue;
    result.push({
      threadId,
      rounds: list.map((r) => ({
        id: r.id,
        round: r.round,
        status: r.status,
        fromPlayerId: r.from_player_id,
        toPlayerId: r.to_player_id,
        offer: r.offer as SnapshotTradeThread["rounds"][number]["offer"],
        request: r.request as SnapshotTradeThread["rounds"][number]["request"],
        createdAt: r.created_at,
      })),
    });
  }
  return result;
}

export interface Reporter {
  playerId: string | null;
  name: string;
  position: number | null;
}

async function buildGameSnapshot(game: GameRow, reporter: Reporter): Promise<BugReportGameSnapshot> {
  const [lastEvents, lastRolls, openTrades] = await Promise.all([
    loadLastEvents(game.id),
    loadLastRolls(game.id),
    loadOpenTradeThreads(game.id),
  ]);

  const currentPlayer = game.state.players[game.state.currentPlayerIndex] ?? null;

  return {
    room: {
      roomCode: game.roomCode,
      gameId: game.id,
      mapId: game.state.settings.mapId,
      status: game.status,
    },
    turn: {
      turnPhase: game.state.turnPhase,
      currentPlayerIndex: game.state.currentPlayerIndex,
      currentPlayerId: currentPlayer?.id ?? null,
      currentPlayerName: currentPlayer?.name ?? null,
      reporterIsCurrentPlayer: reporter.playerId !== null && reporter.playerId === currentPlayer?.id,
    },
    settings: game.state.settings,
    players: game.state.players.map((p) => ({
      id: p.id,
      name: p.name,
      cashCents: p.cashCents,
      position: p.position,
      inJail: p.inJail,
      bankrupt: p.bankrupt,
      properties: Object.entries(game.state.ownership)
        .filter(([, own]) => own.ownerId === p.id)
        .map(([idx, own]) => ({
          spaceIndex: Number(idx),
          houses: own.houses,
          hotel: own.hotel,
          mortgaged: own.mortgaged,
        })),
    })),
    state: game.state,
    lastEvents,
    lastRolls,
    openTrades,
  };
}

// Assembles the automatic half of the snapshot — everything the SERVER can
// see and the client can't be trusted to report honestly (game state,
// event log, roll ledger, open trades). The client half (user agent,
// viewport, console/network diagnostics) is passed straight through from
// the request body, since nothing about it can be independently verified
// server-side — it's diagnostic metadata, not an authorization input.
// `game` is null when the report was filed from a page with no active
// game (home, /rules) — the whole `game` field is then omitted as a unit
// rather than populated with faked/zeroed values.
export async function buildBugReportSnapshot(
  game: GameRow | null,
  reporter: Reporter,
  body: BugReportRequest,
): Promise<BugReportSnapshot> {
  return {
    timestamp: new Date().toISOString(),
    commitSha: body.commitSha ?? null,
    path: body.path,
    game: game ? await buildGameSnapshot(game, reporter) : null,
    reporter,
    client: body.client,
    diagnostics: body.diagnostics,
    breadcrumbs: body.breadcrumbs,
  };
}

// Uploads the (already client-compressed) screenshot to the private
// bug-screenshots bucket and returns its object path, or null on ANY
// failure — decode error, oversize, or a storage error. Never throws:
// per spec, a report must still submit with no screenshot rather than
// fail outright over an attachment.
export async function uploadBugScreenshot(reportId: string, base64: string): Promise<string | null> {
  try {
    const buffer = Buffer.from(base64, "base64");
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_SCREENSHOT_BYTES) return null;

    const path = `${reportId}.jpg`;
    const { error } = await supabaseAdmin.storage
      .from(SCREENSHOT_BUCKET)
      .upload(path, buffer, { contentType: "image/jpeg", upsert: false });
    if (error) {
      console.error("bug screenshot upload failed", error);
      return null;
    }
    return path;
  } catch (error) {
    console.error("bug screenshot upload threw", error);
    return null;
  }
}

// Never returns the object path itself to the client, and never makes the
// bucket public — a fresh short-lived signed URL per page load is what
// /bugs actually renders. Returns null (rather than throwing) on any
// storage error, so one bad screenshot can't take down the whole review
// page.
async function signScreenshotUrl(path: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(SCREENSHOT_BUCKET)
    .createSignedUrl(path, SCREENSHOT_URL_TTL_SECONDS);
  if (error || !data) {
    console.error("failed to sign bug screenshot url", error);
    return null;
  }
  return data.signedUrl;
}

interface BugReportDbRow {
  id: string;
  game_id: string | null;
  reporter_player_id: string | null;
  room_code: string | null;
  severity: string;
  description: string;
  commit_sha: string | null;
  snapshot: BugReportSnapshot;
  resolved: boolean;
  created_at: string;
  screenshot_path: string | null;
}

export function mapBugReportRow(row: BugReportDbRow): BugReportRow {
  return {
    id: row.id,
    gameId: row.game_id,
    reporterPlayerId: row.reporter_player_id,
    roomCode: row.room_code,
    severity: row.severity as BugReportRow["severity"],
    description: row.description,
    commitSha: row.commit_sha,
    // breadcrumbs is a field this app added after some rows were already
    // stored — normalized to [] here, the one place every reader of a
    // BugReportRow can trust it's always a real array, rather than every
    // caller (BugsList, the markdown formatter) having to guard against a
    // pre-migration row's snapshot not having it at all.
    snapshot: { ...row.snapshot, breadcrumbs: row.snapshot.breadcrumbs ?? [] },
    resolved: row.resolved,
    createdAt: row.created_at,
    screenshotPath: row.screenshot_path,
  };
}

export async function loadBugReports(
  opts: { unresolvedOnly?: boolean } = {},
): Promise<BugReportRowWithScreenshot[]> {
  let query = supabaseAdmin.from("bug_reports").select("*").order("created_at", { ascending: false });
  if (opts.unresolvedOnly) query = query.eq("resolved", false);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "failed to load bug reports");
  const rows = ((data ?? []) as BugReportDbRow[]).map(mapBugReportRow);

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      screenshotUrl: row.screenshotPath ? await signScreenshotUrl(row.screenshotPath) : null,
    })),
  );
}
