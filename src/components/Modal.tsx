"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

interface ModalProps {
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}

// Every modal overlay in the app renders through this — Framer Motion
// spring transitions for the backdrop and panel (Section G: "no linear
// easing anywhere" for panel transitions), not a CSS fade/ease.
export function Modal({ onClose, children, className = "", ariaLabel, ariaLabelledBy }: ModalProps) {
  useEffect(() => {
    if (!onClose) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        // Excluded from html2canvas's bug-report screenshot capture (see
        // BugReportButton.tsx) — a modal overlay obscures the page state a
        // reporter actually wants captured, so no modal in the app should
        // ever end up in one.
        data-html2canvas-ignore="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 40 }}
        onClick={onClose}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
          className={`flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-2xl bg-surface p-6 ${className}`}
        >
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
