"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Trophy } from "lucide-react";

const DISMISS_MS = 2200;

export interface PrMomentEvent {
  label: string;
}

/**
 * A small, non-blocking banner for a live "new personal record" moment
 * during a guided session. Deliberately NOT the full-screen celebration used
 * on session completion (see WorkoutCelebration) — a set can be logged mid-
 * rest, and blocking the screen there would fight the rest countdown the
 * athlete is already looking at. Auto-dismisses; never requires a tap.
 */
export function PrMoment({ event, onDone }: { event: PrMomentEvent | null; onDone: () => void }) {
  useEffect(() => {
    if (!event) return;
    const id = window.setTimeout(onDone, DISMISS_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
          className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
          role="status"
          aria-live="polite"
        >
          <div
            className="flex items-center gap-1.5 rounded-full px-4 py-2 shadow-lg"
            style={{ background: "var(--k-volt-grad)", boxShadow: "0 4px 20px rgba(200,255,60,.35)" }}
          >
            <Trophy className="h-4 w-4 shrink-0" strokeWidth={2.4} color="#0B0B0F" />
            <span className="text-[13px] font-extrabold text-[#0B0B0F]">{event.label}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
