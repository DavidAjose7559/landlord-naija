"use client";

// A lightweight ring buffer of console errors, uncaught exceptions,
// unhandled promise rejections, and failed network requests — installed
// once at app boot (see DiagnosticsBoot.tsx, mounted in the root layout)
// so a bug report can attach "what was actually going wrong" without the
// reporter having to notice or describe it themselves. Capped at
// MAX_ENTRIES total so a chatty page can't leak memory over a long game.

import type { DiagnosticEntry } from "./bug-report-types";

const MAX_ENTRIES = 20;
const buffer: DiagnosticEntry[] = [];

function push(entry: DiagnosticEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

export function getDiagnostics(): DiagnosticEntry[] {
  return [...buffer];
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

declare global {
  interface Window {
    __landlordDiagnosticsInstalled?: boolean;
  }
}

// Guarded module-level side effect: runs once per page load, the first
// time this module is imported, and never re-wraps console.error/fetch
// again even if re-imported (React Strict Mode double-invocation, HMR).
export function installDiagnostics(): void {
  if (typeof window === "undefined" || window.__landlordDiagnosticsInstalled) return;
  window.__landlordDiagnosticsInstalled = true;

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    push({
      type: "console.error",
      message: truncate(
        args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" "),
        500,
      ),
      timestamp: Date.now(),
    });
    originalConsoleError(...args);
  };

  window.addEventListener("error", (event) => {
    push({
      type: "window.onerror",
      message: truncate(event.message, 500),
      detail: event.error instanceof Error ? truncate(event.error.stack ?? "", 1000) : undefined,
      timestamp: Date.now(),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    push({
      type: "unhandledrejection",
      message: truncate(reason instanceof Error ? reason.message : String(reason), 500),
      detail: reason instanceof Error ? truncate(reason.stack ?? "", 1000) : undefined,
      timestamp: Date.now(),
    });
  });

  // Only failures are recorded (non-ok status or a thrown network error) —
  // this stays a short diagnostic trail, not a full request log.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const input = args[0];
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    try {
      const res = await originalFetch(...args);
      if (!res.ok) {
        push({ type: "network", message: `${res.status} ${res.statusText} — ${url}`, timestamp: Date.now() });
      }
      return res;
    } catch (err) {
      push({
        type: "network",
        message: `request failed — ${url}`,
        detail: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
      throw err;
    }
  };
}
