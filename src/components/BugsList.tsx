"use client";

import { useState } from "react";
import { formatBugReportMarkdown } from "@/lib/bug-report-markdown";
import { SEVERITY_LABEL, type BugReportRowWithScreenshot, type BugSeverity } from "@/lib/bug-report-types";

interface BugsListProps {
  reports: BugReportRowWithScreenshot[];
  secret: string;
}

const SEVERITY_CHIP: Record<BugSeverity, string> = {
  ruins_game: "bg-danger/20 text-danger",
  annoying: "bg-accent/20 text-accent",
  cosmetic: "bg-surface-2 text-muted",
};

export function BugsList({ reports, secret }: BugsListProps) {
  const [rows, setRows] = useState(reports);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [trailExpandedId, setTrailExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleResolved(id: string, resolved: boolean) {
    setBusyId(id);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, resolved } : r)));
    try {
      const res = await fetch(`/api/bugs/${id}?secret=${encodeURIComponent(secret)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolved }),
      });
      if (!res.ok) {
        // roll back on failure
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, resolved: !resolved } : r)));
      }
    } catch {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, resolved: !resolved } : r)));
    } finally {
      setBusyId(null);
    }
  }

  async function copyForClaude(row: BugReportRowWithScreenshot) {
    const markdown = formatBugReportMarkdown(row);
    await navigator.clipboard.writeText(markdown);
    setCopiedId(row.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted">No bug reports yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const expanded = expandedId === row.id;
        const trailExpanded = trailExpandedId === row.id;
        return (
          <div key={row.id} className={`flex flex-col gap-2 rounded-2xl bg-surface px-4 py-3 ${row.resolved ? "opacity-50" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${SEVERITY_CHIP[row.severity]}`}>
                {SEVERITY_LABEL[row.severity]}
              </span>
              <span className="text-xs text-muted">{row.roomCode ? `room ${row.roomCode}` : row.snapshot.path}</span>
              <span className="text-xs text-muted">
                {row.snapshot.reporter.name}
                {row.snapshot.reporter.playerId ? "" : row.snapshot.game ? " (spectator)" : " (no active game)"}
              </span>
              <span className="text-xs text-muted">{row.commitSha ? row.commitSha.slice(0, 7) : "no commit sha"}</span>
              {/* Explicit locale — bare toLocaleString() depends on the
                  ambient runtime locale, which can (and, on at least one
                  real machine, did) differ between this client component's
                  server-rendered HTML and the browser's own locale,
                  producing a hydration mismatch ("1:14:18 PM" vs
                  "1:14:18 p.m."). Pinning it makes server and client
                  agree unconditionally. */}
              <span className="text-xs text-muted">{new Date(row.createdAt).toLocaleString("en-US")}</span>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={row.resolved}
                  disabled={busyId === row.id}
                  onChange={(e) => void toggleResolved(row.id, e.target.checked)}
                />
                resolved
              </label>
            </div>

            <p className="text-sm text-ink">{row.description}</p>

            {row.screenshotUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- a signed Supabase Storage URL, not a static asset next/image can optimize
              <img
                src={row.screenshotUrl}
                alt="Reporter's screenshot"
                className="max-h-64 w-fit max-w-full rounded-xl border border-white/10 object-contain"
              />
            )}

            <div className="flex flex-wrap gap-3 text-xs">
              <button type="button" onClick={() => void copyForClaude(row)} className="font-medium text-accent hover:brightness-110">
                {copiedId === row.id ? "Copied!" : "Copy for Claude Code"}
              </button>
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : row.id)}
                className="font-medium text-muted hover:text-ink"
              >
                {expanded ? "Hide snapshot" : "Show full snapshot"}
              </button>
              <button
                type="button"
                onClick={() => setTrailExpandedId(trailExpanded ? null : row.id)}
                className="font-medium text-muted hover:text-ink"
              >
                {trailExpanded ? "Hide click trail" : `Show click trail (${row.snapshot.breadcrumbs.length})`}
              </button>
            </div>

            {trailExpanded && (
              <ol className="flex list-decimal flex-col gap-1 rounded-xl bg-surface-2 p-3 pl-8 text-[11px] text-muted">
                {row.snapshot.breadcrumbs.length === 0 ? (
                  <li className="list-none pl-0">No interactions captured.</li>
                ) : (
                  row.snapshot.breadcrumbs.map((b, i) => (
                    <li key={i}>
                      {b.label} <span className="text-muted/60">({b.route})</span>
                    </li>
                  ))
                )}
              </ol>
            )}

            {expanded && (
              <pre className="max-h-96 overflow-auto rounded-xl bg-surface-2 p-3 text-[11px] text-muted">
                {JSON.stringify(row.snapshot, null, 2)}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
