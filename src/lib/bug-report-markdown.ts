// Turns a bug_reports row into the "Copy for Claude Code" markdown block —
// shared between the /bugs review page (per-report copy button) and
// GET /api/bugs (concatenates one of these per open report). Deliberately
// no "server-only" import: the copy button runs client-side.

import type { BugReportGameSnapshot, BugReportRow } from "./bug-report-types";
import { SEVERITY_LABEL } from "./bug-report-types";

function reproHint(row: BugReportRow, game: BugReportGameSnapshot | null): string {
  if (!game) {
    return `Repro hint: no active game — filed from ${row.snapshot.path}.`;
  }
  const { turn } = game;
  const { reporter } = row.snapshot;
  const whoseTurn = turn.reporterIsCurrentPlayer
    ? "on their own turn"
    : `not their turn (current player: ${turn.currentPlayerName ?? "nobody"})`;
  const position = reporter.position !== null ? `board space ${reporter.position}` : "an unknown position";
  return `Repro hint: reporter was ${whoseTurn}, turn_phase="${turn.turnPhase}", standing at ${position} when this was filed.`;
}

function formatPlayers(game: BugReportGameSnapshot): string {
  return game.players
    .map((p) => {
      const props = p.properties
        .map((prop) => `${prop.spaceIndex}${prop.hotel ? "(hotel)" : prop.houses > 0 ? `(${prop.houses}h)` : ""}${prop.mortgaged ? "[mortgaged]" : ""}`)
        .join(", ");
      return `- ${p.name} (${p.id}): $${(p.cashCents / 100).toFixed(2)}, position ${p.position}${p.inJail ? ", in jail" : ""}${p.bankrupt ? ", BANKRUPT" : ""}${props ? `, owns: ${props}` : ""}`;
    })
    .join("\n");
}

function formatEvents(game: BugReportGameSnapshot): string {
  if (game.lastEvents.length === 0) return "(no events recorded yet)";
  return game.lastEvents.map((e) => `- [${e.seq}] ${e.type} ${JSON.stringify(e.payload)}`).join("\n");
}

function formatDiagnostics(row: BugReportRow): string {
  if (row.snapshot.diagnostics.length === 0) return "(none captured)";
  return row.snapshot.diagnostics
    .map((d) => `- [${d.type}] ${new Date(d.timestamp).toISOString()} — ${d.message}${d.detail ? `\n  ${d.detail}` : ""}`)
    .join("\n");
}

// "1. clicked Roll (game view) 2. opened property card: Lekki Phase 1 ..."
// — the exact click/focus trail leading up to the report, oldest first.
// This is the piece that turns "it broke" into an actual repro.
function formatBreadcrumbs(row: BugReportRow): string {
  if (row.snapshot.breadcrumbs.length === 0) return "(none captured)";
  return row.snapshot.breadcrumbs.map((b, i) => `${i + 1}. ${b.label} (${b.route})`).join("\n");
}

function formatTrades(game: BugReportGameSnapshot): string {
  if (game.openTrades.length === 0) return "(no open trades)";
  return game.openTrades
    .map((thread) => {
      const rounds = thread.rounds
        .map((r) => `  - round ${r.round} (${r.status}): ${r.fromPlayerId} -> ${r.toPlayerId}`)
        .join("\n");
      return `- thread ${thread.threadId}:\n${rounds}`;
    })
    .join("\n");
}

function formatRelevantState(row: BugReportRow, game: BugReportGameSnapshot | null): string {
  if (!game) {
    return `(no active game — filed from ${row.snapshot.path})`;
  }
  return `- map: ${game.room.mapId}, status: ${game.room.status}
- turn_phase: ${game.turn.turnPhase}
- current player: ${game.turn.currentPlayerName ?? "none"} (index ${game.turn.currentPlayerIndex})
- players:
${formatPlayers(game)}
- open trades:
${formatTrades(game)}`;
}

export function formatBugReportMarkdown(row: BugReportRow): string {
  const { snapshot } = row;
  const { game } = snapshot;
  const location = game ? `room ${game.room.roomCode}` : `no room (${snapshot.path})`;
  const reporterTag = snapshot.reporter.playerId ? snapshot.reporter.playerId : game ? "spectator" : "no active game";

  return `## Bug report — ${SEVERITY_LABEL[row.severity]} — ${location} — ${row.createdAt}

**Reporter:** ${snapshot.reporter.name} (${reporterTag})
**Commit:** ${row.commitSha ?? "unknown"}
**Screenshot:** ${row.screenshotPath ? "attached — view inline on the /bugs page" : "none"}
**${reproHint(row, game)}**

### What happened
${row.description}

### Relevant state
${formatRelevantState(row, game)}

### Last events (most recent ${game?.lastEvents.length ?? 0})
${game ? formatEvents(game) : "(no active game)"}

### Console/network errors captured this session
${formatDiagnostics(row)}

### Click trail leading up to this report
${formatBreadcrumbs(row)}

### Client
- user agent: ${snapshot.client.userAgent}
- viewport: ${snapshot.client.viewportWidth}x${snapshot.client.viewportHeight}, dpr ${snapshot.client.devicePixelRatio}, online: ${snapshot.client.online}
`;
}

export function formatBugReportsMarkdown(rows: BugReportRow[]): string {
  if (rows.length === 0) return "No open bug reports.\n";
  return rows.map(formatBugReportMarkdown).join("\n---\n\n");
}
