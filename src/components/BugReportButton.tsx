"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getBreadcrumbs } from "@/lib/breadcrumbs";
import { getDiagnostics } from "@/lib/diagnostics";
import { SEVERITY_LABEL, type BugSeverity } from "@/lib/bug-report-types";
import { loadSession } from "@/lib/session";
import { Modal } from "./Modal";

const SEVERITIES: BugSeverity[] = ["ruins_game", "annoying", "cosmetic"];
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

// Matches "/game/ABCDEF", "/game/ABCDEF/lobby", "/game/ABCDEF/verify" —
// anything under a room. Not "/game/ABCDEF/something-else" that isn't a
// 6-char room code, so a malformed path just falls back to "no room".
const ROOM_CODE_IN_PATH = /^\/game\/([A-Za-z0-9]{6})(?:\/|$)/;

// Draws any image source onto a canvas and re-encodes it as JPEG at ~0.7
// quality, capped at 2MB — the single choke point both the html2canvas
// auto-capture and a manually uploaded file go through, so "compressed,
// size-capped JPEG" is one guarantee instead of two separate ones.
// Returns null on any failure (never throws) — capture/compression
// trouble must never block the report itself from submitting.
async function compressToJpeg(source: HTMLCanvasElement | Blob): Promise<Blob | null> {
  try {
    let canvas: HTMLCanvasElement;
    if (source instanceof HTMLCanvasElement) {
      canvas = source;
    } else {
      const bitmap = await createImageBitmap(source);
      canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.7));
    if (!blob || blob.size > MAX_SCREENSHOT_BYTES) return null;
    return blob;
  } catch (e) {
    // Logged (not swallowed silently) so a real capture bug is visible in
    // the console/diagnostics ring buffer — but still returns null rather
    // than throwing, so it can never block the report itself.
    console.error("bug screenshot compression failed", e);
    return null;
  }
}

// html2canvas-pro (not plain html2canvas — see BUGS.md) is dynamically
// imported so pages that never open the bug form never pay for it in
// their initial bundle.
async function captureAutoScreenshot(): Promise<Blob | null> {
  try {
    const { default: html2canvas } = await import("html2canvas-pro");
    // Excludes anything marked data-html2canvas-ignore (every Modal in the
    // app, including this one) so the bug form itself never ends up in
    // its own screenshot — the reporter wants the page state behind it.
    const canvas = await html2canvas(document.body, { logging: false, useCORS: true });
    return await compressToJpeg(canvas);
  } catch (e) {
    console.error("bug screenshot auto-capture failed", e);
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Mounted once in the root layout — every route gets it for free, a future
// page can't forget to add it. Deliberately self-contained (no props):
// derives roomCode from the current path and loads that room's session
// from localStorage at submit time (same storage useGame reads), rather
// than requiring every page to thread roomCode/session down to it.
//
// Always available — doesn't check whose turn it is, what turnPhase the
// game is in, or whether there's even a game on this page at all (home,
// /rules submit fine with just description/severity/client info). Submit
// only ever POSTs to /api/bugs, never the game's own action route, so
// there is no path from this component to a game-state mutation.
export function BugReportButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<BugSeverity>("annoying");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [screenshot, setScreenshot] = useState<Blob | null>(null);
  const [screenshotPreviewUrl, setScreenshotPreviewUrl] = useState<string | null>(null);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);

  // Object URL lifecycle tied to whichever Blob is current — revoked
  // whenever it's replaced/cleared or the component unmounts, so an open
  // form never leaks one.
  useEffect(() => {
    if (!screenshot) {
      setScreenshotPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(screenshot);
    setScreenshotPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  function openForm() {
    setOpen(true);
    setScreenshot(null);
    setCapturingScreenshot(true);
    // Fired from the trigger button's own click, before the modal has
    // painted — html2canvas reads document.body as it is at call time, so
    // this captures the page the reporter was actually looking at, not
    // the form. Belt-and-suspenders: the modal also carries
    // data-html2canvas-ignore (see Modal.tsx) in case timing ever shifts.
    void captureAutoScreenshot().then((blob) => {
      setScreenshot(blob);
      setCapturingScreenshot(false);
    });
  }

  async function onFileSelected(file: File) {
    const compressed = await compressToJpeg(file);
    setScreenshot(compressed);
  }

  async function submit() {
    const trimmed = description.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const roomCodeMatch = ROOM_CODE_IN_PATH.exec(pathname);
      const roomCode = roomCodeMatch ? roomCodeMatch[1].toUpperCase() : undefined;
      const session = roomCode ? loadSession(roomCode) : null;

      // A capture/encode failure here just means the field is omitted —
      // never a reason to block the report.
      const screenshotBase64 = screenshot ? await blobToBase64(screenshot).catch(() => undefined) : undefined;

      const res = await fetch("/api/bugs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roomCode,
          clientToken: session?.clientToken,
          path: pathname,
          description: trimmed,
          severity,
          commitSha: process.env.NEXT_PUBLIC_COMMIT_SHA ?? "local-dev",
          client: {
            userAgent: navigator.userAgent,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            online: navigator.onLine,
            devicePixelRatio: window.devicePixelRatio,
          },
          diagnostics: getDiagnostics(),
          breadcrumbs: getBreadcrumbs(),
          screenshotBase64,
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
      setScreenshot(null);
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
        onClick={openForm}
        aria-label="Report a bug"
        title="Report a bug"
        className="fixed bottom-4 right-4 z-[60] flex h-10 w-10 items-center justify-center rounded-full bg-surface-2/90 text-base shadow-lg backdrop-blur transition-colors hover:bg-surface-2"
      >
        {/* (Task 3) Drawn report/feedback glyph, not an emoji. */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M4 5h16v10H9l-4 4v-4H4z" />
          <rect x="11.1" y="7.8" width="1.6" height="4.2" fill="currentColor" stroke="none" />
          <circle cx="11.9" cy="14.4" r="0.95" fill="currentColor" stroke="none" />
        </svg>
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

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Screenshot</span>
            <div className="flex items-center gap-3">
              {capturingScreenshot ? (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[10px] text-muted">
                  Capturing…
                </div>
              ) : screenshotPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a client-generated blob: URL preview, not a static asset next/image can optimize
                <img
                  src={screenshotPreviewUrl}
                  alt="Screenshot preview"
                  className="h-14 w-14 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[10px] text-muted">
                  None
                </div>
              )}
              <div className="flex flex-col gap-1 text-xs">
                {screenshotPreviewUrl && (
                  <button
                    type="button"
                    onClick={() => setScreenshot(null)}
                    className="w-fit font-medium text-danger hover:underline"
                  >
                    Remove
                  </button>
                )}
                <label className="w-fit cursor-pointer font-medium text-accent hover:underline">
                  {screenshotPreviewUrl ? "Replace with a file…" : "Attach a file instead…"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void onFileSelected(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
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

      {/* (Task 9) A success toast, not an action — danfo yellow marks
          "where you can act," not "this succeeded." */}
      {toast && (
        <div className="fixed bottom-16 right-4 z-[60] rounded-full bg-gain/20 px-4 py-2 text-xs font-medium text-gain shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
