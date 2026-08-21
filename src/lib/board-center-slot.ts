"use client";

import { useEffect, useState } from "react";

// (Section 4c) "Card modals must not cover space labels — move card
// reveals to the CENTRE of the board... Same treatment for tooltips and
// toasts." PropertyInspector (desktop) portals into this node instead of
// using the full-screen Modal, so its dimmed backdrop is confined to the
// board's own empty inner region rather than covering the ring of spaces.
//
// A tiny module-level pub-sub rather than React context: Board publishes
// its inner-region DOM node once on mount (there's only ever one Board
// mounted at a time — this is a single-game-view app), and any consumer
// elsewhere in the tree (PropertyInspector is a sibling of Board, not a
// child, so context would need a provider above both) can read it without
// prop-drilling through page.tsx.
let node: HTMLDivElement | null = null;
const listeners = new Set<() => void>();

export function setBoardCenterSlot(el: HTMLDivElement | null): void {
  node = el;
  listeners.forEach((l) => l());
}

export function useBoardCenterSlot(): HTMLDivElement | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return node;
}
