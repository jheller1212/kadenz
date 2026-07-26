"use client";

import { motion, AnimatePresence } from "motion/react";
import { usePlanBuildProgress } from "@/lib/usePlanBuildProgress";

// The app has no i18n layer yet. Keeping the strings in this shape means
// adding German is a second key plus a lookup, not a rewrite.
const RUN_PHRASES = [
  "Building your plan",
  "Optimizing your workouts",
  "Tailoring the plan to you",
  "Polishing up",
];

// Half of the 340ms phrase swap: the outgoing line falls away, the incoming
// one rises into place, so the text changes at the midpoint.
const SWAP_MS = 0.17;
const EASE_IOS = [0.32, 0.72, 0, 1] as const;

// Fixed height so swapping a longer line never nudges the bar below it.
function StatusPhrase({ index, phrases }: { index: number; phrases: string[] }) {
  return (
    <div className="mt-3 h-[26px] text-[20px] font-bold tracking-[-0.4px] text-text-1">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: SWAP_MS, ease: EASE_IOS }}
        >
          {phrases[index]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/**
 * Full-screen state shown while a training plan is generated.
 *
 * @param complete flips true once the plan actually exists on the server
 * @param onSettled fired after the bar has landed on 100% — navigate here
 */
export function PlanBuildingLoader({
  complete,
  onSettled,
  phrases = RUN_PHRASES,
}: {
  complete: boolean;
  onSettled: () => void;
  /** Overridden when something other than a running plan is being built. */
  phrases?: string[];
}) {
  const progress = usePlanBuildProgress(complete, onSettled);
  const phraseIdx = Math.min(
    phrases.length - 1,
    Math.floor(progress / (100 / phrases.length)),
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24 }}
      className="k-dark-surface fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden bg-bg"
      style={{ background: "var(--k-bg-grad)" }}
      role="status"
      aria-live="polite"
    >
      {/* Volt haze behind the mark */}
      <div
        aria-hidden
        className="animate-k-glow pointer-events-none absolute left-1/2 top-[46%] h-[460px] w-[460px]"
        style={{
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(circle at center, rgba(200,255,60,.28) 0%, rgba(166,229,46,.14) 38%, transparent 70%)",
          filter: "blur(6px)",
        }}
      />

      <div className="relative -mt-10 flex flex-col items-center">
        <div className="relative flex h-[168px] w-[168px] items-center justify-center">
          {/* Orbiting arc, masked down to a 6px stroke */}
          <div
            aria-hidden
            className="animate-k-spin absolute inset-0 rounded-full opacity-85"
            style={{
              background:
                "conic-gradient(from 210deg, transparent 0deg, rgba(219,255,102,0) 40deg, #DBFF66 150deg, #A6E52E 230deg, transparent 300deg)",
              WebkitMask:
                "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))",
              mask: "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))",
            }}
          />
          {/* The asset supplies both the ink squircle and the volt K, so the
              wrapper only carries the matching radius (96/512 × 120) + shadow. */}
          <div
            className="animate-k-breathe h-[120px] w-[120px] rounded-[23px]"
            style={{
              boxShadow:
                "0 18px 42px -12px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.05)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon.svg"
              alt=""
              width={120}
              height={120}
              className="block h-[120px] w-[120px]"
            />
          </div>
        </div>

        <div className="mt-[30px] text-[13px] font-extrabold uppercase tracking-[2.4px] text-text-3">
          Kadenz
        </div>

        <StatusPhrase index={phraseIdx} phrases={phrases} />

        <div
          className="relative mt-[26px] h-[7px] w-[224px] overflow-hidden rounded-full bg-elevated"
          style={{ boxShadow: "inset 0 1px 2px rgba(0,0,0,.4)" }}
        >
          <div
            className="relative h-full overflow-hidden rounded-full"
            style={{
              width: `${progress}%`,
              background: "var(--k-volt-grad)",
              boxShadow: "0 0 12px rgba(200,255,60,.6)",
            }}
          >
            {/* Shine rides the fill, not the track: sweeping it across the
                whole track put a white gradient over the empty portion, which
                read as a flicker rather than a glint on the bar. */}
            <div
              aria-hidden
              className="animate-k-shine absolute left-0 top-0 h-full w-2/5"
              style={{
                background:
                  "linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent)",
              }}
            />
          </div>

        </div>

        <div className="mt-[14px] text-[13px] font-semibold tracking-[1px] text-text-3 tabular-nums">
          {Math.round(progress)}%
        </div>
      </div>

      <div
        aria-hidden
        className="absolute inset-x-0 bottom-10 flex items-center justify-center gap-[7px]"
      >
        {[0, 0.2, 0.4].map((delay) => (
          <span
            key={delay}
            className="animate-k-dot h-1.5 w-1.5 rounded-full bg-text-3"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </div>
    </motion.div>
  );
}
