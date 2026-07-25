"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Check } from "lucide-react";

const DISMISS_MS = 2200;

/**
 * The beat after finishing a session. Deliberately an overlay rather than a
 * screen: it plays over the workout that's already there and gets out of the
 * way, so the RPE prompt underneath stays where athletes expect it.
 *
 * Auto-dismisses; tapping skips it. Never blocks the flow.
 */
export function WorkoutCelebration({
  title = "Nice work",
  detail,
  onDone,
}: {
  title?: string;
  detail?: string | null;
  onDone: () => void;
}) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const id = window.setTimeout(() => done.current(), DISMISS_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onDone}
      className="k-dark-surface fixed inset-0 z-[70] flex flex-col items-center justify-center"
      style={{ background: "rgba(8,8,11,.92)" }}
      role="status"
      aria-live="polite"
    >
      <div className="relative flex h-[136px] w-[136px] items-center justify-center">
        {/* Two rings leaving at a stagger, so it reads as a pulse not a blink. */}
        <span aria-hidden className="animate-k-burst absolute inset-0 rounded-full" />
        <span
          aria-hidden
          className="animate-k-burst absolute inset-0 rounded-full"
          style={{ animationDelay: "0.28s" }}
        />
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
          className="flex h-[84px] w-[84px] items-center justify-center rounded-full"
          style={{
            background: "var(--k-volt-grad)",
            boxShadow: "0 0 32px rgba(200,255,60,.45)",
          }}
        >
          <Check size={40} strokeWidth={3} color="#0B0B0F" />
        </motion.span>
      </div>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14, duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
        className="mt-7 w-full px-8 text-center text-[26px] font-extrabold tracking-tight text-text-1"
      >
        {title}
      </motion.p>

      {detail ? (
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
          className="mt-2 w-full px-8 text-center text-[15px] text-text-3 tabular-nums"
        >
          {detail}
        </motion.p>
      ) : null}
    </motion.div>
  );
}
