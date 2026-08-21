"use client";

import { motion, type PanInfo } from "framer-motion";
import { useEffect, useState } from "react";

type SnapPoint = "peek" | "half" | "full";

const SNAP_VH: Record<SnapPoint, number> = { peek: 16, half: 48, full: 88 };
const SNAP_ORDER: SnapPoint[] = ["peek", "half", "full"];

const DRAG_THRESHOLD = 60;

// Below md, the side panel becomes a draggable bottom sheet with three
// snap points (Section G) instead of the old single peek/expanded toggle.
// Above md it renders as a plain static block — same as before — since
// the sheet behavior (fixed positioning, drag, spring height) is a phone
// layout concept that doesn't apply once the panel sits beside the board.
export function MobileSheet({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState<SnapPoint>("peek");
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function cycleUp() {
    const i = SNAP_ORDER.indexOf(snap);
    setSnap(SNAP_ORDER[Math.min(i + 1, SNAP_ORDER.length - 1)]);
  }
  function cycleDown() {
    const i = SNAP_ORDER.indexOf(snap);
    setSnap(SNAP_ORDER[Math.max(i - 1, 0)]);
  }

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y < -DRAG_THRESHOLD) cycleUp();
    else if (info.offset.y > DRAG_THRESHOLD) cycleDown();
  }

  if (isDesktop) {
    return <div className="md:static md:z-auto md:w-96 md:shrink-0">{children}</div>;
  }

  return (
    <motion.div
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden rounded-t-3xl bg-surface shadow-[0_-12px_40px_rgba(0,0,0,0.5)]"
      animate={{ height: `${SNAP_VH[snap]}vh` }}
      transition={{ type: "spring", stiffness: 320, damping: 34 }}
      drag="y"
      dragElastic={0.06}
      dragMomentum={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      onDragEnd={handleDragEnd}
    >
      <button
        type="button"
        onClick={cycleUp}
        onDoubleClick={cycleDown}
        aria-label={`Resize panel (currently ${snap})`}
        className="flex w-full shrink-0 cursor-grab touch-none justify-center py-2.5 active:cursor-grabbing"
      >
        <span className="h-1 w-10 rounded-full bg-white/20" />
      </button>
      <div className="flex-1 overflow-y-auto px-4 pb-8">{children}</div>
    </motion.div>
  );
}
