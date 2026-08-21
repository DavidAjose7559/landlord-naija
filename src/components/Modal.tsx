"use client";

import { AnimatePresence, motion } from "framer-motion";

interface ModalProps {
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
}

// Every modal overlay in the app renders through this — Framer Motion
// spring transitions for the backdrop and panel (Section G: "no linear
// easing anywhere" for panel transitions), not a CSS fade/ease.
export function Modal({ onClose, children, className = "" }: ModalProps) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 40 }}
        onClick={onClose}
      >
        <motion.div
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
