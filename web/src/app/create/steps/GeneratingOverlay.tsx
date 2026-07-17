"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

const STATUS_LINES = [
  "Analyzing schedule…",
  "Structuring speed blocks…",
  "Calibrating paces…",
  "Balancing weekly volume…",
  "Finalizing your plan…",
];

function SkeletonCard({ delay }: { delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="flex items-center gap-3 rounded-2xl bg-surface p-4 [box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]"
    >
      <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-elevated" />
      <div className="flex-1">
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-elevated" />
        <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-elevated" />
      </div>
    </motion.div>
  );
}

export function GeneratingOverlay() {
  const [lineIdx, setLineIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setLineIdx((i) => Math.min(i + 1, STATUS_LINES.length - 1));
    }, 1400);
    return () => clearInterval(id);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[60] flex flex-col bg-bg px-6 pt-24"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto w-full max-w-[430px]">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-text-1">
          Building your plan
        </h1>

        <div className="mt-3 h-6">
          <AnimatePresence mode="wait">
            <motion.p
              key={lineIdx}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="text-[15px] text-text-2"
            >
              {STATUS_LINES[lineIdx]}
            </motion.p>
          </AnimatePresence>
        </div>

        <div className="mt-8 flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} delay={0.15 + i * 0.12} />
          ))}
        </div>

        <motion.div
          className="mt-8 h-1.5 overflow-hidden rounded-full bg-elevated"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <motion.div
            className="h-full rounded-full bg-accent"
            initial={{ width: "8%" }}
            animate={{ width: "92%" }}
            transition={{ duration: 6, ease: "easeOut" }}
          />
        </motion.div>
      </div>
    </motion.div>
  );
}
