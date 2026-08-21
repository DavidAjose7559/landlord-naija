"use client";

import { useState } from "react";
import { getDiagnostics } from "@/lib/diagnostics";
import { SEVERITY_LABEL, type BugSeverity } from "@/lib/bug-report-types";
import type { PlayerSession } from "@/lib/session";
import { Modal } from "./Modal";

interface BugReportButtonProps {
  roomCode: string;
  session: PlayerSession | null;
}

const SEVERITIES: BugSeverity[] = ["ruins_game", "annoying", "cosmetic"];

// Persistent, unobtrusive, and always available — deliberately doesn't
// check whose turn it is, what turnPhase the game is in, or whether
// `session` even exists. A spectator with no seat can still file a report.
// Submitting only ever POSTs to /api/bugs, never to the game's own action
// route, so there is no path from this component to a game-state mutation.
export function BugReportButton({ roomCode, session }: BugReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<BugSeverity>("annoying");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function submit() {
    const trimmed = description.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/bugs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roomCode,
          clientToken: session?.clientToken,
          description: trimmed,
          severity,
          commitSha: process.env.NEXT_PUBLIC_COMMIT_SHA || null,
          client: {
            userAgent: navigator.userAgent,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            online: navigator.onLine,
            devicePixelRatio: window.devicePixelRatio,
          },
          diagnostics: getDiagnostics(),
        }),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const message =
          body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : null;
        throw new Error(message ?? `request failed (${res.status})`);
      }

      setOpen(false);
      setDescription("");
      setSeverity("annoying");
      setToast("Logged. Thanks — that helps.");
      setTimeout(() => setToast(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't send that — try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report a bug"
        title="Report a bug"
        className="fixed bottom-4 right-4 z-[45] flex h-10 w-10 items-center justify-center rounded-full bg-surface-2/90 text-base shadow-lg backdrop-blur transition-colors hover:bg-surface-2"
      >
        🐛
      </button>

      {open && (
        <Modal onClose={() => !submitting && setOpen(false)} ariaLabel="Report a bug">
          <h2 className="text-sm font-semibold text-ink">Report a bug</h2>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What did you expect vs what actually happened?"
            rows={4}
            autoFocus
            className="w-full resize-none rounded-xl bg-surface-2 p-3 text-sm text-ink placeholder:text-muted focus:outline-none"
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Severity</span>
            <div className="flex gap-2">
              {SEVERITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={`flex-1 rounded-full px-3 py-2 text-xs font-medium ${
                    severity === s ? "bg-accent/20 text-accent" : "bg-surface-2 text-ink hover:bg-white/10"
                  }`}
                >
                  {SEVERITY_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="flex-1 rounded-full bg-surface-2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-white/10 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || description.trim().length === 0}
              className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
            >
              {submitting ? "Sending…" : "Send"}
            </button>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-16 right-4 z-[45] rounded-full bg-accent/20 px-4 py-2 text-xs font-medium text-accent shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
