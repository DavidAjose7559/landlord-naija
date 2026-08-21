"use client";

// A lightweight ring buffer of the last 30 UI interactions — installed
// once at app boot (see DiagnosticsBoot.tsx) so a bug report can show
// exactly what the reporter clicked leading up to it, turning "it broke"
// into an actual repro trail. Deliberately generic: it reads whatever
// aria-label/text/title is already on the element, never a raw DOM path,
// and never a typed value — a focused input only ever records THAT a
// field was focused, never its contents.

export interface Breadcrumb {
  timestamp: number;
  label: string;
  route: string;
}

const MAX_BREADCRUMBS = 30;
const buffer: Breadcrumb[] = [];

function push(entry: Breadcrumb): void {
  buffer.push(entry);
  if (buffer.length > MAX_BREADCRUMBS) buffer.shift();
}

export function getBreadcrumbs(): Breadcrumb[] {
  return [...buffer];
}

function truncate(value: string, max: number): string {
  const collapsed = value.trim().replace(/\s+/g, " ");
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

// pointerdown, not click — a native `disabled` control never dispatches a
// click event at all (the browser drops it before it would reach any
// listener, capture phase included), but pointerdown still fires, which
// is exactly the case worth recording: "tried to click X, but it was
// disabled (reason)".
function labelForInteractive(el: Element): string | null {
  const interactive = el.closest('button, a, [role="button"], [role="tab"], [role="link"]');
  if (!interactive) return null;

  const ariaLabel = interactive.getAttribute("aria-label");
  const title = interactive.getAttribute("title");
  const text = interactive.textContent ? truncate(interactive.textContent, 60) : "";
  const base = ariaLabel || text || title || interactive.tagName.toLowerCase();

  const disabled =
    "disabled" in interactive && (interactive as HTMLButtonElement).disabled === true;
  if (disabled) {
    return `clicked ${truncate(base, 60)} — disabled${title ? ` (${truncate(title, 80)})` : ""}`;
  }
  return `clicked ${truncate(base, 60)}`;
}

declare global {
  interface Window {
    __landlordBreadcrumbsInstalled?: boolean;
  }
}

export function installBreadcrumbs(): void {
  if (typeof window === "undefined" || window.__landlordBreadcrumbsInstalled) return;
  window.__landlordBreadcrumbsInstalled = true;

  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const label = labelForInteractive(target);
      if (!label) return;
      push({ timestamp: Date.now(), label, route: window.location.pathname });
    },
    { capture: true },
  );

  // Focus doesn't bubble, so this has to be its own capture-phase
  // listener rather than folded into the pointerdown one above.
  document.addEventListener(
    "focus",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const fieldLabel =
        target.getAttribute("aria-label") || target.getAttribute("placeholder") || target.tagName.toLowerCase();
      push({ timestamp: Date.now(), label: `focused ${truncate(fieldLabel, 60)}`, route: window.location.pathname });
    },
    { capture: true },
  );
}
