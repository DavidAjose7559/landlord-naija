import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/api/admin-auth";
import {
  buildBugReportSnapshot,
  bugReportRequestSchema,
  loadBugReports,
  uploadBugScreenshot,
  type Reporter,
} from "@/lib/api/bug-reports";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { callRpc, loadGameByRoomCode, loadPlayerByClientToken, type GameRow } from "@/lib/api/game-state";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { parseJsonBody, parseRoomCode } from "@/lib/api/validate";
import { formatBugReportsMarkdown } from "@/lib/bug-report-markdown";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

function clientIp(request: Request): string {
  // Vercel sets this; falls back to a single shared bucket for anyone it's
  // missing for (local dev, tests) rather than skipping rate limiting.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

// Deliberately reads game/events/rolls/trades and writes to bug_reports
// only — never touches games/players/events/rolls/trades. There is no
// game-state mutation anywhere on this path, even in principle: no call
// here ever reaches apply_game_action or any other RPC that writes to
// those tables.
export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request, bugReportRequestSchema);

    // Anyone can file a report, from anywhere — a page with no active game
    // (home, /rules) just means roomCode is absent from the body, and the
    // whole `game` half of the snapshot is omitted. When a room IS given,
    // a seated player identifies via clientToken same as every other
    // action, but an invalid/missing token just falls back to reporting
    // as a spectator rather than rejecting the whole submission. A bug
    // report failing to submit over an auth technicality would defeat the
    // point of the button.
    let roomCode: string | null = null;
    let game: GameRow | null = null;
    let reporter: Reporter = { playerId: null, name: "Anonymous", position: null };

    if (body.roomCode) {
      roomCode = parseRoomCode(body.roomCode);
      game = await loadGameByRoomCode(roomCode);
      reporter = { playerId: null, name: "Spectator", position: null };

      if (body.clientToken) {
        try {
          const authed = await loadPlayerByClientToken(game.id, body.clientToken);
          const player = game.state.players.find((p) => p.id === authed.id);
          if (player) {
            reporter = { playerId: player.id, name: player.name, position: player.position };
          }
        } catch {
          // stays a spectator report
        }
      }
    }

    // Namespaced (see the action route's identical comment) — this and
    // every other rate-limited route share one in-memory map keyed purely
    // by string, so an unprefixed clientToken would double as the action
    // route's own bucket key too.
    const rateLimitKey = `bugreport:${body.clientToken ?? `ip:${clientIp(request)}`}`;
    if (!checkRateLimit(rateLimitKey, RATE_LIMIT, RATE_WINDOW_MS)) {
      throw new ApiError(429, "too many bug reports — try again in a few minutes");
    }

    const snapshot = await buildBugReportSnapshot(game, reporter, body);

    const id = randomUUID();
    // Uploaded (if present) before the insert so the row can carry its
    // final screenshot_path in one write rather than a follow-up update.
    // A failed upload silently yields null here — per spec, a report must
    // still submit with no screenshot rather than fail outright.
    const screenshotPath = body.screenshotBase64 ? await uploadBugScreenshot(id, body.screenshotBase64) : null;

    await callRpc("create_bug_report", {
      p_id: id,
      p_game_id: game?.id ?? null,
      p_reporter_player_id: reporter.playerId,
      p_room_code: roomCode,
      p_severity: body.severity,
      p_description: body.description,
      p_commit_sha: body.commitSha ?? null,
      p_snapshot: snapshot,
      p_screenshot_path: screenshotPath,
    });

    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

// CLI-friendly: GET /api/bugs?secret=...&unresolved=true returns the same
// "Copy for Claude Code" markdown the /bugs page's per-report button
// produces, concatenated for every matching report — pull a whole game
// night's open bugs in one paste.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (!isAdminAuthorized(url.searchParams.get("secret"))) {
      throw new ApiError(404, "not found");
    }

    const unresolvedOnly = url.searchParams.get("unresolved") === "true";
    const reports = await loadBugReports({ unresolvedOnly });
    const markdown = formatBugReportsMarkdown(reports);

    return new NextResponse(markdown, {
      status: 200,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
