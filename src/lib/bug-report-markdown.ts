// Turns a bug_reports row into the "Copy for Claude Code" markdown block —
// shared between the /bugs review page (per-report copy button) and
// GET /api/bugs (concatenates one of these per open report). Deliberately
// no "server-only" import: the copy button runs client-side.

import type { BugReportRow } from "./bug-report-types";
import { SEVERITY_LABEL } from "./bug-report-types";

function reproHint(row: BugReportRow): string {
  const { turn, reporter } = row.snapshot;
  const whoseTurn = turn.reporterIsCurrentPlayer
    ? "on their own turn"
    : `not their turn (current player: ${turn.currentPlayerName ?? "nobody"})`;
  const position = reporter.position !== null ? `board space ${reporter.position}` : "an unknown position";
  return `Repro hint: reporter was ${whoseTurn}, turn_phase="${turn.turnPhase}", standing at ${position} when this was filed.`;
}

function formatPlayers(row: BugReportRow): string {
  return row.snapshot.players
    .map((p) => {
      const props = p.properties
        .map((prop) => `${prop.spaceIndex}${prop.hotel ? "(hotel)" : prop.houses > 0 ? `(${prop.houses}h)` : ""}${prop.mortgaged ? "[mortgaged]" : ""}`)
        .join(", ");
      return `- ${p.name} (${p.id}): $${(p.cashCents / 100).toFixed(2)}, position ${p.position}${p.inJail ? ", in jail" : ""}${p.bankrupt ? ", BANKRUPT" : ""}${props ? `, owns: ${props}` : ""}`;
    })
    .join("\n");
}

function formatEvents(row: BugReportRow): string {
  if (row.snapshot.lastEvents.length === 0) return "(no events recorded yet)";
  return row.snapshot.lastEvents.map((e) => `- [${e.seq}] ${e.type} ${JSON.stringify(e.payload)}`).join("\n");
}

function formatDiagnostics(row: BugReportRow): string {
  if (row.snapshot.diagnostics.length === 0) return "(none captured)";
  return row.snapshot.diagnostics
    .map((d) => `- [${d.type}] ${new Date(d.timestamp).toISOString()} — ${d.message}${d.detail ? `\n  ${d.detail}` : ""}`)
    .join("\n");
}

function formatTrades(row: BugReportRow): string {
  if (row.snapshot.openTrades.length === 0) return "(no open trades)";
  return row.snapshot.openTrades
    .map((thread) => {
      const rounds = thread.rounds
        .map((r) => `  - round ${r.round} (${r.status}): ${r.fromPlayerId} -> ${r.toPlayerId}`)
        .join("\n");
      return `- thread ${thread.threadId}:\n${rounds}`;
    })
    .join("\n");
}

export function formatBugReportMarkdown(row: BugReportRow): string {
  const { snapshot } = row;
  return `## Bug report — ${SEVERITY_LABEL[row.severity]} — room ${snapshot.room.roomCode} — ${row.createdAt}

**Reporter:** ${snapshot.reporter.name}${snapshot.reporter.playerId ? ` (${snapshot.reporter.playerId})` : " (spectator)"}
**Commit:** ${row.commitSha ?? "unknown"}
**${reproHint(row)}**

### What happened
${row.description}

### Relevant state
- map: ${snapshot.room.mapId}, status: ${snapshot.room.status}
- turn_phase: ${snapshot.turn.turnPhase}
- current player: ${snapshot.turn.currentPlayerName ?? "none"} (index ${snapshot.turn.currentPlayerIndex})
- players:
${formatPlayers(row)}
- open trades:
${formatTrades(row)}

### Last events (most recent ${snapshot.lastEvents.length})
${formatEvents(row)}

### Console/network errors captured this session
${formatDiagnostics(row)}

### Client
- user agent: ${snapshot.client.userAgent}
- viewport: ${snapshot.client.viewportWidth}x${snapshot.client.viewportHeight}, dpr ${snapshot.client.devicePixelRatio}, online: ${snapshot.client.online}
`;
}

export function formatBugReportsMarkdown(rows: BugReportRow[]): string {
  if (rows.length === 0) return "No open bug reports.\n";
  return rows.map(formatBugReportMarkdown).join("\n---\n\n");
}
